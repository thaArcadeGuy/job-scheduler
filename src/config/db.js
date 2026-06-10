import mongoose from "mongoose"
import { config } from "./index.js"
import { logger } from "../utils/logger.js"

export async function connectToDB() {
  try {
    await mongoose.connect(config.mongo.uri, {
      serverSelectionTimeoutMS: 5000,
    });
    logger.info({ uri: config.mongo.uri }, "MongoDB connected")
  } catch (error) {
    logger.error({ error }, "MongoDB connection failed");
    process.exit(1);
  }
}

mongoose.connection.on("disconnected", () => {
  logger.warn("MongoDB disconnected")
})

mongoose.connection.on("reconnected", () => {
  logger.info("MongoDB reconnected");
});