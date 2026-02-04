import IORedis from "ioredis";
import "dotenv/config";

export const redis = new IORedis(process.env.REDIS_URL || "redis://127.0.0.1:6380", {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});
