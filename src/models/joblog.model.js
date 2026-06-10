import mongoose from "mongoose"

const jobLogSchema = new mongoose.Schema(
  {
    jobId: {
      type: String,
      required: true,
      index: true,
    },
 
    event: {
      type: String,
      required: true,
      enum: [
        'job_created',
        'job_started',
        'retry_attempted',
        'job_completed',
        'job_failed',
        'job_cancelled',
        'dlq_entered',
        'dlq_retry_triggered',
        'starvation_boost',
      ],
    },
 
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
 
    workerId: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);
 
jobLogSchema.index({ jobId: 1, createdAt: 1 });
jobLogSchema.index({ event: 1, createdAt: -1 });
 
export const JobLog = mongoose.model('JobLog', jobLogSchema);