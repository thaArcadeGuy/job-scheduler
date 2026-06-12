import express from "express"
import { DLQEntry } from "../models/dlq.model.js"
import { retryFromDLQ } from "../services/dlq.service.js"
import { asyncHandler } from "../utils/asyncHandler.js"

const router = express.Router()

/**
 * @swagger
 * /dlq/stats:
 *   get:
 *     summary: DLQ counts by status
 *     tags: [DLQ]
 */
router.get("/stats", asyncHandler(async (req, res) => {
  const counts = await DLQEntry.aggregate([
    { $group: { _id: "$dlqStatus", count: { $sum: 1 } } },
  ]);
 
  const stats = { waiting: 0, retrying: 0, resolved: 0, permanently_failed: 0 };
  for (const { _id, count } of counts) {
    if (_id in stats) stats[_id] = count;
  }
 
  return res.json(stats);
}));

/**
 * @swagger
 * /dlq:
 *   get:
 *     summary: List all DLQ entries
 *     tags: [DLQ]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [waiting, retrying, resolved, permanently_failed] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: DLQ entries }
 */
router.get("/", asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
 
  const filter = {};
  if (status) filter.dlqStatus = status;
 
  const skip = (Number(page) - 1) * Number(limit);
 
  const [entries, total] = await Promise.all([
    DLQEntry.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    DLQEntry.countDocuments(filter),
  ]);
 
  return res.json({
    entries,
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
 * /dlq/{id}:
 *   get:
 *     summary: Get a single DLQ entry with full error details
 *     tags: [DLQ]
 */
router.get("/:id", asyncHandler(async (req, res) => {
  const entry = await DLQEntry.findById(req.params.id).lean();
  if (!entry) return res.status(404).json({ error: "DLQ entry not found" });
  return res.json({ entry });
}));
 
/**
 * @swagger
 * /dlq/{id}/retry:
 *   post:
 *     summary: Manually retry a DLQ job
 *     tags: [DLQ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Retry job created }
 *       404: { description: DLQ entry not found }
 */
router.post("/:id/retry", asyncHandler(async (req, res) => {
  const newJob = await retryFromDLQ(req.params.id);
  return res.json({
    message: "DLQ job re-queued successfully",
    newJobId: newJob._id,
  });
}));
 
export default router