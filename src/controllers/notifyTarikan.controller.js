import crypto from "crypto";
import { tarikanNotifyQueue } from "../queues/tarikanNotifyQueue.js";

function clean(value) {
    return String(value ?? "").trim();
}

function upper(value) {
    return clean(value).toUpperCase();
}

function normalizeLeasingCode(value) {
    const cleaned = upper(value).replace(/\s+/g, " ");
    if (!cleaned) return "";
    const parts = cleaned.split(" ").filter(Boolean);
    const first = (parts[0] || "").replace(/[^A-Z0-9-]/g, "");
    const second = (parts[1] || "").replace(/[^A-Z0-9-]/g, "");
    return second && !/^\d+$/.test(second) ? `${first}-${second}` : first;
}

function authorized(req) {
    const expected = clean(process.env.NOTIFY_API_TOKEN);
    if (!expected) return false;
    const auth = clean(req.headers.authorization);
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth;
    return token === expected;
}

function validate(body = {}) {
    const errors = [];
    const source = upper(body.source || "WEBSITE_PT");
    const nopol = upper(body.nopol || body.nomor_polisi).replace(/[^A-Z0-9]/g, "");
    const leasing = upper(body.leasing || body.nama_leasing);
    const leasing_code = normalizeLeasingCode(body.leasing_code || body.kode_leasing || leasing);
    const event_id = clean(body.event_id || body.tarikan_id || body.id);
    const input_at = clean(body.input_at || body.created_at || body.tanggal_input) || new Date().toISOString();

    if (!event_id) errors.push("event_id/tarikan_id wajib");
    if (!nopol) errors.push("nopol wajib");
    if (!source) errors.push("source wajib");

    return {
        ok: errors.length === 0,
        errors,
        payload: {
            event_id,
            source,
            input_at,
            input_by: clean(body.input_by || body.created_by_phone || body.no_hp),
            input_by_name: clean(body.input_by_name || body.created_by_name || body.created_by),
            tenant: clean(body.tenant || body.tenant_slug).toLowerCase(),
            pt: upper(body.pt || body.nama_pt),
            leasing,
            leasing_code,
            cabang: upper(body.cabang || body.branch),
            nopol,
            nosin: upper(body.nosin || body.nomor_mesin),
            noka: upper(body.noka || body.nomor_rangka),
            tipe: upper(body.tipe || body.tipe_kendaraan),
            tahun: clean(body.tahun),
            warna: upper(body.warna),
            nama_debitur: clean(body.nama_debitur || body.debitur),
            no_kontrak: clean(body.no_kontrak || body.nomor_kontrak),
            ovd: clean(body.ovd),
            keterangan: clean(body.keterangan || body.catatan),
        },
    };
}

export async function enqueueTarikanNotify(req, res) {
    if (!authorized(req)) return res.status(401).json({ ok: false, error: "invalid notify token" });

    const result = validate(req.body || {});
    if (!result.ok) return res.status(400).json({ ok: false, error: result.errors.join(", ") });

    const digest = crypto.createHash("sha256").update(result.payload.event_id).digest("hex");
    const dedupeKey = `dedupe:notif_tarikan:${digest}`;
    const redis = await tarikanNotifyQueue.client;
    const locked = await redis.set(dedupeKey, "1", "EX", 24 * 60 * 60, "NX");

    if (locked !== "OK") {
        return res.json({ ok: true, queued: false, skipped: true, reason: "duplicate_event" });
    }

    try {
        const job = await tarikanNotifyQueue.add("notify_tarikan_input", result.payload, {
            jobId: `tarikan_${digest}`,
        });
        return res.json({ ok: true, queued: true, jobId: job.id });
    } catch (error) {
        await redis.del(dedupeKey);
        throw error;
    }
}
