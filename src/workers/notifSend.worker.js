import "dotenv/config";
import { Worker } from "bullmq";
import { Op } from "sequelize";
import Sequelize from "sequelize";
import IORedis from "ioredis";

import { WaInstance } from "../models/index.js";
import { sendText } from "../services/greenapi.js";
import { checkAndDebit } from "../services/billingService.js";

global.__notifRedis =
    global.__notifRedis ||
    new IORedis(process.env.REDIS_URL || "redis://127.0.0.1:6380", {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
    });

console.log("[NOTIF_SENDER] boot", { pid: process.pid, REDIS_URL: process.env.REDIS_URL });

const redisConnection = {
    url: process.env.REDIS_URL || "redis://127.0.0.1:6380",
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
};

const COMMAND_KEY_NOTIF = "data_access_notif";

let __instancesCache = { at: 0, rows: [] };

async function getNotifInstancesCached() {
    const ttlMs = Number(process.env.NOTIF_INSTANCE_CACHE_MS || 30_000);
    const now = Date.now();
    if (__instancesCache.rows.length && (now - __instancesCache.at) < ttlMs) {
        return __instancesCache.rows;
    }
    const rows = await WaInstance.findAll({
        where: {
            is_active: true,
            [Op.and]: [Sequelize.literal(`(meta->'roles') @> '["NOTIF"]'::jsonb`)]
        },
        order: [["updated_at", "DESC"]],
        attributes: ["id_instance", "api_token"],
    });
    __instancesCache = { at: now, rows: rows.map(r => r.toJSON()) };
    return __instancesCache.rows;
}

// ===== helper: build message (ambil dari worker kamu) =====
function bold(v, fallback = "-") {
    const s = String(v ?? "").trim();
    return `*${s || fallback}*`;
}

function pick(obj, keys, fallback = "") {
    for (const k of keys) {
        const v = obj?.[k];
        if (v == null) continue;
        const s = String(v).trim();
        if (s) return s;
    }
    return fallback;
}

function googleMapsUrl(loc) {
    if (!loc) return "";
    const lat =
        typeof loc.latitude === "number" ? loc.latitude :
            typeof loc.lat === "number" ? loc.lat : null;

    const lng =
        typeof loc.longitude === "number" ? loc.longitude :
            typeof loc.lng === "number" ? loc.lng :
                typeof loc.long === "number" ? loc.long : null;

    if (lat == null || lng == null) return "";
    return `https://www.google.com/maps?q=${lat},${lng}`;
}

function buildMessage(data, bill = null) {
    const lines = [];
    lines.push(`*HUNTER INFO*`);
    lines.push(`Nopol: ${bold(data.nopol)}`);
    if (data.nosin) lines.push(`Nosin: ${bold(data.nosin)}`);
    if (data.noka) lines.push(`Noka: ${bold(data.noka)}`);
    if (data.tipe) lines.push(`Tipe: ${bold(data.tipe)}`);
    lines.push(`Leasing: ${bold(data.leasing)}`);
    lines.push(`Cabang: ${bold(data.cabang)}`);
    if (data.ovd) lines.push(`Ovd: ${bold(data.ovd)}`);

    const tahunWarna = pick(data, ["tahun_warna", "tahunWarna", "tahun", "warna"], "");
    if (tahunWarna) lines.push(`Tahun/Warna: ${bold(tahunWarna)}`);

    const contactPerson = pick(data, ["contact_person", "contactPerson", "cp", "no_hp_cp", "phone_cp"], "");
    if (contactPerson) lines.push(`Contact Person: ${bold(contactPerson)}`);

    if (data.keterangan) lines.push(`Keterangan: ${bold(data.keterangan)}`);

    lines.push(`PERHATIAN *Aplikasi ini bukan alat sah penarikan. Patuhi peraturan dan SOP yang berlaku!*`);

    const reportAwal = pick(data, ["report_awal", "reportAwal", "report", "note_report"], "");
    if (reportAwal) lines.push(`Report Awal: ${bold(reportAwal)}`);

    const tanggalReport = pick(data, ["tanggal_report", "tanggalReport", "reportDate"], "");
    if (tanggalReport) lines.push(`Tanggal Report: ${bold(tanggalReport)}`);

    lines.push(`*===============*`);

    const userName = pick(data, ["user", "nama_user", "username"], "-");
    const userHp = pick(data, ["no_hp", "hp", "phone", "user_phone"], "-");
    const ptName = pick(data, ["pt", "pt_name", "ptCompany", "pt_company"], "-");
    const aksesTanggal = pick(data, ["accessDate", "waktu_akses", "waktuAkses", "access_at"], "-");

    const map = googleMapsUrl(data.accessLoc || data.access_loc || data.loc || data.location);
    const alamat = pick(data, ["accessAddr", "access_addr", "alamat", "address", "formatted_address"], "");

    let paragraph = `Telah diakses oleh *${userName} (${userHp})* dari PT *${ptName}* pada tanggal *${aksesTanggal}*.`;
    if (map) paragraph += ` Lokasi akses data ${map}.`;
    if (alamat) paragraph += ` Alamat terpantau: ${alamat}.`;

    lines.push(paragraph);

    // ===== footer billing (hanya CREDIT & charged) =====
    if (bill?.billing_mode === "CREDIT" && bill?.charged) {
        lines.push("");
        lines.push(`💳 *Info Kredit*`);
        lines.push(`Biaya: *${bill.credit_cost ?? 1}*`);
        lines.push(`Sisa: *${bill.balance_after ?? "-"}*`);
    }
    return lines.join("\n");
}

// ===== Sharding instance =====
function hashToIndex(str, mod) {
    let h = 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return mod ? (h % mod) : 0;
}

async function getNotifInstances() {
    const rows = await WaInstance.findAll({
        where: {
            is_active: true,
            [Op.and]: [Sequelize.literal(`(meta->'roles') @> '["NOTIF"]'::jsonb`)],
        },
        order: [["updated_at", "DESC"]],
        attributes: ["id_instance", "api_token"],
    });

    if (!rows.length) throw new Error("No active WaInstance with role NOTIF");
    return rows.map((r) => r.toJSON());
}

function pickInstanceForGroup(instances, groupId) {
    const idx = hashToIndex(groupId, instances.length);
    return instances[idx];
}

// ===== Rate limit per instance (Redis token bucket sederhana) =====
// pakai redis dari bullmq worker connection
async function takeRateToken(client, instanceId) {
    const max = Number(process.env.NOTIF_MSG_RATE_MAX || 10);     // token per window
    const windowMs = Number(process.env.NOTIF_MSG_RATE_MS || 1000); // window

    const key = `rl:notif:${instanceId}`;
    const now = Date.now();
    const ttlSec = Math.ceil(windowMs / 1000);

    // Lua: reset counter per window dengan EX, increment, cek max
    const lua = `
    local key = KEYS[1]
    local max = tonumber(ARGV[1])
    local ttl = tonumber(ARGV[2])

    local v = redis.call("INCR", key)
    if v == 1 then
      redis.call("EXPIRE", key, ttl)
    end
    if v > max then
      return 0
    end
    return 1
  `;

    while (true) {
        const ok = await client.eval(lua, 1, key, String(max), String(ttlSec));
        if (ok === 1) return true;
        await new Promise((r) => setTimeout(r, 50));
    }
}

function parseOvdNumber(raw) {
    // "C5/149" -> 149, "149"->149, "-"->null
    const s = String(raw ?? "").trim();
    if (!s || s === "-") return null;

    const m = s.match(/(\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;

    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
}

function buildOvdMatcher(ruleRaw) {
    const rule = String(ruleRaw ?? "").trim().toLowerCase().replace(/\s+/g, "");
    if (!rule) return null;

    // comparator: >10, >=10, <200, <=200, =10
    let m = rule.match(/^(>=|<=|>|<|=)(\d+(?:\.\d+)?)$/);
    if (m) {
        const op = m[1];
        const v = Number(m[2]);
        return (x) => {
            if (!Number.isFinite(x)) return false;
            if (op === ">") return x > v;
            if (op === ">=") return x >= v;
            if (op === "<") return x < v;
            if (op === "<=") return x <= v;
            if (op === "=") return x === v;
            return false;
        };
    }

    // range: 10<x<200, 10<=x<200, dst
    m = rule.match(/^(\d+(?:\.\d+)?)(<=|<)x(<=|<)(\d+(?:\.\d+)?)$/);
    if (m) {
        const left = Number(m[1]);
        const lop = m[2]; // < atau <=
        const rop = m[3]; // < atau <=
        const right = Number(m[4]);
        return (x) => {
            if (!Number.isFinite(x)) return false;
            const okL = lop === "<" ? x > left : x >= left;
            const okR = rop === "<" ? x < right : x <= right;
            return okL && okR;
        };
    }

    return null;
}

function getOvdRulesFromMeta(meta) {
    // support:
    // meta.ovd = ">10"
    // meta.ovd_filter = { enabled:true, rule:"10<x<200" }
    // meta.ovd_filter = { enabled:true, any:[">10","10<x<200"] }
    if (!meta) return null;

    // A) meta.ovd
    if (typeof meta.ovd === "string" && meta.ovd.trim()) {
        return { enabled: true, rules: [meta.ovd.trim()] };
    }

    const f = meta.ovd_filter;
    if (!f) return null;

    // B/C) meta.ovd_filter
    const enabled = f.enabled !== false; // default true
    if (!enabled) return null;

    if (typeof f.rule === "string" && f.rule.trim()) {
        return { enabled: true, rules: [f.rule.trim()] };
    }

    if (Array.isArray(f.any) && f.any.length) {
        const rules = f.any.map(x => String(x || "").trim()).filter(Boolean);
        if (rules.length) return { enabled: true, rules };
    }

    return null;
}

function passesOvdPolicy({ meta, payloadOvd }) {
    const conf = getOvdRulesFromMeta(meta);
    if (!conf?.enabled) return { ok: true, filtered: false }; // no filter

    const x = parseOvdNumber(payloadOvd);
    if (x == null) return { ok: false, filtered: true, reason: "ovd_missing" };

    // OR semantics: any rule matches -> allow
    for (const rule of conf.rules) {
        const matcher = buildOvdMatcher(rule);
        if (!matcher) {
            // rule invalid -> treat as config error => skip
            return { ok: false, filtered: true, reason: "ovd_rule_invalid", rule };
        }
        if (matcher(x)) return { ok: true, filtered: true, ovd: x, rule_hit: rule };
    }

    return { ok: false, filtered: true, reason: "ovd_not_match", ovd: x, rules: conf.rules };
}

// ===== Worker Sender =====
export const worker = new Worker(
    "wa_notify_send",
    async (job) => {
        const { payload, group, reason } = job.data || {};
        if (!payload?.nopol || !payload?.leasing || !group?.id || !group?.chat_id) {
            return { ok: false, error: "invalid job data" };
        }

        // billing per group
        const bill = await checkAndDebit({
            commandKey: COMMAND_KEY_NOTIF,
            group: { id: group.id, leasing_id: group.leasing_id || null },
            webhook: null,
            ref_type: "NOTIF_ACCESS",
            ref_id: job.id,
            notes: `notif_access ${payload.leasing}|${payload.nopol}`,
        });

        if (!bill.ok) return { ok: false, skipped: "billing_error", error: bill.error };
        if (!bill.allowed) return { ok: true, skipped: "not_allowed", billing_mode: bill.billing_mode, reason: bill.error };

        // ===== OVD filter dari policy.meta =====
        const ovdCheck = passesOvdPolicy({
            meta: bill.policy?.meta || null,
            payloadOvd: payload.ovd,
        });

        if (!ovdCheck.ok) {
            return {
                ok: true,
                skipped: "ovd_filtered",
                reason: ovdCheck.reason,
                ovd: ovdCheck.ovd ?? null,
                rule: ovdCheck.rule || bill.policy?.meta?.ovd || bill.policy?.meta?.ovd_filter || null,
                billing_mode: bill.billing_mode,
            };
        }

        // pilih instance (shard by group.id)
        const instances = await getNotifInstancesCached();
        const inst = pickInstanceForGroup(instances, group.id);

        const msg = buildMessage(payload, bill);

        // rate limit per instance (pakai redis client internal)
        const client = job.queue?.client ? await job.queue.client : null; // fallback
        // BullMQ Worker tidak expose queue client langsung, jadi ambil dari worker's connection:
        // hack aman: gunakan this.connection? -> gak ada di sini.
        // Cara aman: import redis client kamu sendiri (lebih bagus)
        // Minimal: pakai ioredis baru:
        // (lihat catatan di bawah)

        // --- versi aman: pakai ioredis baru yang sama URL (recommended) ---
        // (jika kamu gak mau bikin client baru per job, bikin global client)
        // Untuk sekarang, kita buat global di bawah (lihat setelah kode ini)

        await takeRateToken(global.__notifRedis, inst.id_instance);

        await sendText({
            idInstance: inst.id_instance,
            apiToken: inst.api_token,
            chatId: group.chat_id,
            message: msg,
        });

        return {
            ok: true,
            sent: true,
            group_id: group.id,
            chat_id: group.chat_id,
            instance: inst.id_instance,
            reason,
            billing_mode: bill.billing_mode,
            charged: bill.charged || false,
            balance_after: bill.balance_after,
        };
    },
    {
        connection: redisConnection,
        concurrency: Number(process.env.NOTIF_SEND_CONCURRENCY || 20), // paralel kirim
        // limiter BullMQ optional; kita sudah limiter per instance via Redis token bucket
    }
);
