import { notifyQueue } from "../queues/notifyQueue.js";
import crypto from "crypto";

function makeJobId(payload) {
    // bikin string deterministic
    const raw = payload.accessDate
        ? `access|${payload.leasing}|${payload.nopol}|${payload.accessDate}`
        : `access|${payload.leasing}|${payload.nopol}|${payload.user}|${payload.no_hp}`;

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
    const leasing = up(body.leasing);
    const cabang = up(body.cabang);
    const pt = reqStr(body.pt).toUpperCase();

    if (!nopol) errors.push("nopol wajib");
    if (!leasing) errors.push("leasing wajib");
    if (!cabang) errors.push("cabang wajib");
    // pt optional (karena mode leasing bisa tanpa pt)
    // tapi kalau kamu ingin wajib saat mode pt, nanti di worker kita cek.

    const no_hp = toPhone62(body.no_hp);
    const user = reqStr(body.user);

    const accessDate = reqStr(body.accessDate); // boleh kosong → fallback now di worker

    const accessLoc = body.accessLoc || null;
    if (accessLoc) {
        // validasi ringan
        if (typeof accessLoc.latitude !== "number") errors.push("accessLoc.latitude harus number");
        if (typeof accessLoc.longitude !== "number") errors.push("accessLoc.longitude harus number");
    }

    return {
        ok: errors.length === 0,
        errors,
        payload: {
            nopol,
            nosin: up(body.nosin),
            noka: up(body.noka),
            tipe: reqStr(body.tipe),
            leasing,
            cabang,
            ovd: reqStr(body.ovd),
            contactPerson: reqStr(body.contactPerson),
            keterangan: reqStr(body.keterangan),
            user,
            no_hp,
            pt,
            accessLoc,
            accessDate,
            raw: body, // optional simpan original kalau perlu
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
        leasing: v.payload.leasing,
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

    res.json({
        ok: true,
        queued: true,
        jobId: job.id,
    });
}
