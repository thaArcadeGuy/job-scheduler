import { Job } from "../models/job.model.js";
import { MinHeap } from "../queues/heap.js";
import { enqueue, updateScore } from "../queues/redisQueue.js";
import { logJobEvent } from "../utils/jobLogger.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";


const TICK_MS = 500
const STARVATION_CHECK_MS = 5_000

const heap = new MinHeap();
 
const enqueuedSet = new Set();
 
let _tickTimer = null;
let _starvationTimer = null;
 
export function startScheduler() {
  logger.info("Scheduler loop started");
  _tickTimer = setInterval(tick, TICK_MS);
  _starvationTimer = setInterval(runStarvationPrevention, STARVATION_CHECK_MS);
}
 
export function stopScheduler() {
  if (_tickTimer) clearInterval(_tickTimer);
  if (_starvationTimer) clearInterval(_starvationTimer);
  logger.info("Scheduler loop stopped");
}
 

export function getHeapSnapshot() {
  return heap.snapshot();
}
 
async function tick() {
  try {
    const now = new Date();

    const dueJobs = await Job.find({
      status: "pending",
      $or: [{ scheduledAt: null }, { scheduledAt: { $lte: now } }],
    })
      .sort({ effectivePriority: 1, scheduledAt: 1, createdAt: 1 })
      .limit(100)
      .lean();
 
    for (const job of dueJobs) {
      if (enqueuedSet.has(job._id)) continue;
 
      enqueuedSet.add(job._id);
 
      heap.insert({
        id: job._id,
        effectivePriority: job.effectivePriority,
        scheduledAt: job.scheduledAt,
        createdAt: job.createdAt,
      });

      await enqueue(job);
    }

    const pendingIds = new Set(dueJobs.map((j) => j._id));
    for (const id of enqueuedSet) {
      if (!pendingIds.has(id)) {
        enqueuedSet.delete(id);
        heap.remove(id);
      }
    }
  } catch (err) {
    logger.error({ err }, "Scheduler tick error");
  }
}
 

async function runStarvationPrevention() {
  try {
    const threshold = config.starvationThresholdMs;
    const cutoff = new Date(Date.now() - threshold);
 
    const starvedJobs = await Job.find({
      status: 'pending',
      effectivePriority: { $gt: 0 }, 
      createdAt: { $lte: cutoff },
    }).lean();
 
    if (starvedJobs.length === 0) return;
 
    logger.info(
      { count: starvedJobs.length, thresholdMs: threshold },
      "Starvation prevention: boosting jobs"
    );
 
    for (const job of starvedJobs) {
      await Job.findByIdAndUpdate(job._id, { effectivePriority: 0 });

      heap.updatePriority(job._id, 0);

      await updateScore(job._id, 0, job.scheduledAt, job.createdAt);
 
      await logJobEvent({
        jobId: job._id,
        event: "starvation_boost",
        meta: {
          originalPriority: job.effectivePriority,
          waitedMs: Date.now() - new Date(job.createdAt).getTime(),
          thresholdMs: threshold,
        },
      });
    }
  } catch (error) {
    logger.error({ error }, "Starvation prevention error");
  }
}