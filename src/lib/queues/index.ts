import { TaskType } from "@prisma/client";
import { Queue } from "bullmq";
import { bullmqConnection } from "@/lib/redis";

const assetScriptParseQueue = new Queue("asset-script-parse-queue", {
  connection: bullmqConnection,
});

export const queues = {
  script: new Queue("script-queue", { connection: bullmqConnection }),
  storyboard: new Queue("storyboard-queue", { connection: bullmqConnection }),
  image: new Queue("image-queue", { connection: bullmqConnection }),
  video: new Queue("video-queue", { connection: bullmqConnection }),
} as const;

export async function closeQueues() {
  await Promise.all([...Object.values(queues), assetScriptParseQueue].map((queue) => queue.close()));
}

const queueByTaskType = {
  [TaskType.SCRIPT_FINALIZE]: queues.script,
  [TaskType.ASSET_SCRIPT_PARSE]: assetScriptParseQueue,
  [TaskType.STORYBOARD]: queues.storyboard,
  [TaskType.IMAGE]: queues.image,
  [TaskType.VIDEO]: queues.video,
} as const;

export function getQueueForTaskType(type: TaskType) {
  return queueByTaskType[type];
}
