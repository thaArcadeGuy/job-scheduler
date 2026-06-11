import { handleEmailJob } from "./emailHandler.js"
import { logger } from "../utils/logger.js"

const handlers = {
  send_email: handleEmailJob,
}

export async function dispatch(job) {
  const handler = handlers[job.type]

  if (!handler) {
    const error = new Error(`No handler registered for job type: "${job.type}"`)
    error.unrecoverable = true
    throw error
  }

  logger.info({ jobId: job._id, type: job.type }, 'Processing job');

  return handler(job)
}