import { Queue } from "bullmq";

const connection = {
    url: process.env.REDIS_URL || "redis://127.0.0.1:6380",
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
};

export const tarikanNotifyQueue = new Queue("wa_tarikan_notify", {
    connection,
    defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { count: 10000 },
        removeOnFail: { count: 5000 },
    },
});
