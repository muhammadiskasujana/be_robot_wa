import "dotenv/config";
import { Worker } from "bullmq";
import { redis } from "../queues/redis.js";
import { Op } from "sequelize";
import Sequelize from "sequelize";
import {
    WaGroup,
    WaGroupMode,
    LeasingCompany,
    LeasingBranch,
    WaGroupLeasingBranch,
    PtCompany,
    WaGroupSubscription,
    WaCommand,
    WaCommandPolicy,
    WaCreditWallet,
    sequelize,
    WaInstance,
} from "../models/index.js";
import { sendText } from "../services/greenapi.js";

import { checkAndDebit } from "../services/billingService.js";

console.log("[NOTIF_WORKER] boot", {
    pid: process.pid,
    REDIS_URL: process.env.REDIS_URL,
});

const redisConnection = {
    url: process.env.REDIS_URL || "redis://127.0.0.1:6380",
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
};

const COMMAND_KEY_NOTIF = "data_access_notif";


// ============ helpers ============
function up(v) { return String(v || "").trim().toUpperCase(); }
function nowISO() { return new Date().toISOString(); }

function googleMapsUrl(loc) {
    if (!loc) return "";

    // support 2 bentuk:
    // 1) { latitude, longitude }
    // 2) { lat, lng } atau { lat, long }
    const lat =
        typeof loc.latitude === "number"
            ? loc.latitude
            : typeof loc.lat === "number"
                ? loc.lat
                : null;

    const lng =
        typeof loc.longitude === "number"
            ? loc.longitude
            : typeof loc.lng === "number"
                ? loc.lng
                : typeof loc.long === "number"
                    ? loc.long
                    : null;

    if (lat == null || lng == null) return "";
    // sesuai contoh kamu: https://www.google.com/maps?q=lat,lng
    return `https://www.google.com/maps?q=${lat},${lng}`;
}

function bold(v, fallback = "-") {
    const s = String(v ?? "").trim();
    return `*${s || fallback}*`;
}

// ambil value pertama yang non-empty dari beberapa kandidat key
function pick(obj, keys, fallback = "") {
    for (const k of keys) {
        const v = obj?.[k];
        if (v == null) continue;
        const s = String(v).trim();
        if (s) return s;
    }
    return fallback;
}

function buildMessage(data) {
    const lines = [];

    // header
    lines.push(`*HUNTER INFO*`);

    // detail unit
    lines.push(`Nopol: ${bold(data.nopol)}`);
    if (data.nosin) lines.push(`Nosin: ${bold(data.nosin)}`);
    if (data.noka) lines.push(`Noka: ${bold(data.noka)}`);
    if (data.tipe) lines.push(`Tipe: ${bold(data.tipe)}`);

    // leasing & cabang (contoh kamu: "MUF 1225", "MAKASSAR")
    // kalau payload leasing kamu berisi code leasing saja, kamu bisa set format di producer payload
    lines.push(`Leasing: ${bold(data.leasing)}`);
    lines.push(`Cabang: ${bold(data.cabang)}`);

    if (data.ovd) lines.push(`Ovd: ${bold(data.ovd)}`);

    // tambahan field baru (samakan dengan payload kamu)
    const tahunWarna = pick(data, ["tahun_warna", "tahunWarna", "tahun", "warna"], "");
    if (tahunWarna) lines.push(`Tahun/Warna: ${bold(tahunWarna)}`);

    const contactPerson = pick(data, ["contact_person", "contactPerson", "cp", "no_hp_cp", "phone_cp"], "");
    if (contactPerson) lines.push(`Contact Person: ${bold(contactPerson)}`);

    // keterangan (di contoh kamu isinya tanggal, tapi kita tetap pakai field apa adanya + bold)
    if (data.keterangan) lines.push(`Keterangan: ${bold(data.keterangan)}`);

    // warning statis
    lines.push(
        `PERHATIAN *Aplikasi ini bukan alat sah penarikan. Patuhi peraturan dan SOP yang berlaku!*`
    );

    // report awal & tanggal report (opsional)
    const reportAwal = pick(data, ["report_awal", "reportAwal", "report", "note_report"], "");
    if (reportAwal) lines.push(`Report Awal: ${bold(reportAwal)}`);

    const tanggalReport = pick(data, ["tanggal_report", "tanggalReport", "reportDate"], "");
    if (tanggalReport) lines.push(`Tanggal Report: ${bold(tanggalReport)}`);

    lines.push(`*===============*`);

    // kalimat akses (yang kamu mau)
    // user + hp bisa dari berbagai key (biar fleksibel)
    const userName = pick(data, ["user", "nama_user", "username"], "-");
    const userHp = pick(data, ["no_hp", "hp", "phone", "user_phone"], "-");
    const ptName = pick(data, ["pt", "pt_name", "ptCompany", "pt_company"], "-");
    const aksesTanggal = pick(data, ["accessDate", "waktu_akses", "waktuAkses", "access_at"], "-");

    // lokasi & alamat
    const map = googleMapsUrl(data.accessLoc || data.access_loc || data.loc || data.location);
    const alamat = pick(
        data,
        ["accessAddr", "access_addr", "alamat", "address", "formatted_address"],
        ""
    );

    // Susun paragraf persis gaya contoh:
    // "Telah diakses oleh *erwin (08xx)* dari *PT ...* pada tanggal *...*. Lokasi akses data <url>. Alamat terpantau: ...."
    let paragraph = `Telah diakses oleh *${userName} (${userHp})* dari PT *${ptName}* pada tanggal *${aksesTanggal}*.`;

    if (map) paragraph += ` Lokasi akses data ${map}.`;
    if (alamat) paragraph += ` Alamat terpantau: ${alamat}.`;

    lines.push(paragraph);

    return lines.join("\n");
}

async function getNotifInstance() {
    const row = await WaInstance.findOne({
        where: {
            is_active: true,
            [Op.and]: [
                Sequelize.literal(`(meta->'roles') @> '["NOTIF"]'::jsonb`)
            ],
        },
        order: [["updated_at", "DESC"]],
    });

    if (!row) throw new Error("No active WaInstance with role NOTIF");
    return { idInstance: row.id_instance, apiToken: row.api_token };
}

// ============ target resolver ============
async function resolveTargetsForPayload(payload) {
    const leasingCode = up(payload.leasing);
    const cabangName = up(payload.cabang);
    const ptName = up(payload.pt);

    // cari mode ids dulu
    const [modeLeasing, modePt] = await Promise.all([
        WaGroupMode.findOne({ where: { key: "leasing", is_active: true }, attributes: ["id"] }),
        WaGroupMode.findOne({ where: { key: "pt", is_active: true }, attributes: ["id"] }),
    ]);

    const targets = [];

    // ------- LEASING mode groups -------
    if (modeLeasing?.id && leasingCode) {
        const leasing = await LeasingCompany.findOne({ where: { code: leasingCode, is_active: true } });
        if (leasing) {
            // ambil semua group leasing yang notif enabled
            const groups = await WaGroup.findAll({
                where: {
                    mode_id: modeLeasing.id,
                    leasing_id: leasing.id,
                    notif_data_access_enabled: true,
                    is_bot_enabled: true,
                },
            });

            if (groups.length) {
                // untuk cek cabang: ambil branch record payload (by name/code)
                const branch = await LeasingBranch.findOne({
                    where: {
                        leasing_id: leasing.id,
                        is_active: true,
                        // bisa by name atau code
                        [Op.or]: [
                            { name: cabangName },
                            { code: cabangName },
                        ],
                    },
                    attributes: ["id", "name", "code"],
                });

                for (const g of groups) {
                    const lvl = up(g.leasing_level);

                    if (lvl === "HO") {
                        targets.push({ group: g, reason: "leasing:HO" });
                        continue;
                    }

                    // AREA/CABANG: harus match pivot
                    if (!branch?.id) continue;

                    const allowed = await WaGroupLeasingBranch.findOne({
                        where: { group_id: g.id, leasing_branch_id: branch.id, is_active: true },
                        attributes: ["id"],
                    });

                    if (allowed) targets.push({ group: g, reason: `leasing:${lvl}` });
                }
            }
        }
    }

    // ------- PT mode groups -------
    if (modePt?.id && ptName) {
        // PT Company bisa pakai code/name. Saran: simpan code uppercase.
        const pt = await PtCompany.findOne({
            where: {
                is_active: true,
                [Op.or]: [
                    { code: ptName },
                    { name: ptName },
                ],
            },
            attributes: ["id", "code", "name"],
        });

        if (pt) {
            const groupsPt = await WaGroup.findAll({
                where: {
                    mode_id: modePt.id,
                    pt_company_id: pt.id,
                    notif_data_access_enabled: true,
                    is_bot_enabled: true,
                },
            });

            for (const g of groupsPt) {
                targets.push({ group: g, reason: "pt" });
            }
        }
    }

    // dedupe by group.id
    const seen = new Set();
    return targets.filter(t => {
        if (seen.has(t.group.id)) return false;
        seen.add(t.group.id);
        return true;
    });
}

// ============ Worker ============
export const worker = new Worker(
    "wa_notify",
    async (job) => {

        console.log("[NOTIF_WORKER] processing job", job.id, "name:", job.name);
        const payload = job.data || {};
        const { idInstance, apiToken } = await getNotifInstance();

        // resolve groups
        const targets = await resolveTargetsForPayload(payload);
        if (!targets.length) {
            console.log("[NOTIF_WORKER] job", job.id, "no targets");
            return { ok: true, sent: 0, note: "no targets" };
        }


        const msg = buildMessage(payload);

        let sent = 0;
        const results = [];

        for (const t of targets) {
            const g = t.group;

            // ===== billing policy check (FREE/CREDIT/SUBSCRIPTION + is_enabled) =====
            const bill = await checkAndDebit({
                commandKey: COMMAND_KEY_NOTIF,
                group: g,                  // butuh minimal { id, leasing_id } (group kamu sudah punya)
                webhook: null,
                ref_type: "NOTIF_ACCESS",
                ref_id: job.id,
                notes: `notif_access ${payload.leasing}|${payload.nopol}`,
            });

            // kalau policy error (command belum terdaftar, wallet error, dsb)
            if (!bill.ok) {
                results.push({
                    group_id: g.id,
                    chat_id: g.chat_id,
                    skipped: "billing_error",
                    error: bill.error,
                });
                continue;
            }

            // policy disabled / subscription expired / kredit habis
            if (!bill.allowed) {
                results.push({
                    group_id: g.id,
                    chat_id: g.chat_id,
                    skipped: "not_allowed",
                    billing_mode: bill.billing_mode,
                    reason: bill.error || "policy_not_allowed",
                });
                continue;
            }

            // ===== send notif =====
            await sendText({
                idInstance,
                apiToken,
                chatId: g.chat_id,
                message: msg,
            });

            sent++;
            results.push({
                group_id: g.id,
                chat_id: g.chat_id,
                ok: true,
                reason: t.reason,
                billing_mode: bill.billing_mode,
                charged: bill.charged || false,
                credit_cost: bill.credit_cost || 0,
                balance_after: bill.balance_after,
            });
        }
        console.log("[NOTIF_WORKER] job", job.id, "done. sent =", sent, "targets =", targets.length);
        return { ok: true, sent, totalTargets: targets.length, results };
    },
    {
        connection: redisConnection,

        // batas concurrency (jangan kebanyakan)
        concurrency: Number(process.env.NOTIF_WORKER_CONCURRENCY || 5),

        // limiter global rate limit (penting!)
        limiter: {
            max: Number(process.env.NOTIF_RATE_MAX || 20),       // max 20 job
            duration: Number(process.env.NOTIF_RATE_MS || 1000), // per 1 detik
        },
    }
);

worker.on("failed", (job, err) => {
    console.error("[NOTIF_WORKER] failed job", job?.id, err?.message);
});

worker.on("error", (err) => {
    console.error("[NOTIF_WORKER] worker error:", err?.message, err?.stack);
});

worker.on("active", (job) => {
    console.log("[NOTIF_WORKER] active job", job.id, "name:", job.name);
});

worker.on("completed", (job, result) => {
    console.log("[NOTIF_WORKER] completed job", job.id, "result:", result);
});
