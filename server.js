import dotenv from "dotenv"

import express from "express"
import cors from "cors"
import swaggerUi from "swagger-ui-express"

import { connectToDB } from "./src/config/db.js"
import getRedisClient, { connectToRedis } from "./src/config/redis.js"
import { swaggerSpec } from "./src/config/swagger.js"
import { startScheduler, stopScheduler, getSchedulerStatus} from "./src/schedulers/schedulerLoop.js"

import jobsRouter from "./src/routes/jobs.routes.js";
import dlqRouter from "./src/routes/dlq.routes.js";
import { errorHandler } from "./src/middlewares/errorHandler.js"
import { logger } from "./src/utils/logger.js"
import { config } from "./src/config/index.js"

dotenv.config()

const app = express()

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use((req, _res, next) => {
  logger.debug({ method: req.method, url: req.originalUrl }, "Incoming request");
  next();
});

app.use("/api/jobs", jobsRouter)
app.use("/api/dlq", dlqRouter)
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec))

app.get("/api/scheduler/status", (_req, res) => {
  res.json(getSchedulerStatus());
})

app.get("/api/openapi.json", (_req, res) => res.json(swaggerSpec))

app.get("/health", (_req, res) =>
  res.json({ 
    status: "ok", 
    ts: new Date().toISOString() 
  })
)

app.use((_req, res) => res.status(404).json({ 
  error: "Route not found"
}))

app.use(errorHandler)

async function bootstrap() {
  await connectToDB()
  await connectToRedis()
  
  const redis = getRedisClient()
  await redis.set("key", "value")
 
  startScheduler();
 
  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.nodeEnv },
      `Server running on http://localhost:${config.port}`
    );
    logger.info(`API docs: http://localhost:${config.port}/api/docs`);
  })

  const shutdown = (signal) => {
    logger.info({ signal }, "Shutting down server...")
    stopScheduler();
    server.close(() => {
      logger.info("HTTP server closed")
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000)
  };
 
  process.on("SIGTERM", () => shutdown("SIGTERM"))
  process.on("SIGINT",  () => shutdown("SIGINT"))
}

bootstrap().catch((err) => {
  logger.fatal({ err }, "Failed to start server")
  process.exit(1)
});

export default app