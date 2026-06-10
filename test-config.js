import { config } from "./src/config/index.js";

console.log("=== Configuration Loaded ===");
console.log(`Port: ${config.port}`);
console.log(`Environment: ${config.nodeEnv}`);
console.log(`MongoDB URI: ${config.mongo.uri}`);
console.log(`Redis: ${config.redis.host}:${config.redis.port}`);
console.log(`Email alerts to: ${config.email.alertTo}`);
console.log(`DLQ Threshold: ${config.dlq.alertThreshold}`);
console.log(`Worker concurrency: ${config.worker.concurrency}`);
console.log(`Starvation threshold: ${config.starvationThresholdMs}ms`);