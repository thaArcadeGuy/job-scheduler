import { JobLog } from "../models/joblog.model.js"
import logger from "./logger.js"

export async function logJobEvent({ jobId, event, meta = {}, workerId = null }) {
  logger.info({ jobId, event, workerId, ...meta }, `[JOB_EVENT] ${event}`)

  JobLog.create({ jobId, event, meta, workerId }).catch((error) => {
    logger.error({ error, jobId, event }, "Failed to persist job log entry")
  })
}