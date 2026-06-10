import getRedisClient from "../config/redis.js"
import { config } from "../config/index.js"
import { logger } from "../utils/logger.js"
 
const QUEUE_KEY = 'jobs:queue';
const LOCK_PREFIX = 'jobs:lock:';
 
export function buildScore(effectivePriority, scheduledAt, createdAt) {
  const priorityBand = effectivePriority * 1e13;
  const timeMs = scheduledAt
    ? new Date(scheduledAt).getTime()
    : new Date(createdAt).getTime();
  return priorityBand + timeMs;
}
 
export async function enqueue(job) {
  const redis = getRedisClient();
  const score = buildScore(job.effectivePriority, job.scheduledAt, job.createdAt);
  await redis.zadd(QUEUE_KEY, score, job._id);
  logger.debug({ jobId: job._id, score }, 'Job enqueued to Redis');
}
 
export async function dequeueAndLock(workerId) {
  const redis = getRedisClient();
  const lockTtl = config.worker.lockTtlSeconds;
 
  const luaScript = `
    local members = redis.call('ZRANGE', KEYS[1], 0, 0)
    if #members == 0 then return nil end
    local jobId = members[1]
    local lockKey = KEYS[2] .. jobId
    local acquired = redis.call('SET', lockKey, ARGV[1], 'NX', 'EX', ARGV[2])
    if acquired then
      redis.call('ZREM', KEYS[1], jobId)
      return jobId
    end
    return nil
  `;
 
  const result = await redis.eval(
    luaScript,
    2,
    QUEUE_KEY,
    LOCK_PREFIX,
    workerId,
    lockTtl
  );
 
  return result || null;
}
 
export async function releaseLock(jobId) {
  const redis = getRedisClient();
  await redis.del(`${LOCK_PREFIX}${jobId}`);
}
 
export async function removeFromQueue(jobId) {
  const redis = getRedisClient();
  await redis.zrem(QUEUE_KEY, jobId);
  await redis.del(`${LOCK_PREFIX}${jobId}`);
}
 
export async function updateScore(jobId, newEffectivePriority, scheduledAt, createdAt) {
  const redis = getRedisClient();
  const score = buildScore(newEffectivePriority, scheduledAt, createdAt);
  // ZADD with XX updates only if member exists
  await redis.zadd(QUEUE_KEY, 'XX', score, jobId);
}
 
export async function isLocked(jobId) {
  const redis = getRedisClient();
  const val = await redis.exists(`${LOCK_PREFIX}${jobId}`);
  return val === 1;
}
 
export async function queueSize() {
  const redis = getRedisClient();
  return redis.zcard(QUEUE_KEY);
}