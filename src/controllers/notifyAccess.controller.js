import { notifyQueue } from "../queues/notifyQueue.js";
import crypto from "crypto";
import {enqueuePtWebNotify} from "../services/enqueuePtWebNotify.js";

function makeJobId(payload) {
    // bikin string deterministic

    const leasingKey = payload.leasing_code || payload.leasing;
    const raw = payload.accessDate
        ? `access|${leasingKey}|${payload.nopol}|${payload.accessDate}`
        : `access|${leasingKey}|${payload.nopol}|${payload.user}|${payload.no_hp}`;

    // hash biar aman utk BullMQ (no ':'), panjang tetap pendek
    return "access_" + crypto.createHash("sha1").update(raw).digest("hex");
}

function reqStr(v) {
    return String(v ?? "").trim();
}
function up(v) {
    return reqStr(v).toUpperCase();
}
function toPhone62(raw) {
    const digits = String(raw || "").replace(/[^\d]/g, "");
    if (!digits) return "";
    if (digits.startsWith("0")) return "62" + digits.slice(1);
    if (digits.startsWith("62")) return digits;
    return digits;
}

function validateBody(body) {
    const errors = [];

    const nopol = up(body.nopol);
    const leasingRaw = reqStr(body.leasing);
    const leasing = leasingRaw.replace(/\s+/g, " ").trim().toUpperCase(); // tampil full
    const leasing_code = normalizeLeasingCode(leasingRaw);               // lookup saja
    const cabang = up(body.cabang);
    const pt = reqStr(body.pt).toUpperCase();

    if (!nopol) errors.push("nopol wajib");
    if (!leasing) errors.push("leasing wajib");
    if (!cabang) errors.push("cabang wajib");

    const no_hp = toPhone62(body.no_hp);
    const user = reqStr(body.user);

    const accessDate = reqStr(body.accessDate); // boleh kosong → fallback now di worker

    const accessLoc = body.accessLoc || null;
    if (accessLoc) {
        if (typeof accessLoc.latitude !== "number") errors.push("accessLoc.latitude harus number");
        if (typeof accessLoc.longitude !== "number") errors.push("accessLoc.longitude harus number");
        // address nullable -> tidak wajib
    }

    const pic_pt = reqStr(body.pic_pt);
    const no_hp_pic_pt = toPhone62(body.no_hp_pic_pt);

    // ✅ NEW
    const reportDate = reqStr(body.reportDate);
    const reportMessage = reqStr(body.reportMessage);

    return {
        ok: errors.length === 0,
        errors,
        payload: {
            nopol,
            nosin: up(body.nosin),
            noka: up(body.noka),
            tipe: reqStr(body.tipe),

            leasing,         // full display
            leasing_code,    // code untuk lookup
            cabang,

            ovd: reqStr(body.ovd),
            contactPerson: reqStr(body.contactPerson),
            keterangan: reqStr(body.keterangan),

            user,
            no_hp,
            pt,

            accessLoc: accessLoc
                ? {
                    latitude: Number(accessLoc.latitude),
                    longitude: Number(accessLoc.longitude),
                    accuracy:
                        accessLoc.accuracy != null && Number.isFinite(Number(accessLoc.accuracy))
                            ? Number(accessLoc.accuracy)
                            : null,
                    speed:
                        accessLoc.speed != null && Number.isFinite(Number(accessLoc.speed))
                            ? Number(accessLoc.speed)
                            : null,
                    bearing:
                        accessLoc.bearing != null && Number.isFinite(Number(accessLoc.bearing))
                            ? Number(accessLoc.bearing)
                            : null,
                    address: reqStr(accessLoc.address), // nullable
                }
                : null,

            accessDate,

            // PIC PT
            pic_pt,
            no_hp_pic_pt,

            // ✅ NEW fields
            reportDate,
            reportMessage,

            raw: body,
        },
    };
}

const DEDUPE_TTL_SEC = 60 * 60; // 1 jam

function dedupeKey(leasing, nopol) {
    // leasing/nopol sudah uppercase dari validateBody
    return `dedupe:notif_access:${leasing}:${nopol}`;
}

async function acquireDedupe({ leasing, nopol }) {
    const key = dedupeKey(leasing, nopol);

    // BullMQ Queue punya client redis (Promise)
    const client = await notifyQueue.client;

    // SET key "1" NX EX 3600  -> hanya berhasil kalau belum ada
    const ok = await client.set(key, "1", "EX", DEDUPE_TTL_SEC, "NX");
    return { ok: ok === "OK", key };
}

function verifyNotifyToken(req) {
    const expected = process.env.NOTIFY_API_TOKEN;
    if (!expected) return true; // fallback kalau env belum diset

    // support:
    // Authorization: Bearer xxx
    // Authorization: xxx
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ")
        ? auth.slice(7).trim()
        : auth.trim();

    return token === expected;
}

function normalizeLeasingCode(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";

    const cleaned = s.replace(/\s+/g, " ").toUpperCase();
    const parts = cleaned.split(" ").filter(Boolean);
    if (!parts.length) return "";

    const p1 = (parts[0] || "").replace(/[^A-Z0-9-]/g, "");
    const p2 = (parts[1] || "").replace(/[^A-Z0-9-]/g, "");

    // Kalau format "ADIRA WO 1225" -> ADIRA-WO
    // Kalau "FIF 0226" -> FIF
    const isP2Numeric = p2 && /^[0-9]+$/.test(p2);
    const name = p2 && !isP2Numeric ? `${p1}-${p2}` : p1;

    return name.replace(/-+/g, "-");
}

export async function enqueueAccessNotify(req, res) {
    // ====== AUTH TOKEN CHECK ======
    if (!verifyNotifyToken(req)) {
        return res.status(401).json({
            ok: false,
            error: "invalid notify token",
        });
    }

    const v = validateBody(req.body || {});
    if (!v.ok) {
        return res.status(400).json({
            ok: false,
            error: v.errors.join(", "),
        });
    }

    // ====== DEDUPE 1 JAM (leasing + nopol) ======
    const lock = await acquireDedupe({
        leasing: v.payload.leasing_code || normalizeLeasingCode(v.payload.leasing),
        nopol: v.payload.nopol,
    });

    if (!lock.ok) {
        return res.json({
            ok: true,
            queued: false,
            skipped: true,
            reason: "dedupe_1h",
            key: lock.key,
        });
    }

    const jobId = makeJobId(v.payload);

    const job = await notifyQueue.add("notify_access", v.payload, {
        jobId,
        removeOnComplete: { count: 5000 },
        removeOnFail: { count: 2000 },
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
    });

    console.log("[ENQUEUE] payload:", v.payload);


    let ptWebQueued = null;
    try {
        console.log("[ENQUEUE] queue PT WEB start", {
            pt: v.payload.pt,
            nopol: v.payload.nopol,
            parent_job_id: job.id,
        });

        ptWebQueued = await enqueuePtWebNotify(v.payload, {
            parent_job_id: job.id,
        });

        console.log("[ENQUEUE] queue PT WEB success", ptWebQueued);
    } catch (e) {
        console.error("[enqueueAccessNotify] pt web enqueue error", e?.message || e);
    }

    res.json({
        ok: true,
        queued: true,
        jobId: job.id,
        ptWebQueued,
    });
}
