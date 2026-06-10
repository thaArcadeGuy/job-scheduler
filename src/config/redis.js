import Redis from "ioredis"
import { config } from "./index.js"
import { logger } from "../utils/logger.js"

let client = null

function getRedisClient() {
  if (client) return client

  client = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password || undefined,
    retryStrategy(times) {
      const delay = Math.min(1000 * 2 ** times, 30000);
      logger.warn({ attempt: times, delayMs: delay }, 'Redis reconnecting');
      return delay;
    },
    enableReadyCheck: true,
    maxRetriesPerRequest: null,
  });

  client.on("connect", () => logger.info("Redis connected"));
  client.on("error", (error) => logger.error({ error }, "Redis error"));
  client.on("close", () => logger.warn("Redis connection closed"));
 
  return client;
}

export async function connectToRedis() {
  const redis = getRedisClient();
  
  if (redis.status === 'ready') {
    logger.info("Redis already ready");
    return redis;
  }
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Redis connection timeout after 10 seconds'));
    }, 10000);
    
    redis.once('ready', () => {
      clearTimeout(timeout);
      logger.info("Redis ready for commands");
      resolve(redis);
    });
    
    redis.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export default getRedisClient 