import { Queue } from "bullmq";
import { connection } from "./queue.js";
import type { RunArchiveJobData } from "./types.js";

const QUEUE_NAME = "archive";

export const archiveQueue = new Queue<RunArchiveJobData>(QUEUE_NAME, { connection });

export async function enqueueRunArchive(data: RunArchiveJobData) {
  return archiveQueue.add("run-archive", data);
}
