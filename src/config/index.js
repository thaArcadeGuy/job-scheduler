import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || "development",

  mongo: {
    uri: process.env.MONGO_URI || "mongodb://localhost:27017/job_scheduler",
  },

  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },

  email: {
    host: process.env.SMTP_HOST || "smtp.ethereal.email",
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.ALERT_EMAIL_FROM || "scheduler@dilamme.com",
    alertTo: process.env.ALERT_EMAIL_TO || "admin@dilamme.com",
  },

  dlq: {
    alertThreshold: parseInt(process.env.DLQ_ALERT_THRESHOLD, 10) || 10,
  },

  worker: {
    pollIntervalMs: parseInt(process.env.WORKER_POLL_INTERVAL_MS, 10) || 1000,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY, 10) || 5,
    lockTtlSeconds: parseInt(process.env.WORKER_LOCK_TTL_SECONDS, 10) || 30,
  },

  starvationThresholdMs: parseInt(process.env.STARVATION_THRESHOLD_MS, 10) || 30000,
};