import { notifyQueue } from "../queues/notifyQueue.js";
import crypto from "crypto";

// =====================
// helpers
// =====================
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

function verifyNotifyToken(req) {
    const expected = process.env.NOTIFY_API_TOKEN;
    if (!expected) return true; // fallback kalau env belum diset

    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
    return token === expected;
}

// =====================
// event helpers
// =====================
const ALLOWED_EVENTS = new Set([
    "AKTIVASI",
    "MATIKAN_AKUN",
    "HAPUS_AKUN",
    "REGISTRASI",
    "SUSPEND_AKUN",
]);

function getEventKey(body) {
    return up(body.event_key || body.event_type || body.type); // fleksibel
}

function getTanggal(body) {
    // kompat lama + universal baru
    return (
        reqStr(body.tanggal) ||
        reqStr(body.tanggal_aktivasi) ||
        reqStr(body.tanggal_registrasi) ||
        ""
    );
}

// =====================
// deterministic job id (generic)
// =====================
function makeJobIdMgmt(payload) {
    // idempotent: event + hp + tanggal + nama_user + nama_admin (+ optional hari/harga)
    const raw = [
        "mgmt",
        payload.event_key,
        payload.no_hp_user,
        payload.tanggal,
        payload.nama_user,
        payload.nama_admin,
        payload.jumlah_hari_aktivasi ?? "",
        payload.harga ?? "",
    ]
        .map((x) => String(x ?? "").trim())
        .join("|");

    return "mgmt_" + crypto.createHash("sha1").update(raw).digest("hex");
}

// =====================
// validation (generic)
// =====================
function validateMgmtEventBody(body) {
    const errors = [];

    const event_key = getEventKey(body);
    const nama_user = reqStr(body.nama_user);
    const no_hp_user = toPhone62(body.no_hp_user || body.hp_user || body.phone_user);
    const nama_admin = reqStr(body.nama_admin || body.admin || "SYSTEM");
    const tanggal = getTanggal(body);

    if (!event_key) errors.push("event_key wajib");
    if (event_key && !ALLOWED_EVENTS.has(event_key)) {
        errors.push(`event_key tidak dikenal: ${event_key}`);
    }

    if (!nama_user) errors.push("nama_user wajib");
    if (!no_hp_user) errors.push("no_hp_user wajib");
    if (!nama_admin) errors.push("nama_admin wajib");
    if (!tanggal) errors.push("tanggal wajib (atau tanggal_aktivasi/tanggal_registrasi)");

    // khusus AKTIVASI: tetap validasi field lama
    let jumlah_hari_aktivasi = null;
    let jumlah_kuota_akses_data = null;

    if (event_key === "AKTIVASI") {
        jumlah_hari_aktivasi = Number(body.jumlah_hari_aktivasi ?? 0);
        jumlah_kuota_akses_data =
            body.jumlah_kuota_akses_data == null ? null : Number(body.jumlah_kuota_akses_data);

        const harga = body.harga;

        if (!Number.isFinite(jumlah_hari_aktivasi) || jumlah_hari_aktivasi <= 0) {
            errors.push("jumlah_hari_aktivasi wajib & > 0 (untuk AKTIVASI)");
        }
        if (harga == null || String(harga).trim() === "") errors.push("harga wajib (untuk AKTIVASI)");

        if (jumlah_kuota_akses_data != null && !Number.isFinite(jumlah_kuota_akses_data)) {
            errors.push("jumlah_kuota_akses_data harus number");
        }
    }

    // payload universal (tetap bawa field lama biar buildManagementMessage bisa pakai)
    const payload = {
        event_type: "MANAGEMENT",
        event_key,

        nama_user,
        no_hp_user,
        nama_admin,
        tanggal,

        // optional common
        wilayah: reqStr(body.wilayah),
        alasan: reqStr(body.alasan),
        catatan: reqStr(body.catatan),

        // keep legacy AKTIVASI fields (kalau ada)
        jumlah_hari_aktivasi: jumlah_hari_aktivasi ?? body.jumlah_hari_aktivasi,
        jumlah_kuota_akses_data: jumlah_kuota_akses_data ?? body.jumlah_kuota_akses_data,
        harga: body.harga,

        // biar backward compatible sama builder lama yang masih baca tanggal_aktivasi
        tanggal_aktivasi: reqStr(body.tanggal_aktivasi) || (event_key === "AKTIVASI" ? tanggal : ""),
        tanggal_registrasi: reqStr(body.tanggal_registrasi) || (event_key === "REGISTRASI" ? tanggal : ""),

        raw: body, // optional
    };

    return { ok: errors.length === 0, errors, payload };
}

// =====================
// dedupe 1 jam (generic)
// =====================
const DEDUPE_TTL_SEC = 60 * 60;

function dedupeKeyMgmt(payload) {
    // 1 event per user per tanggal jangan spam
    return `dedupe:mgmt:${payload.event_key}:${payload.no_hp_user}:${payload.tanggal}`;
}

async function acquireDedupeMgmt(payload) {
    const key = dedupeKeyMgmt(payload);
    const client = await notifyQueue.client;
    const ok = await client.set(key, "1", "EX", DEDUPE_TTL_SEC, "NX");
    return { ok: ok === "OK", key };
}

// =====================
// controller (generic)
// =====================
export async function enqueueManagementEvent(req, res) {
    if (!verifyNotifyToken(req)) {
        return res.status(401).json({ ok: false, error: "invalid notify token" });
    }

    const v = validateMgmtEventBody(req.body || {});
    if (!v.ok) {
        return res.status(400).json({ ok: false, error: v.errors.join(", ") });
    }

    const lock = await acquireDedupeMgmt(v.payload);
    if (!lock.ok) {
        return res.json({
            ok: true,
            queued: false,
            skipped: true,
            reason: "dedupe_1h",
            key: lock.key,
            event_key: v.payload.event_key,
        });
    }

    const jobId = makeJobIdMgmt(v.payload);

    // ✅ job name cukup 1: notify_management
    // fanout -> management_event_send (sesuai worker kamu)
    const job = await notifyQueue.add("notify_management", v.payload, {
        jobId,
        removeOnComplete: { count: 5000 },
        removeOnFail: { count: 2000 },
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
    });

    return res.json({ ok: true, queued: true, jobId: job.id, event_key: v.payload.event_key });
}
