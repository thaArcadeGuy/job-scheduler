import { logger } from "../utils/logger.js";

export function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";
 
  logger.error(
    {
      err,
      method: req.method,
      url: req.originalUrl,
      status,
    },
    `Request error: ${message}`
  );
 
  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
}