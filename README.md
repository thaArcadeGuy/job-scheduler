# Job Scheduler

A lightweight background job scheduler with priority queue, DAG support, retry handling, dead-letter queue, and realtime monitoring.

## Features

- Priority-based scheduling with heap queue
- DAG workflows with dependency handling
- Scheduled and recurring jobs
- Retry logic with exponential backoff
- Dead-letter queue for failed jobs
- Separate worker process for execution
- Realtime dashboard and Swagger API docs

## Quick Start

### Prerequisites

- Node.js 20+
- MongoDB 8+
- Redis 7+

### Run locally

```bash
git clone https://github.com/thaArcadeGuy/job-scheduler.git
cd job-scheduler
npm install
cp .env.example .env
# update .env with MongoDB/Redis settings
npm run dev
npm run dev:worker
```

### Start databases (Docker)
```
docker run -d --name mongodb -p 27017:27017 mongo:7
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

### Run application
```
npm run dev        # Terminal 1 - API
npm run dev:worker # Terminal 2 - Worker
```

### API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/jobs` | List jobs |
| GET | `/api/jobs/stats` | Job counts by status |
| POST | `/api/jobs` | Create job |
| PATCH | `/api/jobs/:id/cancel` | Cancel job |
| GET | `/api/dlq` | List DLQ entries |
| POST | `/api/dlq/:id/retry` | Manual retry from DLQ |
| GET | `/health` | Health check |

### Project Structure
```
job-scheduler/
├── public/           # UI dashboard (HTML/CSS/JS)
├── src/
│   ├── algorithms/   # Heap + Timing Wheel
│   ├── config/       # DB, env config, swagger config  & Redis connections
│   ├── handlers/     # Job type dispatcher & email handler
│   ├── middleware/   # Error handler
│   ├── models/       # Job, DLQ, JobLog schemas
│   ├── queues/       # Redis queue operations
│   ├── routes/       # API endpoints
│   ├── schedulers/   # Main scheduler loop
│   ├── services/     # DLQ business logic
│   ├── utils/        # Logger, backoff, async handler
│   └── workers/      # Independent worker process
│   
├── benchmarks/       # Performance tests
├── server.js         # Entry point
├── .env.example
└── package.json
```

### Deployment
Deployed on AWS EC2 (Ubuntu 22.04) with:

- Nginx as reverse proxy
- Let's Encrypt for SSL
- PM2 for process management
- DuckDNS for dynamic DNS

```
# On EC2 instance
git clone https://github.com/thaArcadeGuy/job-scheduler.git
cd job-scheduler
npm install --production
pm2 start server.js --name job-scheduler-api
pm2 start src/workers/worker.js --name job-scheduler-worker
pm2 save
```