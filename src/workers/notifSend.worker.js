import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import Sequelize from "sequelize";
import { QueryTypes } from "sequelize";

import { checkAndDebit, resolvePolicyCached } from "../services/billingService.js";
import { WaCommandPolicy, sequelize } from "../models/index.js";

const { Op } = Sequelize;

// ====== HTTP client (native fetch Node 18+) ======
const WA_SEND_URL = "https://wa-gateway.ridjstudio.cloud/api/external/whatsapp/send/text";
const WA_BEARER = process.env.WA_EXT_BEARER || "whatsapp_ext_9f8a2b7c6d5e4a3b";
const WA_TENANT = process.env.WA_EXT_TENANT || "gateway";

// ====== hardcode session list (mulai 2 dulu) ======
const NOTIF_SESSIONS = [
    "beb662da-b7c7-4e71-99de-85fd1c2ceef1",
    // "57ce8603-4114-4389-a886-dfade882bf63",
];

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

// =====================
// helpers
// =====================
function up(v) {
    return String(v || "").trim().toUpperCase();
}
function low(v) {
    return String(v || "").trim().toLowerCase();
}

function normPhone62(s="") {
    const digits = String(s).replace(/[^\d]/g, "");
    if (!digits) return "";
    if (digits.startsWith("0")) return "62" + digits.slice(1);
    if (digits.startsWith("62")) return digits;
    return digits;
}

function toMentionJid(phone62 = "") {
    const p = normPhone62(phone62);
    if (!p) return null;
    return `${p}@s.whatsapp.net`; // mention format umum WA
}

// =====================
// PERSONAL assignee resolver by cabang
// =====================
// aturan:
// - cari WaCommandPolicy scope PERSONAL utk command yang sama
// - meta.cabang mengandung payload.cabang
// - (recommended) policy personal di-bind ke group_id, tapi tetap kita dukung null (global) & leasing match
// ✅ resolver yang lebih aman
async function resolvePersonalAssigneeForCabang({ command_id, cabang, group_id = null }) {
    const cab = up(cabang);
    if (!cab || !command_id) return null;

    const sql = `
        SELECT phone_e164
        FROM wa_command_policies
        WHERE scope_type = 'PERSONAL'
          AND command_id = :command_id
          AND is_enabled = true
          AND phone_e164 IS NOT NULL
            ${group_id ? "AND (group_id = :group_id OR group_id IS NULL)" : ""}
      AND jsonb_typeof(meta->'cabang') = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(meta->'cabang') AS x(val)
        WHERE UPPER(TRIM(x.val)) = :cabang
      )
        ORDER BY created_at DESC
            LIMIT 1
    `;

    const rows = await sequelize.query(sql, {
        replacements: { command_id, cabang: cab, ...(group_id ? { group_id } : {}) },
        type: QueryTypes.SELECT,
    });

    const phone = rows?.[0]?.phone_e164;
    if (!phone) return null;

    return {
        phone_e164: normPhone62(phone),
        cabang: cab,
    };
}

// =====================
// message builder (punyamu)
// =====================
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
    const lat = typeof loc.latitude === "number" ? loc.latitude : typeof loc.lat === "number" ? loc.lat : null;
    const lng =
        typeof loc.longitude === "number"
            ? loc.longitude
            : typeof loc.lng === "number"
                ? loc.lng
                : typeof loc.long === "number"
                    ? loc.long
                    : null;

    if (lat == null || lng == null) return "";
    return `https://www.google.com/maps?q=${lat},${lng}`;
}

async function sendWithFallback({ to, message, mentions = [] }) {
    const sessions = NOTIF_SESSIONS.filter(Boolean);
    const start = hashToIndex(to, sessions.length);

    let lastErr = null;
    for (let i = 0; i < sessions.length; i++) {
        const session_id = sessions[(start + i) % sessions.length];
        try {
            await takeRateToken(global.__notifRedis, session_id);
            await sendTextViaGateway({ session_id, to, message, mentions });
            return { ok: true, session_id };
        } catch (e) {
            lastErr = e;
            const msg = String(e?.message || "");
            if (msg.includes("forbidden")) continue;
            continue;
        }
    }
    throw lastErr || new Error("all sessions failed");
}

function buildMessage(data, bill = null, opt = {}) {
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

    if (bill?.billing_mode === "CREDIT" && bill?.charged) {
        lines.push("");
        if (opt?.mentionPhone) lines.push(`👤 PIC: @${normPhone62(opt.mentionPhone)}`);
        lines.push(`💳 *Info Kredit*`);
        lines.push(`Biaya: *${bill.credit_cost ?? 1}*`);
        lines.push(`Sisa: *${bill.balance_after ?? "-"}*`);
    }
    return lines.join("\n");
}

// =====================
// OVD filter (punyamu)
// =====================
function parseOvdNumber(raw) {
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

    m = rule.match(/^(\d+(?:\.\d+)?)(<=|<)x(<=|<)(\d+(?:\.\d+)?)$/);
    if (m) {
        const left = Number(m[1]);
        const lop = m[2];
        const rop = m[3];
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
    if (!meta) return null;
    if (typeof meta.ovd === "string" && meta.ovd.trim()) return { enabled: true, rules: [meta.ovd.trim()] };

    const f = meta.ovd_filter;
    if (!f) return null;

    const enabled = f.enabled !== false;
    if (!enabled) return null;

    if (typeof f.rule === "string" && f.rule.trim()) return { enabled: true, rules: [f.rule.trim()] };

    if (Array.isArray(f.any) && f.any.length) {
        const rules = f.any.map((x) => String(x || "").trim()).filter(Boolean);
        if (rules.length) return { enabled: true, rules };
    }
    return null;
}
function passesOvdPolicy({ meta, payloadOvd }) {
    const conf = getOvdRulesFromMeta(meta);
    if (!conf?.enabled) return { ok: true, filtered: false };

    const x = parseOvdNumber(payloadOvd);
    if (x == null) return { ok: false, filtered: true, reason: "ovd_missing" };

    for (const rule of conf.rules) {
        const matcher = buildOvdMatcher(rule);
        if (!matcher) return { ok: false, filtered: true, reason: "ovd_rule_invalid", rule };
        if (matcher(x)) return { ok: true, filtered: true, ovd: x, rule_hit: rule };
    }

    return { ok: false, filtered: true, reason: "ovd_not_match", ovd: x, rules: conf.rules };
}

// =====================
// sharding session
// =====================
function hashToIndex(str, mod) {
    let h = 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return mod ? h % mod : 0;
}
function pickSessionForGroup() {
    const session_id = NOTIF_SESSIONS[0];
    if (!session_id) throw new Error("NOTIF_SESSIONS kosong");
    return session_id;
}

// =====================
// rate limit per session
// =====================
async function takeRateToken(client, sessionId) {
    const max = Number(process.env.NOTIF_MSG_RATE_MAX || 10);
    const windowMs = Number(process.env.NOTIF_MSG_RATE_MS || 1000);
    const ttlSec = Math.ceil(windowMs / 1000);

    const key = `rl:notif_session:${sessionId}`;
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

// =====================
// send via gateway endpoint
// =====================
async function sendTextViaGateway({ session_id, to, message, mentions = [] }) {
    const r = await fetch(WA_SEND_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${WA_BEARER}`,
            "X-Tenant": WA_TENANT,
        },
        body: JSON.stringify({ session_id, to, message, mentions }),
    });

    const text = await r.text().catch(() => "");
    if (!r.ok) throw new Error(`wa-gateway send failed: ${r.status} ${text}`.trim());

    try { return JSON.parse(text); } catch { return { ok: true, raw: text }; }
}
// =====================
// Worker Sender (UPDATED: bill individu)
// =====================
export const worker = new Worker(
    "wa_notify_send",
    async (job) => {
        const { payload, group, reason } = job.data || {};
        if (!payload?.nopol || !payload?.leasing || !group?.id || !group?.chat_id) {
            return { ok: false, error: "invalid job data" };
        }

        const groupMini = { id: group.id, leasing_id: group.leasing_id || null };
        const cabangPayload = payload.cabang || "";

        // 0) Ambil policy base group (tanpa phone) untuk cek meta.bill
        const polBase = await resolvePolicyCached({
            group: groupMini,
            commandKey: COMMAND_KEY_NOTIF,
            phone_e164: null,
        });

        if (!polBase?.ok) return { ok: false, skipped: "policy_error", error: polBase?.error || "policy_error" };

        const isIndividu = low(polBase?.meta?.bill) === "individu";

        // 0b) Kalau individu -> cari penanggung cabang (PERSONAL policy meta.cabang)
        let billPhone = null;
        if (isIndividu) {
            const assignee = await resolvePersonalAssigneeForCabang({
                group: groupMini,
                command_id: polBase.command_id,
                cabang: cabangPayload,
            });

            if (!assignee?.phone_e164) {
                return {
                    ok: true,
                    skipped: "no_personal_assignee",
                    cabang: up(cabangPayload),
                    note: "bill individu aktif tapi belum ada PERSONAL policy yg assign cabang ini",
                };
            }

            billPhone = assignee.phone_e164;
        }

        // 1) PRECHECK tanpa debit
        const pre = await checkAndDebit({
            commandKey: COMMAND_KEY_NOTIF,
            group: groupMini,
            phone_e164: billPhone, // ✅ kalau individu: target personal
            wallet_scope_override: isIndividu ? "PERSONAL" : null, // ✅ paksa personal bila individu
            webhook: null,
            ref_type: "NOTIF_ACCESS",
            ref_id: job.id,
            notes: `notif_access ${payload.leasing}|${payload.nopol}|${payload.cabang || "-"}`,
            debit: false,
        });

        if (!pre.ok) return { ok: false, skipped: "billing_error", error: pre.error };
        if (!pre.allowed) {
            return {
                ok: true,
                skipped: "not_allowed",
                billing_mode: pre.billing_mode,
                reason: pre.error,
                bill_mode: isIndividu ? "individu" : "default",
                bill_phone: billPhone || null,
            };
        }

        // 2) OVD filter pakai policy dari precheck
        const ovdCheck = passesOvdPolicy({
            meta: pre.policy?.meta || null,
            payloadOvd: payload.ovd,
        });

        if (!ovdCheck.ok) {
            return {
                ok: true,
                skipped: "ovd_filtered",
                reason: ovdCheck.reason,
                ovd: ovdCheck.ovd ?? null,
                rule: ovdCheck.rule || pre.policy?.meta?.ovd || pre.policy?.meta?.ovd_filter || null,
                billing_mode: pre.billing_mode,
                charged: false,
                balance_after: pre.balance_after,
                bill_mode: isIndividu ? "individu" : "default",
                bill_phone: billPhone || null,
            };
        }

        // 3) Debit beneran (kalau CREDIT)
        const bill = await checkAndDebit({
            commandKey: COMMAND_KEY_NOTIF,
            group: groupMini,
            phone_e164: billPhone,
            wallet_scope_override: isIndividu ? "PERSONAL" : null,
            webhook: null,
            ref_type: "NOTIF_ACCESS",
            ref_id: job.id,
            notes: `notif_access ${payload.leasing}|${payload.nopol}|${payload.cabang || "-"}`,
            debit: true,
        });

        if (!bill.ok) return { ok: false, skipped: "billing_error", error: bill.error };
        if (!bill.allowed) {
            return {
                ok: true,
                skipped: "not_allowed",
                billing_mode: bill.billing_mode,
                reason: bill.error,
                bill_mode: isIndividu ? "individu" : "default",
                bill_phone: billPhone || null,
            };
        }

        // 4) send
        const session_id = pickSessionForGroup();
        await takeRateToken(global.__notifRedis, session_id);

        const mentionJid = isIndividu && billPhone ? toMentionJid(billPhone) : null;

        const msg = buildMessage(payload, bill, { mentionPhone: billPhone }); // opsional
        const sent = await sendWithFallback({
            to: group.chat_id,
            message: msg,
            mentions: mentionJid ? [mentionJid] : [],
        });

        return {
            ok: true,
            sent: true,
            group_id: group.id,
            chat_id: group.chat_id,
            session_id: sent.session_id,
            reason,
            billing_mode: bill.billing_mode,
            charged: bill.charged || false,
            balance_after: bill.balance_after,
            bill_mode: isIndividu ? "individu" : "default",
            bill_phone: billPhone || null,
            cabang: up(cabangPayload) || null,
        };
    },
    {
        connection: redisConnection,
        concurrency: Number(process.env.NOTIF_SEND_CONCURRENCY || 20),
    }
);

worker.on("active", (job) => console.log("[NOTIF_SENDER] active", job.id, job.name));
worker.on("completed", (job, res) => console.log("[NOTIF_SENDER] completed", job.id, res));
worker.on("failed", (job, err) => console.error("[NOTIF_SENDER] failed", job?.id, err?.message, err?.stack));
worker.on("error", (err) => console.error("[NOTIF_SENDER] worker error", err?.message, err?.stack));

process.on("unhandledRejection", (e) => console.error("[NOTIF_SENDER] unhandledRejection", e));
process.on("uncaughtException", (e) => console.error("[NOTIF_SENDER] uncaughtException", e));
