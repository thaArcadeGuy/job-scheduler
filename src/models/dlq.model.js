import mongoose from "mongoose"
import { v4 as uuidv4 } from "uuid"

const dlqSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => uuidv4(),
    },

    jobId: {
      type: String,
      required: true,
      index: true,
    },
 
    jobType: {
      type: String,
      required: true,
    },
 
    payload: {
      type: mongoose.Schema.Types.Mixed,
    },
 
    priority: {
      type: Number,
    },

    errorMessage: {
      type: String,
      required: true,
    },
 
    errorStack: {
      type: String,
    },
 
    totalAttempts: {
      type: Number,
      default: 3,
    },

    retryCount: {
      type: Number,
      default: 0,
    },
 
    lastRetriedAt: {
      type: Date,
      default: null,
    },

    dlqStatus: {
      type: String,
      enum: ['waiting', 'retrying', 'resolved', 'permanently_failed'],
      default: 'waiting',
    },
  },
  {
    timestamps: true,
    _id: false,
  }
);
 
dlqSchema.index({ dlqStatus: 1, createdAt: -1 });
 
export const DLQEntry = mongoose.model('DLQEntry', dlqSchema); 