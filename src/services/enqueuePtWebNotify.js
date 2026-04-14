import crypto from "crypto";
import { ptWebNotifyQueue } from "../queues/ptWebNotifyQueue.js";

function up(v) {
    return String(v || "").trim().toUpperCase();
}

function makeJobId(payload = {}) {
    const pt = up(payload.pt);
    const nopol = up(payload.nopol);
    const accessDate = String(payload.accessDate || "").trim();
    const raw = `ptweb|${pt}|${nopol}|${accessDate}`;
    return "ptweb_" + crypto.createHash("sha1").update(raw).digest("hex");
}

export async function enqueuePtWebNotify(payload, extra = {}) {
    const job = await ptWebNotifyQueue.add(
        "notify_pt_web_access_unit",
        {
            payload,
            source: "access-unit",
            ...extra,
        },
        {
            jobId: makeJobId(payload),
        }
    );

    return {
        ok: true,
        queued: true,
        queue: "pt_web_notify",
        jobId: job.id,
    };
}