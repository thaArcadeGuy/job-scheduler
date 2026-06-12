import express from "express";
import { v4 as uuidv4 } from "uuid";
import { Job } from "../models/job.model.js";
import { enqueue, removeFromQueue } from "../queues/redisQueue.js";
import { logJobEvent } from "../utils/jobLogger.js";
import { JobLog } from "../models/joblog.model.js";
import { logger } from "../utils/logger.js";
import { asyncHandler } from "../utils/asyncHandler.js"

const router = express.Router();

async function detectCyclicDependencies(newJobId, dependsOn) {
  if (!dependsOn || dependsOn.length === 0) return;

  const visited = new Set();
  const queue = [...dependsOn];
 
  while (queue.length > 0) {
    const depId = queue.shift();
 
    if (depId === newJobId) {
      throw new Error("Circular dependency detected — this job depends on itself (directly or transitively)");
    }
 
    if (visited.has(depId)) continue;
    visited.add(depId);
 
    const dep = await Job.findById(depId).select("dependsOn").lean();
    if (!dep) {
      logger.warn({ missingDepId: depId, newJobId }, "Dependency job not found");
      throw new Error(`Dependency job not found: ${depId}`);
    }
 
    if (dep.dependsOn?.length > 0) {
      queue.push(...dep.dependsOn);
    }
  }
}

/**
 * @swagger
 * /jobs/stats:
 *   get:
 *     summary: Get job counts by status (dashboard)
 *     tags: [Jobs]
 *     responses:
 *       200: { description: Status counts }
 */
router.get("/stats", asyncHandler(async (req, res) => {
  const counts = await Job.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
 
  const stats = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
 
  for (const { _id, count } of counts) {
    if (_id in stats) stats[_id] = count;
  }
 
  return res.json(stats);
}));

/**
 * @swagger
 * /jobs/{id}/logs:
 *   get:
 *     summary: Get event logs for a specific job
 *     tags: [Jobs]
 */
router.get("/:id/logs", asyncHandler(async (req, res) => {
  const logs = await JobLog.find({ jobId: req.params.id })
    .sort({ createdAt: 1 })
    .lean();
  return res.json({ logs });
}));

/**
 * @swagger
 * /jobs/{id}/cancel:
 *   patch:
 *     summary: Cancel a job
 *     tags: [Jobs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Job cancelled }
 *       400: { description: Cannot cancel (already completed/failed) }
 *       404: { description: Not found }
 */
router.patch("/:id/cancel", asyncHandler(async (req, res) => {
  const job = await Job.findById(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
 
  if (["completed", "failed", "cancelled"].includes(job.status)) {
    return res.status(400).json({
      error: `Cannot cancel a job with status: ${job.status}`,
    });
  }

  if (job.status === "pending") {
    await Job.findByIdAndUpdate(job._id, {
      status: "cancelled",
      cancelRequested: true,
    });
    await removeFromQueue(job._id);
  } else {
    await Job.findByIdAndUpdate(job._id, { cancelRequested: true });
  }
 
  await logJobEvent({ jobId: job._id, event: "job_cancelled",
    meta: { previousStatus: job.status } });
 
  return res.json({ message: "Job cancellation requested", jobId: job._id });
}));

/**
 * @swagger
 * /jobs:
 *   get:
 *     summary: List all jobs with optional filters
 *     tags: [Jobs]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *       - in: query
 *         name: priority
 *         schema: { type: integer }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: List of jobs }
 */
router.get("/", asyncHandler(async (req, res) => {
  const { status, type, priority, page = 1, limit = 20 } = req.query;
 
  const filter = {};
  if (status) filter.status = status;
  if (type) filter.type = type;
  if (priority) filter.priority = Number(priority);
 
  const skip = (Number(page) - 1) * Number(limit);
 
  const [jobs, total] = await Promise.all([
    Job.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Job.countDocuments(filter),
  ]);
 
  return res.json({
    jobs,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / Number(limit)),
    },
  });
}));
 
/**
 * @swagger
 * /jobs:
 *   post:
 *     summary: Create a new job
 *     tags: [Jobs]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type]
 *             properties:
 *               type:          { type: string, example: send_email }
 *               priority:      { type: integer, enum: [1,2,3], default: 2 }
 *               payload:       { type: object }
 *               scheduledAt:   { type: string, format: date-time }
 *               recurringInterval: { type: string, enum: [every_1_minute, every_5_minutes, every_1_hour] }
 *               dependsOn:     { type: array, items: { type: string } }
 *     responses:
 *       201: { description: Job created }
 *       400: { description: Validation error }
 */
router.post("/", asyncHandler(async (req, res) => {
  const {
    type,
    priority = 2,
    payload = {},
    scheduledAt,
    recurringInterval,
    dependsOn = [],
  } = req.body;
 
  if (!type) {
    return res.status(400).json({ error: "type is required" });
  }
 
  if (![1, 2, 3].includes(Number(priority))) {
    return res.status(400).json({ error: "priority must be 1, 2, or 3" });
  }

  if (dependsOn.length > 0) {
    await detectCyclicDependencies("__new__", dependsOn);
  }
 
  const parsedScheduledAt = scheduledAt ? new Date(scheduledAt) : null;
  if (scheduledAt && isNaN(parsedScheduledAt)) {
    return res.status(400).json({ error: "scheduledAt must be a valid ISO date" });
  }
 
  const job = await Job.create({
    type,
    priority: Number(priority),
    effectivePriority: Number(priority),
    payload,
    scheduledAt: parsedScheduledAt,
    recurringInterval: recurringInterval || null,
    dependsOn,
  });

  const isDue = !parsedScheduledAt || parsedScheduledAt <= new Date();
  if (isDue && dependsOn.length === 0) {
    await enqueue(job);
  }
 
  await logJobEvent({
    jobId: job._id,
    event: "job_created",
    meta: {
      type,
      priority,
      scheduledAt: parsedScheduledAt,
      recurringInterval,
      dependsOn,
    },
  });
 
  logger.info({ jobId: job._id, type, priority }, "Job created");
 
  return res.status(201).json({ job });
}));
 
/**
 * @swagger
 * /jobs/{id}:
 *   get:
 *     summary: Get a single job by ID
 *     tags: [Jobs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Job document }
 *       404: { description: Not found }
 */
router.get("/:id", asyncHandler(async (req, res) => {
  const job = await Job.findById(req.params.id).lean();
  if (!job) return res.status(404).json({ error: 'Job not found' });
  return res.json({ job });
}));
 
export default router