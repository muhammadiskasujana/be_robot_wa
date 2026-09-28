import { Queue } from "bullmq";

const connection = {
    url: process.env.REDIS_URL || "redis://127.0.0.1:6380",
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
};

export const tarikanNotifySendQueue = new Queue("wa_tarikan_notify_send", {
    connection,
});
