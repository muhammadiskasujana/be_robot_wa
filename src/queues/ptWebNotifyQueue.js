import { Queue } from "bullmq";

const redisConnection = {
    url: process.env.REDIS_URL || "redis://127.0.0.1:6380",
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
};

export const ptWebNotifyQueue = new Queue("pt_web_notify", {
    connection: redisConnection,
    defaultJobOptions: {
        removeOnComplete: { count: 10000 },
        removeOnFail: { count: 10000 },
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
    },
});