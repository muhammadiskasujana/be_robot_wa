import "dotenv/config";
import { Worker } from "bullmq";
import { createCommandProcessor } from "../services/waCommandProcessor.js";
import { sequelize, WaCommandEvent, WaInstance } from "../models/index.js";
import { commandConfig } from "../services/waCommandConfig.js";
import { commandConnection, commandQueue, commandQueueName, closeCommandQueues } from "../queues/waCommandQueue.js";
import { commandExecution, gatewayRequest } from "../services/waCommandTransport.js";
import { handleIncoming } from "../services/robot.js";
import { redis } from "../queues/redis.js";

const config = commandConfig();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const dispatchAttributes = ["id", "direction", "provider", "instance_key", "chat_id", "status"];

const processEvent = createCommandProcessor({ events: WaCommandEvent, instances: WaInstance, config, execution: commandExecution, handleIncoming, gatewayRequest, pause });

let dispatching = false;
async function dispatch() {
    if (dispatching) return;
    dispatching = true;
    try {
        const interrupted = await WaCommandEvent.findAll({ attributes: dispatchAttributes, where: { status: "processing" }, order: [["id", "ASC"]], limit: 1000 });
        for (const row of interrupted) {
            const job = await commandQueue(commandQueueName(row, config)).getJob(`event-${row.id}`);
            const state = job && await job.getState();
            if (!job || ["failed", "completed"].includes(state)) {
                await WaCommandEvent.update({ status: "unknown", error: "Execution marker without active queue job; inspect before replay" }, { where: { id: row.id, status: "processing" } });
            }
        }
        // One publisher across replicas; sequence in PostgreSQL determines enqueue order.
        await sequelize.transaction(async transaction => {
            const [locks] = await sequelize.query("SELECT pg_try_advisory_xact_lock(7105112026) AS locked", { transaction });
            if (!locks[0].locked) return;
            const pending = await WaCommandEvent.findAll({ attributes: dispatchAttributes, where: { status: "pending" }, order: [["id", "ASC"]], limit: 100, transaction });
            for (const row of pending) await row.update({ status: "queued" }, { transaction });
        });
        // Commit queued state before publishing. Recover interrupted publish on the next poll.
        await sequelize.transaction(async transaction => {
            const [locks] = await sequelize.query("SELECT pg_try_advisory_xact_lock(7105112026) AS locked", { transaction });
            if (!locks[0].locked) return;
            const rows = await WaCommandEvent.findAll({ attributes: dispatchAttributes, where: { status: "queued" }, order: [["id", "ASC"]], transaction });
            for (const row of rows) {
                const queue = commandQueue(commandQueueName(row, config));
                const existing = await queue.getJob(`event-${row.id}`);
                if (existing) {
                    if (["failed", "completed"].includes(await existing.getState())) {
                        await WaCommandEvent.update({ status: "failed", error: "Queue job ended before execution was claimed; inspect before replay" }, { where: { id: row.id, status: "queued" }, transaction });
                    }
                    continue;
                }
                await queue.add("command", { eventId: row.id }, { jobId: `event-${row.id}`, attempts: 1,
                    removeOnComplete: { age: 86400, count: 10000 }, removeOnFail: { age: 604800, count: 10000 } });
            }
        });
    } finally { dispatching = false; }
}

await sequelize.authenticate();
const names = Array.from({ length: config.shards }, (_, index) => `wa_command_in_${index}`);
if (config.provider === "baileys") names.push("wa_command_baileys_out");
const workers = [];
for (const name of names) {
    await commandQueue(name).setGlobalConcurrency(1);
    const worker = new Worker(name, processEvent, { connection: commandConnection, concurrency: 1 });
    worker.on("failed", (job, error) => console.error("[WA_COMMAND failed]", job?.id, error.message));
    worker.on("error", error => console.error("[WA_COMMAND error]", error.message));
    workers.push(worker);
}
const timer = setInterval(() => dispatch().catch(e => console.error("[WA_COMMAND dispatch]", e.message)), 500);
await dispatch();
console.log("[WA_COMMAND] ready", { provider: config.provider, queues: names });
async function shutdown() {
    clearInterval(timer);
    await Promise.all(workers.map(worker => worker.close()));
    await closeCommandQueues();
    await redis.quit();
    await sequelize.close();
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
