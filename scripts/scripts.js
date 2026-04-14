import IORedis from "ioredis";
import { Queue } from "bullmq";

const redis = new IORedis("redis://127.0.0.1:6380", {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});

const q = new Queue("pt_web_notify", { connection: redis });

const run = async () => {
    console.log("waiting", await q.getWaitingCount());
    console.log("active", await q.getActiveCount());
    console.log("completed", await q.getCompletedCount());
    console.log("failed", await q.getFailedCount());
    console.log("delayed", await q.getDelayedCount());

    const jobs = await q.getJobs(["waiting", "active", "completed", "failed", "delayed"], 0, 10, true);
    console.log(
        jobs.map(j => ({
            id: j.id,
            name: j.name,
            state: j.finishedOn ? "finished" : "pending",
            failedReason: j.failedReason || null,
            returnvalue: j.returnvalue || null,
        }))
    );

    process.exit(0);
};

run();
