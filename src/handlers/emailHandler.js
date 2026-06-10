import nodemailer from "nodemailer"
import { config } from "../config/index.js"
import { logger } from "../utils/logger.js"

let _transport = null

async function getTransport() {
  if (_transport) return _transport;
 
  if (config.nodeEnv !== 'production' && !config.email.user) {
    // Auto-create an Ethereal test account if no creds are configured
    const testAccount = await nodemailer.createTestAccount();
    logger.info(
      {
        user: testAccount.user,
        pass: testAccount.pass,
        previewUrl: 'https://ethereal.email',
      },
      'Created Ethereal test email account — check https://ethereal.email to view sent emails'
    );
    _transport = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
  } else {
    _transport = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      auth: { user: config.email.user, pass: config.email.pass },
    });
  }
 
  return _transport;
}

export async function handleEmailJob(job) {
  const { to, subject, body, html } = job.payload || {};

  if (!to) throw new Error('Email payload missing required field: to');
  if (!subject) throw new Error('Email payload missing required field: subject');
 
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(to)) {
    throw new Error(`Invalid email address: ${to}`);
  }
 
  const message = {
    from: config.email.from || 'scheduler@dilamme.com',
    to,
    subject,
    text: body || `This is an automated message for job ${job._id}.`,
    html: html || `<p>${body || `Automated message for job <strong>${job._id}</strong>`}</p>`,
  };

  const transport = await getTransport();
 
  logger.info({ jobId: job._id, to, subject }, 'Sending email');
 
  const info = await transport.sendMail(message);
 
  const previewUrl = nodemailer.getTestMessageUrl(info);
 
  logger.info(
    { jobId: job._id, messageId: info.messageId, previewUrl },
    'Email sent successfully'
  );
 
  return {
    messageId: info.messageId,
    previewUrl: previewUrl || null,
    to,
    subject,
  };
}