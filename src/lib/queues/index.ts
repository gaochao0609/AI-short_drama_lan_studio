import { TaskType } from "@prisma/client";
import { Queue } from "bullmq";
import { connection } from "@/lib/redis";

export { connection };

const bullmqConnection = connection as any;

export const queues = {
  script: new Queue("script-queue", { connection: bullmqConnection }),
  storyboard: new Queue("storyboard-queue", { connection: bullmqConnection }),
  image: new Queue("image-queue", { connection: bullmqConnection }),
  video: new Queue("video-queue", { connection: bullmqConnection }),
} as const;

const queueByTaskType = {
  [TaskType.SCRIPT_QUESTION]: queues.script,
  [TaskType.SCRIPT_FINALIZE]: queues.script,
  [TaskType.STORYBOARD]: queues.storyboard,
  [TaskType.IMAGE]: queues.image,
  [TaskType.VIDEO]: queues.video,
} as const;

export function getQueueForTaskType(type: TaskType) {
  return queueByTaskType[type];
}
