import { Queue } from "bullmq";
import { commandConfig, commandShard } from "../services/waCommandConfig.js";
export const commandConnection = {
    url: process.env.REDIS_URL || "redis://127.0.0.1:6380",
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
};
const queues = new Map();
export function commandQueueName(row, config = commandConfig()) {
    return row.direction === "out"
        ? "wa_command_baileys_out"
        : `wa_command_in_${commandShard(row.chat_id, config.shards)}`;
}
export function commandQueue(name) {
    if (!queues.has(name)) queues.set(name, new Queue(name, { connection: commandConnection }));
    return queues.get(name);
}
export async function closeCommandQueues() {
    await Promise.all([...queues.values()].map(q => q.close()));
}
