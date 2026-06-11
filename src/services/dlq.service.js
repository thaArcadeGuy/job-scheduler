import nodemailer from "nodemailer"
import { DLQEntry } from "../models/dlq.model.js"
import { Job } from "../models/job.model.js"
import { logJobEvent } from "../utils/jobLogger.js"
import { enqueue } from "../queues/redisQueue.js"
import { config } from "../config/index.js"
import { logger } from "../utils/logger.js"

let _lastAlertSentAt = null
const ALERT_COOLDOWN_MS = 5 * 60 * 1000

export async function enterDLQ(job, error) {
  logger.warn({ jobId: job._id, error: error.message }, "Job entering DLQ");
 
  const entry = await DLQEntry.create({
    jobId: job._id,
    jobType: job.type,
    payload: job.payload,
    priority: job.priority,
    errorMessage: error.message,
    errorStack: error.stack || null,
    totalAttempts: job.retryCount,
    dlqStatus: 'waiting',
  });
 
  await logJobEvent({
    jobId: job._id,
    event: 'dlq_entered',
    meta: {
      dlqEntryId: entry._id,
      errorMessage: error.message,
      totalAttempts: job.retryCount,
    },
  });
 
  await checkDLQThresholdAndAlert();
 
  return entry;
}

export async function checkDLQThresholdAndAlert() {
  try {
    const count = await DLQEntry.countDocuments({ dlqStatus: "waiting" });
 
    if (count < config.dlq.alertThreshold) return;
 
    if (_lastAlertSentAt && Date.now() - _lastAlertSentAt < ALERT_COOLDOWN_MS) {
      logger.debug({ count, threshold: config.dlq.alertThreshold }, "DLQ alert suppressed (cooldown)");
      return;
    }
 
    _lastAlertSentAt = Date.now();
 
    logger.warn(
      { count, threshold: config.dlq.alertThreshold },
      "DLQ threshold exceeded — sending alert email"
    );
 
    await sendDLQAlertEmail(count);
  } catch (error) {
    logger.error({ error }, "DLQ threshold check failed");
  }
}

export async function sendDLQAlertEmail(count) {
  try {
    let transport;
    if (config.nodeEnv !== "production" && !config.email.user) {
      const testAccount = await nodemailer.createTestAccount();
      transport = nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        auth: { user: testAccount.user, pass: testAccount.pass },
      });
    } else {
      transport = nodemailer.createTransport({
        host: config.email.host,
        port: config.email.port,
        auth: { user: config.email.user, pass: config.email.pass },
      });
    }
 
    const info = await transport.sendMail({
      from: config.email.from,
      to: config.email.alertTo,
      subject: `[ALERT] DLQ threshold exceeded — ${count} failed jobs`,
      text: [
        `The Dead-Letter Queue has exceeded the alert threshold.`,
        ``,
        `Current DLQ size: ${count}`,
        `Threshold:        ${config.dlq.alertThreshold}`,
        ``,
        `Please review the DLQ at your dashboard and investigate failed jobs.`,
      ].join('\n'),
    });
 
    const previewUrl = nodemailer.getTestMessageUrl(info);
    logger.info({ previewUrl, count }, "DLQ alert email sent");
  } catch (error) {
    logger.error({ error }, "Failed to send DLQ alert email");
  }
}

export async function retryFromDLQ(dlqEntryId) {
  const entry = await DLQEntry.findById(dlqEntryId);
  if (!entry) throw new Error(`DLQ entry not found: ${dlqEntryId}`);
 
  if (entry.dlqStatus === "resolved") {
    throw new Error("This DLQ entry has already been resolved");
  }

  entry.dlqStatus = "retrying";
  entry.retryCount += 1;
  entry.lastRetriedAt = new Date();
  await entry.save();

  const newJob = await Job.create({
    type: entry.jobType,
    payload: entry.payload,
    priority: entry.priority || 2,
    status: "pending",
    retryCount: 0,
    _dlqEntryId: entry._id,
  });

  await enqueue(newJob);
 
  await logJobEvent({
    jobId: newJob._id,
    event: "dlq_retry_triggered",
    meta: { originalDlqEntryId: dlqEntryId, originalJobId: entry.jobId },
  });
 
  logger.info(
    { dlqEntryId, newJobId: newJob._id },
    "DLQ manual retry triggered — new job created"
  );
 
  return newJob;
}

export async function markDLQResolved(dlqEntryId) {
  await DLQEntry.findByIdAndUpdate(dlqEntryId, { dlqStatus: "resolved" })
}