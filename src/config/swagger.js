import swaggerJsdoc from "swagger-jsdoc";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Job Scheduler API",
      version: "1.0.0",
      description:
        "Background job scheduler with heap-based priority queue, DAG workflows, retries, and Dead-Letter Queue.",
    },
    servers: [
      { url: "http://localhost:3000/api", description: "Local development" },
      { url: "https://your-domain.duckdns.org/api", description: "Production" },
    ],
    tags: [
      { name: "Jobs", description: "Job management" },
      { name: "DLQ", description: "Dead-Letter Queue" },
    ],
  },
  apis: ["./src/routes/*.routes.js"],
};

export const swaggerSpec = swaggerJsdoc(options);