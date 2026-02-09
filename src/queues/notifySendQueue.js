import { Queue } from "bullmq";

const redisConnection = {
    url: process.env.REDIS_URL || "redis://127.0.0.1:6380",
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
};

export const notifySendQueue = new Queue("wa_notify_send", {
    connection: redisConnection,
});
