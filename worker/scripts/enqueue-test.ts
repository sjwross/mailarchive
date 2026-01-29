/**
 * Enqueue a single run-archive job for testing. Run the worker first, then:
 *   npx tsx scripts/enqueue-test.ts
 */
import { enqueueRunArchive } from "../src/enqueue.js";

const job = await enqueueRunArchive({
  userId: "test-user-id",
  ruleId: "test-rule-id",
});
console.log("Enqueued job", job.id);
process.exit(0);
