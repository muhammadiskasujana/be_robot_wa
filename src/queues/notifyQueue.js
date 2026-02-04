import { Queue } from "bullmq";
import "dotenv/config";

const redisConnection = {
    // Bisa pakai url
    url: process.env.REDIS_URL || "redis://127.0.0.1:6380",

    // Tambahkan opsi yang sebelumnya kamu set di instance ioredis
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
};

export const notifyQueue = new Queue("wa_notify", {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
    },
});
