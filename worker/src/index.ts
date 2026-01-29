import { Worker } from "bullmq";
import { connection } from "./queue.js";
import type { RunArchiveJobData } from "./types.js";

export const QUEUE_NAME = "archive";
export type { RunArchiveJobData } from "./types.js";

const worker = new Worker<RunArchiveJobData>(
  QUEUE_NAME,
  async (job) => {
    const { userId, ruleId } = job.data;
    console.log("[run-archive] Processing job", job.id, { userId, ruleId });
    // Phase 1: stub — only log. Phase 4 will implement full engine.
    return { processed: true, userId, ruleId };
  },
  {
    connection,
    concurrency: 1,
  }
);

worker.on("completed", (job) => {
  console.log("[run-archive] Job completed", job.id);
});

worker.on("failed", (job, err) => {
  console.error("[run-archive] Job failed", job?.id, err);
});

console.log("Worker listening for jobs on queue:", QUEUE_NAME);
