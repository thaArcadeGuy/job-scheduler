import dotenv from "dotenv"
import { v4 as uuidv4 } from "uuid"
import { connectToDB } from "../config/db.js"
import getRedisClient, { connectToRedis }  from "../config/redis.js"
import { Job } from "../models/job.model.js"
import { dequeueAndLock, releaseLock, enqueue } from '../queues/redisQueue.js'
import { dispatch } from "../handlers/index.js";
import { getNextRetryAt } from "./retryStrategy.js"
import { enterDLQ } from "../services/dlq.service.js"
import { logJobEvent } from "../utils/jobLogger.js"
import { config } from "../config/index.js"
import { logger } from "../utils/logger.js"

dotenv.config();

const WORKER_ID = `worker-${uuidv4().slice(0, 8)}`;
const POLL_INTERVAL = config.worker.pollIntervalMs;
const CONCURRENCY = config.worker.concurrency;
 
let isShuttingDown = false;
let activeJobs = 0;

async function bootstrap() {
  await connectToDB();
  await connectToRedis()
    
    const redis = getRedisClient(); 
    await redis.set("key", "value");
 
  
  await recoverStuckJobs();
 
  logger.info({ workerId: WORKER_ID, concurrency: CONCURRENCY }, "Worker started");
 
  poll();
}

async function recoverStuckJobs() {
  const stuckJobs = await Job.find({ status: "processing"});
  if (stuckJobs.length === 0) return;
 
  logger.warn({ count: stuckJobs.length }, "Recovering jobs stuck in processing state");
 
  for (const job of stuckJobs) {
    await Job.findByIdAndUpdate(job._id, {
      status: "pending",
      lockedBy: null,
      startedAt: null,
    });
    await enqueue(job);
    logger.info({ jobId: job._id }, "Stuck job reset to pending and re-enqueued");
  }
}

 
async function poll() {
  if (isShuttingDown) return;

  const slots = CONCURRENCY - activeJobs;
  const promises = [];
 
  for (let i = 0; i < slots; i++) {
    promises.push(processNextJob());
  }
 
  await Promise.allSettled(promises);
 
  if (!isShuttingDown) {
    setTimeout(poll, POLL_INTERVAL);
  }
}

 
async function processNextJob() {
  const jobId = await dequeueAndLock(WORKER_ID);
  if (!jobId) return; 
 
  activeJobs++;
 
  try {
    const job = await Job.findById(jobId);
 
    if (!job) {
      logger.warn({ jobId }, "Job claimed from queue but not found in DB — skipping");
      await releaseLock(jobId);
      return;
    }
 
    if (job.cancelRequested || job.status === "cancelled") {
      logger.info({ jobId }, "Job cancelled — skipping");
      await Job.findByIdAndUpdate(jobId, { status: "cancelled" });
      await releaseLock(jobId);
 
      await logJobEvent({ jobId, event: "job_cancelled", workerId: WORKER_ID });
      return;
    }

    if (job.dependsOn && job.dependsOn.length > 0) {
      const unfinished = await checkDependencies(job);
      if (unfinished.length > 0) {
        logger.debug(
          { jobId, unfinished },
          "Job dependencies not yet completed — re-queuing"
        );
        await Job.findByIdAndUpdate(jobId, { status: "pending", lockedBy: null });
        await enqueue(job);
        await releaseLock(jobId);
        return;
      }
    }
 
    await logJobEvent({ jobId, event: "job_started", workerId: WORKER_ID });
 
    await executeJob(job);
  } catch (err) {
    logger.error({ err, jobId }, "Unexpected error in worker loop");
    await releaseLock(jobId);
  } finally {
    activeJobs--;
  }
}
 
async function executeJob(job) {
  const jobId = job._id;
 
  try {
    const result = await dispatch(job);

    const fresh = await Job.findById(jobId).select("cancelRequested status");
    if (fresh?.cancelRequested || fresh?.status === "cancelled") {
      logger.info({ jobId }, "Job was cancelled mid-execution — discarding result");
      await Job.findByIdAndUpdate(jobId, { status: "cancelled", completedAt: new Date() });
      await logJobEvent({ jobId, event: "job_cancelled", workerId: WORKER_ID,
        meta: { note: "cancelled mid-execution, result discarded" } });
      await releaseLock(jobId);
      return;
    }
 
    await Job.findByIdAndUpdate(jobId, {
      status: "completed",
      completedAt: new Date(),
      lockedBy: null,
    });
 
    await logJobEvent({
      jobId,
      event: "job_completed",
      workerId: WORKER_ID,
      meta: { result },
    });

    if (job.recurringInterval) {
      await scheduleNextRecurring(job);
    }
 
    await releaseLock(jobId);
  } catch (err) {
    await handleJobFailure(job, err);
  }
}
 
 
async function handleJobFailure(job, err) {
  const jobId = job._id;
  const newRetryCount = job.retryCount + 1;
 
  logger.warn(
    { jobId, retryCount: newRetryCount, maxRetries: job.maxRetries, error: err.message },
    "Job failed"
  );
 

  const isUnrecoverable = err.unrecoverable === true;
  const exhausted = newRetryCount >= job.maxRetries;
 
  if (isUnrecoverable || exhausted) {
    await Job.findByIdAndUpdate(jobId, {
      status: "failed",
      retryCount: newRetryCount,
      lastError: err.message,
      lastErrorStack: err.stack || null,
      failedAt: new Date(),
      lockedBy: null,
    });
 
    await logJobEvent({
      jobId,
      event: "job_failed",
      workerId: WORKER_ID,
      meta: {
        error: err.message,
        retryCount: newRetryCount,
        sentToDLQ: true,
        unrecoverable: isUnrecoverable,
      },
    });
 
    const updatedJob = await Job.findById(jobId);
    await enterDLQ(updatedJob, err);
  } else {
    const nextRetryAt = getNextRetryAt(newRetryCount);
 
    await Job.findByIdAndUpdate(jobId, {
      status: "pending",
      retryCount: newRetryCount,
      lastError: err.message,
      lastErrorStack: err.stack || null,
      scheduledAt: nextRetryAt,
      lockedBy: null,
    });
 
    const updatedJob = await Job.findById(jobId);
    await enqueue(updatedJob);
 
    await logJobEvent({
      jobId,
      event: "retry_attempted",
      workerId: WORKER_ID,
      meta: {
        error: err.message,
        retryCount: newRetryCount,
        nextRetryAt,
      },
    });
  }
 
  await releaseLock(jobId);
}
 
 
const INTERVAL_MAP = {
  every_1_minute:  60 * 1000,
  every_5_minutes: 5 * 60 * 1000,
  every_1_hour:    60 * 60 * 1000,
};
 
async function scheduleNextRecurring(completedJob) {
  const intervalMs = INTERVAL_MAP[completedJob.recurringInterval];
  if (!intervalMs) {
    logger.warn({ recurringInterval: completedJob.recurringInterval }, 'Unknown recurring interval');
    return;
  }
 
  const nextRun = new Date(Date.now() + intervalMs);
 
  const nextJob = await Job.create({
    type: completedJob.type,
    priority: completedJob.priority,
    payload: completedJob.payload,
    recurringInterval: completedJob.recurringInterval,
    dependsOn: completedJob.dependsOn,
    scheduledAt: nextRun,
    status: "pending",
  });
 
  await enqueue(nextJob);
 
  await logJobEvent({
    jobId: nextJob._id,
    event: "job_created",
    meta: {
      note: `Recurring job — next run at ${nextRun.toISOString()}`,
      parentJobId: completedJob._id,
      interval: completedJob.recurringInterval,
    },
  });
 
  logger.info(
    { newJobId: nextJob._id, nextRun, interval: completedJob.recurringInterval },
    "Recurring job scheduled"
  );
}

async function checkDependencies(job) {
  const deps = await Job.find(
    { _id: { $in: job.dependsOn } },
    { _id: 1, status: 1 }
  );
 
  const notDone = deps
    .filter((d) => d.status !== "completed")
    .map((d) => d._id);
 
  const broken = deps
    .filter((d) => d.status === "cancelled" || d.status === "failed")
    .map((d) => d._id);
 
  if (broken.length > 0) {
    const err = new Error(
      `DAG dependency failed or cancelled: [${broken.join(", ")}]`
    );
    err.unrecoverable = true;
    throw err;
  }
 
  return notDone;
}
 
 
async function shutdown(signal) {
  logger.info({ signal }, "Worker shutting down...");
  isShuttingDown = true;

  const deadline = Date.now() + 30_000;
  while (activeJobs > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
 
  if (activeJobs > 0) {
    logger.warn({ activeJobs }, "Shutdown timeout — some jobs may be requeued on restart");
  }
 
  process.exit(0);
}
 
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
 
bootstrap().catch((err) => {
  logger.fatal({ err }, "Worker failed to start");
  process.exit(1);
});