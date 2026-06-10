import mongoose from "mongoose"
import { v4 as uuidv4 } from "uuid"

export const JOB_STATUSES = ["pending", "processing", "completed", "failed", "cancelled"]
 
export const RECURRING_INTERVALS = [
  "every_1_minute",
  "every_5_minutes",
  "every_1_hour",
]

const jobSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => uuidv4(),
    },
 
    type: {
      type: String,
      required: true,
      trim: true,
    },

    priority: {
      type: Number,
      enum: [1, 2, 3],
      default: 2,
    },
 
    effectivePriority: {
      type: Number,
      default: function () {
        return this.priority;
      },
    },
 
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
 
    status: {
      type: String,
      enum: JOB_STATUSES,
      default: 'pending',
    },

    retryCount: {
      type: Number,
      default: 0,
    },
    maxRetries: {
      type: Number,
      default: 3,
    },
    lastError: {
      type: String,
      default: null,
    },
    lastErrorStack: {
      type: String,
      default: null,
    },

    scheduledAt: {
      type: Date,
      default: null,
    },

    recurringInterval: {
      type: String,
      enum: [...RECURRING_INTERVALS, null],
      default: null,
    },

    dependsOn: {
      type: [String],
      default: [],
    },

    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
 
    cancelRequested: {
      type: Boolean,
      default: false,
    },
 
    lockedBy: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true, 
    _id: false,       
  }
);

jobSchema.index({ status: 1, effectivePriority: 1, scheduledAt: 1, createdAt: 1 });
jobSchema.index({ status: 1, createdAt: 1 });
jobSchema.index({ _id: 1, status: 1 });
 
jobSchema.virtual('isOverdue').get(function () {
  if (!this.scheduledAt) return true;
  return this.scheduledAt <= new Date();
});

jobSchema.statics.claimNextJob = async function (workerId) {
  const now = new Date();
 
  return this.findOneAndUpdate(
    {
      status: 'pending',
      cancelRequested: false,
      $or: [{ scheduledAt: null }, { scheduledAt: { $lte: now } }],
    },
    {
      $set: {
        status: 'processing',
        startedAt: now,
        lockedBy: workerId,
      },
    },
    {
      sort: { effectivePriority: 1, scheduledAt: 1, createdAt: 1 },
      new: true,
    }
  );
};
 
export const Job = mongoose.model('Job', jobSchema);