import {
    WaPrivateWhitelist,
    WaMaster,
    WaGroup,
    WaGroupMode,
    LeasingCompany,
    LeasingBranch,
    WaGroupLeasingBranch,
    PtCompany,
    WaDeleteHistory,
} from "../models/index.js";

import { sendText } from "./greenapi.js";
import { fetchAccessReportXlsx } from "./tarikreport/reportsAccess.js";
import { fetchRekapDataXlsx } from "./rekapJumlahData/fetchRekapDataXlsx.js";
import { saveTempXlsx } from "./tempReportStore.js"; // sesuaikan path
import {normalizePhone, extractText, isGroupChat, parseCommandV2, normalizeText} from "./parser.js";

import { buildInputTemplate, parseFilledTemplate, sendToNewHunter } from "./inputData/inputData.js";
import { bulkDeleteNopol } from "./deleteNopol/deleteNopol.js"; // atau file helper baru
import { checkAndDebit } from "./billingService.js";
// robot.js (tambahkan import di atas)
import { getAccessHistoryByNopol } from "./history/newhunterHistory.js";
import { formatHistoryMessage, resolveLeasingFromItems } from "./history/historyFormatter.js";
// robot.js (tambahkan import di atas)
import { cekNopolFromApi, formatCekNopolMessage } from "./cekNopol/newhunterCekNopol.js";
import { isSenderAdminGroup } from "./greenapiGroups.js";

import {fetchJson,  fetchBool, fetchString, TTL, CacheKeys, CacheInvalidate } from "./cacheService.js";
import { getDeleteReasonByNumber, DELETE_REASONS } from "./deleteNopol/deleteReasons.js";
import { parseNopolFromText,parseLeasingCodeFromText,getQuotedText  } from "./deleteNopol/parserDelete.js";
import Sequelize from "sequelize";
const { Op } = Sequelize;


async function isMasterPhoneCached(phone) {
    if (!phone) return false;
    return fetchBool(
        CacheKeys.masterPhone(phone),
        async () => {
            const row = await WaMaster.findOne({
                where: { phone_e164: phone, is_active: true },
                attributes: ["id"],
            });
            return !!row;
        },
        TTL.AUTH_SHORT
    );
}

async function requireMasterOrReply({ master, ctx, sendText }) {
    if (master) return true;
    await sendText({ ...ctx, message: "❌ Hanya master yang dapat menjalankan perintah." });
    return false;
}

async function checkWhitelistCached(phone) {
    if (!phone) return false;
    return fetchBool(
        CacheKeys.whitelistPhone(phone),
        async () => {
            const row = await WaPrivateWhitelist.findOne({
                where: { phone_e164: phone, is_active: true },
                attributes: ["id"],
            });
            return !!row;
        },
        TTL.AUTH_SHORT
    );
}

async function getModeKeyCached(modeId) {
    if (!modeId) return "";
    return fetchString(
        CacheKeys.modeKey(modeId),
        async () => {
            const mode = await WaGroupMode.findByPk(modeId, { attributes: ["key"] });
            return mode?.key || "";
        },
        TTL.GROUP_MODE
    );
}

async function getOrCreateGroup(chatId, title) {
    let group = await WaGroup.findOne({ where: { chat_id: chatId } });
    if (group) return group;

    group = await WaGroup.create({
        chat_id: chatId,
        title: title || null,
        is_bot_enabled: false,
        notif_data_access_enabled: false,
        mode_id: null,
        leasing_id: null,
        leasing_level: null,
        leasing_branch_id: null,
    });
    return group;
}

function izinMode(group) {
    return String(group?.izin_group || "UMUM").trim().toUpperCase();
}

// command yang “kena aturan izin_group”
const GUARDED_COMMANDS = new Set([
    "cek_nopol",
    "history",
    "request_lokasi",
    "tarik_report",
    "delete_nopol",
    "input_data",
    "input_data_r2",
    "input_data_r4",
]);

async function enforceGroupPermission({ key, group, master, ctx, chatId, senderJid }) {
    // master selalu lolos
    if (master) return { ok: true };

    // kalau command tidak diguard, biarkan
    if (!GUARDED_COMMANDS.has(key)) return { ok: true };

    // UMUM = semua boleh
    const mode = izinMode(group);
    if (mode === "UMUM") return { ok: true };

    // ADMIN = hanya admin group
    const isAdmin = await isSenderAdminGroup({
        ctx,
        groupChatId: chatId,
        senderJid,
    });

    if (!isAdmin) {
        return { ok: false, error: "❌ Command ini hanya bisa dijalankan oleh admin group." };
    }

    return { ok: true };
}

async function ensureModeLeasing(group) {
    const mode = await WaGroupMode.findOne({ where: { key: "leasing", is_active: true } });
    if (!mode) return { ok: false, error: "Mode leasing belum ada di DB" };
    group.mode_id = mode.id;
    await group.save();
    return { ok: true, mode };
}

async function ensureModePT(group) {
    const mode = await WaGroupMode.findOne({
        where: { key: "pt", is_active: true },
    });

    if (!mode) return { ok: false, error: "Mode PT belum ada di DB" };

    group.mode_id = mode.id;

    // reset leasing supaya tidak bentrok
    group.leasing_id = null;
    group.leasing_level = null;
    group.leasing_branch_id = null;

    await group.save();
    return { ok: true, mode };
}

async function ensureModeGateway(group) {
    const mode = await WaGroupMode.findOne({ where: { key: "gateway", is_active: true } });
    if (!mode) return { ok: false, error: "Mode gateway belum ada di DB" };

    group.mode_id = mode.id;

    // optional: reset field yang bisa bentrok
    group.leasing_id = null;
    group.leasing_level = null;
    group.leasing_branch_id = null;
    group.pt_company_id = null;

    await group.save();
    return { ok: true, mode };
}

async function ensureModeInputData(group) {
    const mode = await WaGroupMode.findOne({ where: { key: "input_data", is_active: true } });
    if (!mode) return { ok: false, error: "Mode input_data belum ada di DB" };
    group.mode_id = mode.id;
    await group.save();
    return { ok: true, mode };
}

async function setLeasing(group, leasingCode) {
    const code = String(leasingCode || "")
        .trim()
        .replace(/\s+/g, " ")
        .toUpperCase();

    if (!code) return { ok: false, error: "Leasing code kosong" };

    const [leasing, created] = await LeasingCompany.findOrCreate({
        where: { code },
        defaults: { code, name: code, is_active: true },
    });

    if (!leasing.is_active) {
        leasing.is_active = true;
        if (!leasing.name) leasing.name = code;
        await leasing.save();
    }

    group.leasing_id = leasing.id;
    group.leasing_level = null;
    group.leasing_branch_id = null;

    await WaGroupLeasingBranch.destroy({ where: { group_id: group.id } });

    await group.save();
    return { ok: true, leasing, created };
}

async function unsetLeasing(group) {
    if (!group.leasing_id) {
        return { ok: false, error: "Group ini belum punya leasing." };
    }

    group.leasing_id = null;
    group.leasing_level = null;
    group.leasing_branch_id = null;

    // hapus relasi cabang
    await WaGroupLeasingBranch.destroy({
        where: { group_id: group.id },
    });

    await group.save();

    return { ok: true };
}

async function setPt(group, ptCode) {
    const code = String(ptCode || "").trim().replace(/\s+/g, " ").toUpperCase();
    if (!code) return { ok: false, error: "PT code kosong" };

    const [pt, created] = await PtCompany.findOrCreate({
        where: { code },
        defaults: { code, name: code, is_active: true },
    });

    if (!pt.is_active) await pt.update({ is_active: true });

    group.pt_company_id = pt.id;
    await group.save();

    return { ok: true, pt, created };
}

/**
 * Tambah cabang ke group untuk leasing yg sudah dipilih.
 * - "nasional" => HO (ALL branches for that leasing)
 * - 1 cabang => CABANG
 * - >1 => AREA
 * Cabang bisa ditulis:
 * - multiline: tambah cabang\nbanjarmasin\njakarta
 * - single-line: tambah cabang banjarmasin, jakarta
 */
async function addBranchesAutoLevel(group, inputFirstArg = "", inputLines = []) {
    if (!group.leasing_id) {
        return { ok: false, error: "Leasing belum diset. Jalankan: set leasing <kode>" };
    }

    const first = String(inputFirstArg || "").trim();
    const lines = Array.isArray(inputLines) ? inputLines : [];

    let tokens = [];
    if (first) tokens.push(first);
    if (lines.length) tokens.push(...lines);

    tokens = tokens
        .flatMap(t => String(t).split(","))
        .map(s => s.trim())
        .filter(Boolean);

    if (tokens.length === 0) {
        return { ok: false, error: "Format: tambah cabang <nama>\natau multiline setelahnya." };
    }

    // NASIONAL → HO
    if (tokens.length === 1 && tokens[0].toLowerCase() === "nasional") {
        group.leasing_level = "HO";
        group.leasing_branch_id = null;
        await WaGroupLeasingBranch.destroy({ where: { group_id: group.id } });
        await group.save();
        return { ok: true, level: "HO", branches: "ALL" };
    }

    const allBranches = await LeasingBranch.findAll({
        where: { leasing_id: group.leasing_id, is_active: true },
    });

    const byKey = new Map();
    for (const b of allBranches) {
        if (b.code) byKey.set(b.code.trim().toUpperCase(), b);
        if (b.name) byKey.set(b.name.trim().toUpperCase(), b);
    }

    const picked = [];

    for (const raw of tokens) {
        const name = raw.trim().toUpperCase();
        let b = byKey.get(name);

        // ✅ auto-create uppercase
        if (!b) {
            b = await LeasingBranch.create({
                leasing_id: group.leasing_id,
                code: null,
                name, // sudah uppercase
                is_active: true,
            });

            byKey.set(name, b);
        }

        picked.push(b);
    }

    const existing = await WaGroupLeasingBranch.findAll({
        where: { group_id: group.id, is_active: true },
    });
    const existingSet = new Set(existing.map(x => x.leasing_branch_id));

    const toInsert = picked.filter(b => !existingSet.has(b.id));

    if (toInsert.length > 0) {
        await WaGroupLeasingBranch.bulkCreate(
            toInsert.map(b => ({
                group_id: group.id,
                leasing_branch_id: b.id,
                is_active: true,
            })),
            { ignoreDuplicates: true }
        );
    }

    const activeRows = await WaGroupLeasingBranch.findAll({
        where: { group_id: group.id, is_active: true },
        include: [{ model: LeasingBranch, as: "branch" }],
        order: [["created_at", "ASC"]],
    });

    const activeCount = activeRows.length;

    if (activeCount <= 1) {
        group.leasing_level = "CABANG";
        group.leasing_branch_id = activeRows[0]?.leasing_branch_id || null;
    } else {
        group.leasing_level = "AREA";
        group.leasing_branch_id = null;
    }

    await group.save();

    const list = activeRows
        .map(r => r.branch?.name)
        .filter(Boolean);

    return { ok: true, level: group.leasing_level, branches: list };
}

async function removeBranchesAutoLevel(group, inputFirstArg = "", inputLines = []) {
    if (!group.leasing_id) {
        return { ok: false, error: "Leasing belum diset. Jalankan: set leasing <kode>" };
    }

    if (String(group.leasing_level || "").toUpperCase() === "HO") {
        return { ok: false, error: "Group sedang NASIONAL (HO). Tidak bisa hapus cabang." };
    }

    const first = String(inputFirstArg || "").trim();
    const lines = Array.isArray(inputLines) ? inputLines : [];

    let tokens = [];
    if (first) tokens.push(first);
    if (lines.length) tokens.push(...lines);

    tokens = tokens
        .flatMap(t => String(t).split(","))
        .map(s => s.trim())
        .filter(Boolean);

    if (tokens.length === 0) {
        return { ok: false, error: "Format: hapus cabang <nama>\natau multiline." };
    }

    const branches = [];

    for (const raw of tokens) {
        const name = raw.trim().toUpperCase();

        const b = await LeasingBranch.findOne({
            where: { leasing_id: group.leasing_id, is_active: true, name },
        });

        if (!b) {
            return { ok: false, error: `Cabang "${name}" tidak ditemukan (nama harus sama persis).` };
        }

        branches.push(b);
    }

    const idsToRemove = branches.map(b => b.id);

    const deleted = await WaGroupLeasingBranch.destroy({
        where: { group_id: group.id, leasing_branch_id: idsToRemove },
    });

    if (!deleted) {
        return { ok: false, error: "Cabang ditemukan, tapi tidak tertaut ke group ini." };
    }

    const activeRows = await WaGroupLeasingBranch.findAll({
        where: { group_id: group.id, is_active: true },
        include: [{ model: LeasingBranch, as: "branch" }],
        order: [["created_at", "ASC"]],
    });

    const activeCount = activeRows.length;

    if (activeCount === 0) {
        group.leasing_level = null;
        group.leasing_branch_id = null;
    } else if (activeCount === 1) {
        group.leasing_level = "CABANG";
        group.leasing_branch_id = activeRows[0].leasing_branch_id;
    } else {
        group.leasing_level = "AREA";
        group.leasing_branch_id = null;
    }

    await group.save();

    const list = activeRows.map(r => r.branch?.name).filter(Boolean);

    return { ok: true, deleted, level: group.leasing_level, branches: list };
}


async function listBranchesForGroup(group) {
    if (!group.leasing_id) {
        return { ok: false, error: "Leasing belum diset. Jalankan: set leasing <kode>" };
    }

    const leasing = await LeasingCompany.findByPk(group.leasing_id);
    const level = String(group.leasing_level || "").toUpperCase() || "-";

    if (level === "HO") {
        return { ok: true, leasing, level: "HO", branches: "ALL" };
    }

    const rows = await WaGroupLeasingBranch.findAll({
        where: { group_id: group.id, is_active: true },
        include: [{ model: LeasingBranch, as: "branch" }],
        order: [["created_at", "ASC"]],
    });

    const branches = rows
        .map((r) => r.branch?.code || r.branch?.name)
        .filter(Boolean);

    return { ok: true, leasing, level: level === "-" ? "-" : level, branches };
}

export async function tryConfirmQuotedDeleteReason({
                                                       webhook,
                                                       ctx,
                                                       group,
                                                       phone,
                                                       sendText,
                                                       bulkDeleteNopol,
                                                       WaDeleteHistory,
                                                       runPaidCommand,
                                                       getModeKeyCached,
                                                   }) {
    const body = extractText(webhook);
    const t = normalizeText(body);

    // hanya angka 1-7
    if (!/^[1-7]$/.test(t)) return false;

    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

    const pending = await WaDeleteHistory.findOne({
        where: {
            chat_id: group.chat_id,
            sender: phone,
            status: "PENDING",
            requested_at: { [Op.gte]: fiveMinAgo },
        },
        order: [["requested_at", "DESC"]],
    });

    if (!pending) {
        // kalau user balas angka tapi pending tidak ada / expired
        await sendText({ ...ctx, message: "Permintaan sudah kadaluarsa, ulangi hapus nopol." });
        return true; // ✅ dianggap handled supaya tidak lanjut ke command lain
    }

    const reason = getDeleteReasonByNumber(t);
    if (!reason) return false;

    const modeKey = String((await getModeKeyCached(group.mode_id)) || "").toLowerCase();
    const personalOnly = modeKey === "input_data";

    await runPaidCommand({
        commandKey: "delete_nopol",
        group,
        webhook,
        ctx,

        phone_e164: phone,
        wallet_scope_override: personalOnly ? "PERSONAL" : null,

        precheck_before_execute: personalOnly,
        precheck_units: 1,

        sendBalanceToPersonal: personalOnly,
        hideBalanceInGroup: personalOnly,
        groupSuccessSuffix: personalOnly ? "ℹ️ Sisa kredit kamu dikirim ke chat pribadi." : null,
        personalChatId: personalOnly ? (webhook?.senderData?.sender || null) : null,

        args: {
            leasingCode: pending.leasing_code,
            nopol: pending.nopol,
            reason,
            deleteHistoryId: pending.id,
        },

        replyBuilder: async ({ leasingCode, nopol, reason, deleteHistoryId }) => {
            try {
                // ✅ API selalu sukses kalau tidak throw
                await bulkDeleteNopol({ leasingCode, nopolList: [nopol] });

                await WaDeleteHistory.update(
                    {
                        delete_reason: reason,
                        status: "DONE",
                        confirmed_at: new Date(),
                    },
                    { where: { id: deleteHistoryId } }
                );

                return {
                    text: "Data berhasil dihapus",
                    chargeable: true,
                    chargeUnits: 1,
                };
            } catch (e) {
                await WaDeleteHistory.update(
                    {
                        delete_reason: reason,
                        status: "FAILED",
                        confirmed_at: new Date(),
                        meta: { error: e?.response?.data || e?.message || "ERROR" },
                    },
                    { where: { id: deleteHistoryId } }
                );

                return {
                    text: `❌ Gagal hapus nopol.\n${e?.response?.data?.error || e.message}`,
                    chargeable: false,
                    chargeUnits: 1,
                };
            }
        },
    });

    return true;
}


function parseNopolList(firstArg = "", lines = []) {
    let tokens = [];

    if (firstArg) tokens.push(firstArg);
    if (Array.isArray(lines) && lines.length) tokens.push(...lines);

    tokens = tokens
        .flatMap(t => String(t).split(","))
        .map(s => s.trim().toUpperCase())
        .filter(Boolean);

    // unik + validasi format ringan (opsional)
    const uniq = [...new Set(tokens)];

    return uniq;
}

// helper normalize nopol & phone
function normPlate(s="") {
    return String(s).trim().toUpperCase().replace(/\s+/g, "");
}
function normPhone62(s="") {
    const digits = String(s).replace(/[^\d]/g, "");
    if (!digits) return "";
    // kalau 08.. -> 62..
    if (digits.startsWith("0")) return "62" + digits.slice(1);
    // kalau sudah 62...
    if (digits.startsWith("62")) return digits;
    return digits; // fallback
}

async function runPaidCommand({
                                  commandKey,
                                  group,
                                  webhook,
                                  ctx,
                                  args,
                                  replyBuilder,
                                  phone_e164 = null,
                                  wallet_scope_override = null,

                                  // mode input_data
                                  sendBalanceToPersonal = false,
                                  personalChatId = null,
                                  groupSuccessSuffix = null,
                                  hideBalanceInGroup = false,

                                  // ✅ NEW
                                  precheck_before_execute = false,
                                  precheck_units = 1,
                              }) {
    const toPersonalChatId = (v) => {
        const s = String(v || "").trim();
        if (!s) return "";
        if (s.includes("@c.us") || s.includes("@lid")) return s;
        if (s.includes("@")) return s;
        return `${s}@c.us`;
    };

    const sendPersonal = async (message) => {
        const target = toPersonalChatId(personalChatId || phone_e164);
        if (!target) return false;
        await sendText({ ...ctx, chatId: target, message });
        return true;
    };

    // ===== PRECHECK SEBELUM EXECUTE (khusus kasus yang butuh) =====
    if (precheck_before_execute) {
        const pre = await checkAndDebit({
            commandKey,
            group,
            webhook,
            ref_type: "WA_MESSAGE",
            ref_id: webhook?.idMessage || null,
            notes: commandKey,
            phone_e164,
            debit: false,
            units: Math.max(1, parseInt(precheck_units, 10) || 1),
            wallet_scope_override,
        });

        if (!pre.ok) {
            await sendText({ ...ctx, message: `❌ ${pre.error || "Gagal billing"}` });
            return;
        }
        if (!pre.allowed) {
            // ✅ ini yang kamu mau: jelas kalau mode input_data & saldo personal kosong
            const ws = String(wallet_scope_override || "").toUpperCase();
            const extra =
                ws === "PERSONAL"
                    ? "\n\nℹ️ Mode input_data memakai *saldo personal* kamu. Silakan isi saldo personal terlebih dulu melalui nomor Admin +6285250505445"
                    : "";
            await sendText({ ...ctx, message: `❌ ${pre.error || "Tidak diizinkan"}${extra}` });
            return;
        }

        // kalau bukan CREDIT, ga perlu debit — tapi input_data biasanya CREDIT; tetap lanjut
        if (String(pre.billing_mode || "").toUpperCase() !== "CREDIT") {
            // boleh langsung execute tanpa debit
        }
    }

    // ===== EXECUTE (API) =====
    let result;
    try {
        result = await replyBuilder(args);
    } catch (e) {
        await sendText({ ...ctx, message: `❌ ${e?.message || "Terjadi error"}` });
        return;
    }

    const text = typeof result === "string" ? result : String(result?.text || "");
    const chargeable = typeof result === "string" ? false : !!result?.chargeable;
    const chargeUnits =
        typeof result === "string"
            ? 1
            : Math.max(1, parseInt(result?.chargeUnits, 10) || 1);

    // ===== kalau hasil tidak chargeable / bukan CREDIT =====
    const mode = await checkAndDebit({
        commandKey,
        group,
        webhook,
        ref_type: "WA_MESSAGE",
        ref_id: webhook?.idMessage || null,
        notes: commandKey,
        phone_e164,
        debit: false,
        units: chargeUnits,
        wallet_scope_override,
    });

    if (!mode.ok) {
        await sendText({ ...ctx, message: `❌ ${mode.error || "Gagal billing"}` });
        return;
    }
    if (!mode.allowed) {
        await sendText({ ...ctx, message: `❌ ${mode.error || "Tidak diizinkan"}` });
        return;
    }

    if (String(mode.billing_mode || "").toUpperCase() !== "CREDIT" || !chargeable) {
        await sendText({ ...ctx, message: text });
        return;
    }

    // ===== DEBIT BENERAN =====
    const bill = await checkAndDebit({
        commandKey,
        group,
        webhook,
        ref_type: "WA_MESSAGE",
        ref_id: webhook?.idMessage || null,
        notes: commandKey,
        phone_e164,
        debit: true,
        units: chargeUnits,
        wallet_scope_override,
    });

    if (!bill.ok || !bill.allowed) {
        await sendText({ ...ctx, message: `❌ ${bill.error || "Kredit tidak cukup"}` });
        return;
    }

    const balanceText = `💳 Kredit terpakai: ${bill.credit_cost}\nSisa: ${bill.balance_after}`;

    // GROUP output
    if (hideBalanceInGroup) {
        const suffix = groupSuccessSuffix ? `\n\n${groupSuccessSuffix}` : "";
        await sendText({ ...ctx, message: text + suffix });
    } else {
        const suffix = groupSuccessSuffix ? `\n\n${groupSuccessSuffix}` : "";
        await sendText({ ...ctx, message: `${text}\n\n${balanceText}${suffix}` });
    }

    // PERSONAL output
    if (sendBalanceToPersonal) {
        try {
            await sendPersonal(`✅ ${commandKey} sukses.\n${balanceText}`);
        } catch (e) {
            console.error("[runPaidCommand] send personal failed:", e?.message);
        }
    }
}

const t = (label) => {
    const start = Date.now();
    return () => console.log(label, Date.now() - start, "ms");
};

const TZ = process.env.TZ || "Asia/Pontianak";

const MONTH_ID = {
    januari: 1, feb: 2, februari: 2, mar: 3, maret: 3, apr: 4, april: 4,
    mei: 5, jun: 6, juni: 6, jul: 7, juli: 7, agu: 8, agustus: 8,
    sep: 9, september: 9, okt: 10, oktober: 10, nov: 11, november: 11,
    des: 12, desember: 12,
};

function nowParts() {
    const d = new Date();
    const y = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric" }).format(d);
    const m = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, month: "2-digit" }).format(d);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, day: "2-digit" }).format(d);
    return { year: parseInt(y, 10), month: parseInt(m, 10), day: parseInt(day, 10) };
}

function parseReportDate(inputRaw = "") {
    const s = String(inputRaw || "").trim().toLowerCase();

    // "hari ini"
    if (!s || s === "hari ini" || s === "hariini") {
        const p = nowParts();
        return { ok: true, tahun: p.year, bulan: p.month, tanggal: p.day };
    }

    // "11 juli 2025"
    let m = s.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i);
    if (m) {
        const tanggal = parseInt(m[1], 10);
        const bulan = MONTH_ID[m[2]];
        const tahun = parseInt(m[3], 10);
        if (!bulan || tanggal < 1 || tanggal > 31) return { ok: false, error: "Format tanggal tidak valid" };
        return { ok: true, tahun, bulan, tanggal };
    }

    // "juli 2025"
    m = s.match(/^([a-z]+)\s+(\d{4})$/i);
    if (m) {
        const bulan = MONTH_ID[m[1]];
        const tahun = parseInt(m[2], 10);
        if (!bulan) return { ok: false, error: "Nama bulan tidak dikenal" };
        return { ok: true, tahun, bulan, tanggal: "" }; // monthly
    }

    return { ok: false, error: "Format: tarik report juli 2025 | tarik report 11 juli 2025 | tarik report hari ini" };
}


export async function handleIncoming({ instance, webhook }) {
    const chatId = webhook?.senderData?.chatId;
    const senderJid = webhook?.senderData?.sender;
    const chatName = webhook?.senderData?.chatName;

    const phone = normalizePhone(senderJid);
    const text = extractText(webhook);
    if (!chatId || !phone) return;

    const ctx = {
        idInstance: instance.id_instance,
        apiToken: instance.api_token,
        chatId,
    };

    const isGroup = isGroupChat(chatId);

    // ===== PRIVATE =====
    if (!isGroup) {
        console.log("[WA] senderJid=", senderJid, "normalized phone=", phone);
        const allowed = await checkWhitelistCached(phone);
        if (!allowed) {
            await sendText({ ...ctx, message: "❌ Nomor kamu belum terdaftar (whitelist)." });
            return;
        }

        const { key } = parseCommandV2(text);
        if (key === "ping") {
            await sendText({ ...ctx, message: "pong ✅" });
            return;
        }
        await sendText({ ...ctx, message: `OK (private). Kamu kirim: ${text}` });
        return;
    }

    // ===== GROUP =====
    const group = await getOrCreateGroup(chatId, chatName);
    const modeKey = String(await getModeKeyCached(group.mode_id) || "").toLowerCase();
    const { key, args, argsLines, meta } = parseCommandV2(text, { modeKey });


    const handled = await tryConfirmQuotedDeleteReason({
        webhook, ctx, group, phone,
        sendText, bulkDeleteNopol,
        WaDeleteHistory, runPaidCommand,
        getModeKeyCached,
    });

    if (handled) return;

    // jika bot mati, stop (kecuali help/aktifkan robot dsb yang sudah kamu handle)
    if (!group.is_bot_enabled) {
        // tetap boleh proses "aktifkan robot" / "help" di code kamu sebelumnya
        // jadi taruh block ini setelah handle "robot_on/robot_off/help"
    }

    // ✅ DETEKSI TEMPLATE SUBMISSION (tanpa perlu command)
    const filled = parseFilledTemplate(text);
    if (filled && (filled.type === "R2" || filled.type === "R4")) {

        const { data } = filled;

        // leasing auto dari group saat mode leasing
        if (modeKey === "leasing") {
            if (!group.leasing_id) {
                await sendText({ ...ctx, message: "❌ Group ini belum diset leasing. Jalankan: set leasing <kode>" });
                return;
            }
            const leasing = await LeasingCompany.findByPk(group.leasing_id);
            data.leasing = leasing?.code ? String(leasing.code).toUpperCase() : null;
        } else {
            // mode input_data wajib ada leasing di template
            if (!data.leasing) {
                await sendText({ ...ctx, message: "❌ Field LEASING wajib diisi untuk mode input data." });
                return;
            }
        }

        // validasi minimal
        const required = ["nopol", "nosin", "noka", "tipe", "cabang", "ovd"];
        const missing = required.filter(k => !data[k]);
        if (missing.length) {
            await sendText({
                ...ctx,
                message: `❌ Data belum lengkap. Kurang: ${missing.join(", ").toUpperCase()}`,
            });
            return;
        }

        const payload = {
            nopol: data.nopol,
            nosin: data.nosin,
            noka: data.noka,
            tipe: data.tipe,
            leasing: String(data.leasing || "").toUpperCase(),
            cabang: String(data.cabang || "").toUpperCase(),
            ovd: String(data.ovd || "").toUpperCase(),
            keterangan: data.keterangan || "",
            type: filled.type, // ✅ R2 / R4
            visibility: "Publik",
        };

        // ✅ billing: charge hanya kalau sukses kirim ke server
        await runPaidCommand({
            commandKey: "input_data", // <- pastikan command ini ada di WaCommand & policy kamu
            group,
            webhook,
            ctx,
            phone_e164: phone,
            wallet_scope_override: modeKey === "input_data" ? "PERSONAL" : null, // ✅ kunci requirement

            precheck_before_execute: modeKey === "input_data",
            precheck_units: 1,

            // ✅ khusus mode input_data
            sendBalanceToPersonal: modeKey === "input_data",
            hideBalanceInGroup: modeKey === "input_data",
            groupSuccessSuffix: modeKey === "input_data"
                ? "ℹ️ Sisa kredit kamu dikirim ke chat pribadi."
                : null,

            personalChatId: webhook?.senderData?.sender || null,

            args: { payload },
            replyBuilder: async ({ payload }) => {
                try {
                    const apiRes = await sendToNewHunter({
                        phone,
                        senderId: chatId,
                        payload,
                    });

                    return {
                        text: `✅ Data berhasil dikirim.\nRef: ${apiRes?.id || apiRes?.ref || "-"}`,
                        chargeable: true, // ✅ hanya ini yang potong kredit
                    };
                } catch (e) {
                    const status = e?.response?.status;
                    const resp = e?.response?.data;
                    const msg =
                        typeof resp === "string"
                            ? resp
                            : (resp?.error || resp?.message || "");

                    // ❌ nopol sudah ada -> jangan charge
                    if (status === 400 && /nopol\s*sudah\s*ada/i.test(msg)) {
                        return {
                            text: `ℹ️ Data sudah ada di sistem (NOPOL: ${payload.nopol}).`,
                            chargeable: false,
                        };
                    }

                    // ❌ selain itu gagal -> jangan charge
                    console.error("SEND DATA ERROR", { status, data: resp, message: e?.message });

                    return {
                        text: `❌ Gagal kirim data ke server.\n${msg || e.message}`,
                        chargeable: false,
                    };
                }
            },
        });

        return;
    }

    if (!key) return; // ignore chat biasa

    const master = await isMasterPhoneCached(phone);

    // help boleh tampil meski bot off
    if (key === "help") {
        await sendText({
            ...ctx,
            message:
                "Command group (tanpa /):\n" +
                "- aktifkan robot (master)\n" +
                "- matikan robot (master)\n" +
                "- set mode leasing (master)\n" +
                "- set leasing <kode> (master)\n" +
                "- tambah cabang <nama/kode|nasional> (master)\n" +
                "  (bisa multiline: tulis cabang per baris)\n" +
                "- ping",
        });
        return;
    }

    // on/off robot
    if (key === "robot_on") {
        if (!(await requireMasterOrReply({ master, ctx, sendText }))) return;
        group.is_bot_enabled = true;
        await group.save();
        await sendText({ ...ctx, message: "✅ Robot diaktifkan untuk group ini." });
        return;
    }
    if (key === "robot_off") {
        if (!(await requireMasterOrReply({ master, ctx, sendText }))) return;
        group.is_bot_enabled = false;
        await group.save();
        await sendText({ ...ctx, message: "⛔ Robot dimatikan untuk group ini." });
        return;
    }

    // kalau bot mati, stop selain command master yang menghidupkan / help
    if (!group.is_bot_enabled) return;

    // ===== Permission guard berbasis izin_group (UMUM/ADMIN) =====
    const perm = await enforceGroupPermission({
        key,
        group,
        master,
        ctx,
        chatId,
        senderJid: webhook?.senderData?.sender,
    });

    if (!perm.ok) {
        console.log(perm.error)
        await sendText({ ...ctx, message: perm.error });
        return;
    }

    if (key === "ping") {
        await sendText({ ...ctx, message: "pong ✅" });
        return;
    }

    // ===== set izin umum/admin (master-only) =====
    // ===== set izin umum/admin (master-only) =====
    if (key === "set_izin") {
        if (!(await requireMasterOrReply({ master, ctx, sendText }))) return;

        // ambil arg dari args, argsLines, atau dari text mentah
        const joinedArgs = []
            .concat(args || [])
            .concat(argsLines || [])
            .filter(Boolean)
            .join(" ")
            .trim()
            .toLowerCase();

        // fallback terakhir: cari "set izin xxx" dari text
        const fallback = String(text || "").trim().toLowerCase();
        const m = fallback.match(/^set\s+izin\s+(umum|admin)\b/);

        const pick = joinedArgs || (m ? m[1] : "");
        const v = pick === "admin" ? "ADMIN" : pick === "umum" ? "UMUM" : null;

        if (!v) {
            await sendText({ ...ctx, message: "❌ Format: set izin umum | set izin admin" });
            return;
        }

        group.izin_group = v;
        await group.save();

        await sendText({
            ...ctx,
            message:
                v === "ADMIN"
                    ? "✅ Izin group diset: ADMIN.\nSekarang command umum hanya bisa dipakai admin group."
                    : "✅ Izin group diset: UMUM.\nSekarang semua member group bisa pakai command umum.",
        });
        return;
    }


    // set mode leasing / input data / pt / gateway
    if (key === "set_mode") {
        if (!(await requireMasterOrReply({ master, ctx, sendText }))) return;

        // args bisa ["input","data"] atau ["leasing"] atau ["pt"] atau ["gateway"]
        const raw = [args[0], args[1]].filter(Boolean).join(" ").toLowerCase().trim();

        if (raw === "leasing") {
            const r = await ensureModeLeasing(group);
            if (!r.ok) {
                await sendText({ ...ctx, message: `❌ ${r.error}` });
                return;
            }
            await sendText({ ...ctx, message: "✅ Mode group diset: leasing" });
            return;
        }

        if (raw === "input data" || raw === "input_data") {
            const r = await ensureModeInputData(group);
            if (!r.ok) {
                await sendText({ ...ctx, message: `❌ ${r.error}` });
                return;
            }
            await sendText({ ...ctx, message: "✅ Mode group diset: input data" });
            return;
        }

        if (raw === "pt") {
            const r = await ensureModePT(group);
            if (!r.ok) {
                await sendText({ ...ctx, message: `❌ ${r.error}` });
                return;
            }
            await sendText({ ...ctx, message: "✅ Mode group diset: PT" });
            return;
        }

        // ✅ MODE GATEWAY
        if (raw === "gateway") {
            const r = await ensureModeGateway(group);
            if (!r.ok) {
                await sendText({ ...ctx, message: `❌ ${r.error}` });
                return;
            }
            await sendText({ ...ctx, message: "✅ Mode group diset: gateway" });
            return;
        }

        await sendText({
            ...ctx,
            message:
                "❌ Mode tidak dikenal.\n" +
                "Mode yang didukung:\n" +
                "- set mode leasing\n" +
                "- set mode input data\n" +
                "- set mode pt\n" +
                "- set mode gateway",
        });
        return;
    }

    // set leasing adira
    if (key === "set_leasing") {
        if (!(await requireMasterOrReply({ master, ctx, sendText }))) return;
        const code = (args[0] || "").toUpperCase();
        const r = await setLeasing(group, code);
        if (!r.ok) {
            await sendText({ ...ctx, message: `❌ ${r.error}` });
            return;
        }
        await sendText({
            ...ctx,
            message: r.created
                ? `✅ Leasing dibuat & diset: ${r.leasing.code}`
                : `✅ Leasing group diset: ${r.leasing.code}`,
        });
        return;
    }

    // unset leasing
    if (key === "unset_leasing") {
        if (!(await requireMasterOrReply({ master, ctx, sendText }))) return;

        const r = await unsetLeasing(group);
        if (!r.ok) {
            await sendText({ ...ctx, message: `❌ ${r.error}` });
            return;
        }

        await sendText({
            ...ctx,
            message:
                "✅ Leasing berhasil dihapus dari group.\n" +
                "Level & cabang juga sudah di-reset.",
        });
        return;
    }

    // tambah cabang ...
    if (key === "add_branch") {
        if (!(await requireMasterOrReply({ master, ctx, sendText }))) return;

        const r = await addBranchesAutoLevel(group, args[0] || "", argsLines);
        if (!r.ok) {
            await sendText({ ...ctx, message: `❌ ${r.error}\nContoh:\n- tambah cabang banjarmasin,jakarta\n- tambah cabang\n  banjarmasin\n  jakarta\n- tambah cabang nasional` });
            return;
        }

        const branchText =
            r.branches === "ALL" ? "ALL (HO)" : Array.isArray(r.branches) ? r.branches.join(", ") : "-";

        await sendText({
            ...ctx,
            message: `✅ Cabang ditambahkan.\nLevel: ${r.level}\nCabang: ${branchText}`,
        });
        return;
    }

    if (key === "del_branch") {
        if (!(await requireMasterOrReply({ master, ctx, sendText }))) return;

        const r = await removeBranchesAutoLevel(group, args[0] || "", argsLines);
        if (!r.ok) {
            await sendText({
                ...ctx,
                message:
                    `❌ ${r.error}\nContoh:\n` +
                    `- hapus cabang banjarmasin\n` +
                    `- hapus cabang BJM,BTG\n` +
                    `- hapus cabang\n  banjarmasin\n  jakarta`,
            });
            return;
        }

        const branchText = Array.isArray(r.branches) && r.branches.length ? r.branches.join(", ") : "-";
        const levelText = r.level || "-";

        await sendText({
            ...ctx,
            message: `✅ Cabang dihapus: ${r.deleted} item.\nLevel: ${levelText}\nSisa cabang: ${branchText}`,
        });
        return;
    }

    if (key === "list_branch") {
        // boleh master-only atau boleh semua member group.
        // aku buat: boleh semua selama bot aktif.
        const r = await listBranchesForGroup(group);
        if (!r.ok) {
            await sendText({ ...ctx, message: `❌ ${r.error}` });
            return;
        }

        const leasingCode = r.leasing?.code || "-";
        const level = r.level || "-";

        const branchText =
            r.branches === "ALL"
                ? "NASIONAL (ALL cabang)"
                : Array.isArray(r.branches) && r.branches.length
                    ? r.branches.join(", ")
                    : "-";

        await sendText({
            ...ctx,
            message:
                `📌 Konfigurasi Cabang Group\n` +
                `Leasing: ${leasingCode}\n` +
                `Level: ${level}\n` +
                `Cabang: ${branchText}`,
        });
        return;
    }

    // ===== start / stop group (toggle notif_data_access_enabled) =====
    if (key === "group_start") {
        if (!(await requireMasterOrReply({ master, ctx, sendText }))) return;

        group.notif_data_access_enabled = true;
        await group.save();

        await sendText({
            ...ctx,
            message: "✅ Notifikasi data diaktifkan untuk group ini.",
        });
        return;
    }

    if (key === "group_stop") {
        if (!(await requireMasterOrReply({ master, ctx, sendText }))) return;

        group.notif_data_access_enabled = false;
        await group.save();

        await sendText({
            ...ctx,
            message: "⛔ Notifikasi data dimatikan untuk group ini.",
        });
        return;
    }

    // ===== template: input data motor/r2 =====
    // ===== template: input data motor/r2 =====
    if (key === "input_data_r2" || key === "input_data_r4") {
        const modeKey = String(await getModeKeyCached(group.mode_id) || "").toLowerCase();

        const type = key === "input_data_r4" ? "R4" : "R2";
        const template = buildInputTemplate({ modeKey, type });

        // 1) kirim template dulu
        const sent1 = await sendText({ ...ctx, message: template });

        const quotedId = sent1?.idMessage || sent1?.messageId || sent1?.id;

        // 2) kirim instruksi sambil quote template
        await sendText({
            ...ctx,
            message: "Silakan copy template di atas ini, isi, lalu kirim kembali:",
            quotedMessageId: quotedId,
        });

        return;
    }

    // ===== hapus nopol (bulk) =====
    // ===== hapus nopol (bulk + quote single) =====

    if (key === "delete_nopol") {
        const nopolList = parseNopolList(args[0] || "", argsLines);

        const modeKey = String((await getModeKeyCached(group.mode_id)) || "").toLowerCase();
        const allowedModes = new Set(["leasing", "input_data"]);
        if (!allowedModes.has(modeKey)) {
            await sendText({ ...ctx, message: "❌ Command ini hanya boleh di mode leasing atau input data." });
            return;
        }

        const quotedOnly = Boolean(meta?.quotedOnly);

        // =========================
        // 1) QUOTED ONLY (command "hapus")
        // =========================
        if (quotedOnly) {
            const quotedText = getQuotedText(webhook);
            if (!quotedText) {
                await sendText({
                    ...ctx,
                    message: "❌ Perintah *hapus* harus dengan reply/quote pesan notif / hasil cek nopol.",
                });
                return;
            }

            const nopol = parseNopolFromText(quotedText);
            if (!nopol) {
                await sendText({ ...ctx, message: "❌ Tidak menemukan NOPOL di pesan yang kamu quote." });
                return;
            }

            let leasingCode = parseLeasingCodeFromText(quotedText);

            // MODE LEASING: fallback ke leasing group jika quote tidak ada leasing
            if (!leasingCode && modeKey === "leasing") {
                if (!group.leasing_id) {
                    await sendText({ ...ctx, message: "❌ Leasing tidak ditemukan di quote dan group belum diset leasing." });
                    return;
                }
                const leasing = await LeasingCompany.findByPk(group.leasing_id);
                leasingCode = String(leasing?.code || "").toUpperCase();
            }

            // MODE INPUT_DATA: wajib ada leasing di quote (biar konsisten)
            if (!leasingCode) {
                await sendText({
                    ...ctx,
                    message:
                        "❌ Leasing tidak ditemukan di quote.\n" +
                        "Pastikan pesan yang di-quote memuat 'Leasing: ...' (contoh: Leasing: *FIF 0123*).",
                });
                return;
            }

            await WaDeleteHistory.create({
                chat_id: group.chat_id,
                nopol,
                sender: phone,
                leasing_code: leasingCode,
                delete_reason: null,
                status: "PENDING",
                requested_at: new Date(),
                meta: {
                    source: "QUOTE_CMD_HAPUS",
                    modeKey,
                    quoted_preview: String(quotedText).slice(0, 300),
                },
            });

            const reasonsText = DELETE_REASONS.map((r, i) => `${i + 1}. ${r}`).join("\n");

            await sendText({
                ...ctx,
                message:
                    `Anda akan menghapus nopol *${nopol}* dari leasing *${leasingCode}*.\n\n` +
                    `Tag pesan ini dan pilih alasan penghapusan dengan mengetik nomor alasan (contoh: 1):\n` +
                    reasonsText,
            });

            return;
        }

        // =========================
        // 2) TANPA QUOTE: tidak ada nopol -> tampilkan format
        // =========================
        if (nopolList.length === 0) {
            await sendText({
                ...ctx,
                message:
                    "❌ Format:\n" +
                    "hapus nopol DA1234BC,DA2345BB\n" +
                    "atau:\n" +
                    "hapus nopol\nDA1234BC\nDA2345BB\n\n" +
                    "💡 Untuk hapus 1 nopol via quote: reply notif/hasil cek lalu ketik *hapus*.",
            });
            return;
        }

        // =========================
        // 3) TANPA QUOTE: jika 1 nopol -> minta reason (pending)
        // =========================
        if (nopolList.length === 1) {
            const nopol = String(nopolList[0] || "").trim().toUpperCase();
            if (!nopol) {
                await sendText({ ...ctx, message: "❌ Nopol tidak valid." });
                return;
            }

            let leasingCode = "";

            // MODE LEASING: pakai leasing dari group
            if (modeKey === "leasing") {
                if (!group.leasing_id) {
                    await sendText({ ...ctx, message: "❌ Group ini belum diset leasing. Jalankan: set leasing <kode>" });
                    return;
                }
                const leasing = await LeasingCompany.findByPk(group.leasing_id);
                leasingCode = String(leasing?.code || "").toUpperCase();
            }

            // MODE INPUT_DATA: leasing wajib disebut di command (single text juga)
            if (modeKey === "input_data") {
                leasingCode = String(args[0] || "").trim().toUpperCase();
                if (!leasingCode) {
                    await sendText({
                        ...ctx,
                        message:
                            "❌ Mode input data harus menyebut leasing.\n" +
                            "Contoh:\n" +
                            "hapus nopol FIF\n" +
                            "DA1234BC",
                    });
                    return;
                }
            }

            if (!leasingCode) {
                await sendText({ ...ctx, message: "❌ Leasing code tidak valid." });
                return;
            }

            await WaDeleteHistory.create({
                chat_id: group.chat_id,
                nopol,
                sender: phone,
                leasing_code: leasingCode,
                delete_reason: null,
                status: "PENDING",
                requested_at: new Date(),
                meta: { source: "SINGLE_TEXT", modeKey },
            });

            const reasonsText = DELETE_REASONS.map((r, i) => `${i + 1}. ${r}`).join("\n");

            await sendText({
                ...ctx,
                message:
                    `Anda akan menghapus nopol *${nopol}* dari leasing *${leasingCode}*.\n\n` +
                    `Tag pesan ini dan pilih alasan penghapusan dengan mengetik nomor alasan (contoh: 1):\n` +
                    reasonsText,
            });

            return;
        }

        // =========================
        // 4) BULK (>1): langsung runPaidCommand (sama seperti sebelumnya)
        // =========================
        let leasingCode = "";

        // MODE LEASING: pakai leasing dari group
        if (modeKey === "leasing") {
            if (!group.leasing_id) {
                await sendText({ ...ctx, message: "❌ Group ini belum diset leasing. Jalankan: set leasing <kode>" });
                return;
            }
            const leasing = await LeasingCompany.findByPk(group.leasing_id);
            leasingCode = String(leasing?.code || "").toUpperCase();
        }

        // MODE INPUT_DATA: leasing wajib disebut di command (bulk)
        if (modeKey === "input_data") {
            leasingCode = String(args[0] || "").trim().toUpperCase();
            if (!leasingCode) {
                await sendText({
                    ...ctx,
                    message:
                        "❌ Mode input data harus menyebut leasing.\n" +
                        "Contoh:\n" +
                        "hapus nopol FIF\n" +
                        "DA1234BC\nDA2345BB",
                });
                return;
            }
        }

        if (!leasingCode) {
            await sendText({ ...ctx, message: "❌ Leasing code tidak valid." });
            return;
        }

        const personalOnly = modeKey === "input_data";

        await runPaidCommand({
            commandKey: "delete_nopol",
            group,
            webhook,
            ctx,

            phone_e164: phone,
            wallet_scope_override: personalOnly ? "PERSONAL" : null,

            precheck_before_execute: personalOnly,
            precheck_units: personalOnly ? nopolList.length : 1,

            sendBalanceToPersonal: personalOnly,
            hideBalanceInGroup: personalOnly,
            groupSuccessSuffix: personalOnly ? "ℹ️ Sisa kredit kamu dikirim ke chat pribadi." : null,
            personalChatId: personalOnly ? (webhook?.senderData?.sender || null) : null,

            args: { leasingCode, nopolList },

            replyBuilder: async ({ leasingCode, nopolList }) => {
                try {
                    await bulkDeleteNopol({ leasingCode, nopolList });

                    return {
                        text: "Data berhasil dihapus",
                        chargeable: true,
                        chargeUnits: nopolList.length,
                    };
                } catch (e) {
                    return {
                        text: `❌ Gagal hapus nopol.\n${e?.response?.data?.error || e.message}`,
                        chargeable: false,
                        chargeUnits: 1,
                    };
                }
            },
        });

        return;
    }



    // ... di dalam handleIncoming:
    if (key === "cek_nopol") {
        const plate = normPlate(args[0] || "");
        if (!plate) {
            await sendText({ ...ctx, message: "❌ Format: cek nopol AB1234CD" });
            return;
        }

        const modeKey = String(await getModeKeyCached(group.mode_id) || "").toLowerCase();
        const isGateway = modeKey === "gateway";

        // leasing group (untuk mismatch rule yang sudah kamu punya)
        let groupLeasingCode = "";
        if (group.leasing_id) {
            const leasingRow = await LeasingCompany.findByPk(group.leasing_id, { attributes: ["code"] });
            groupLeasingCode = String(leasingRow?.code || "").trim().toUpperCase();
        }

        // ====== MODE GATEWAY: hasil sukses -> PERSONAL, group cuma notif ======
        if (isGateway) {
            const personalChatId = webhook?.senderData?.sender || null;

            // helper kirim personal (support @lid / @c.us)
            const toPersonalChatId = (v) => {
                const s = String(v || "").trim();
                if (!s) return "";
                if (s.includes("@c.us") || s.includes("@lid")) return s;
                if (s.includes("@")) return s;
                return `${s}@c.us`;
            };
            const sendPersonal = async (message) => {
                const target = toPersonalChatId(personalChatId || phone);
                if (!target) return false;
                await sendText({ ...ctx, chatId: target, message });
                return true;
            };

            // 1) PRECHECK saldo PERSONAL sebelum call API
            const pre = await checkAndDebit({
                commandKey: "cek_nopol",
                group,
                webhook,
                ref_type: "WA_MESSAGE",
                ref_id: webhook?.idMessage || null,
                notes: "cek_nopol",
                phone_e164: phone,
                debit: false,
                units: 1,
                wallet_scope_override: "PERSONAL",
            });

            if (!pre.ok) {
                await sendText({ ...ctx, message: `❌ ${pre.error || "Gagal billing"}` });
                return;
            }
            if (!pre.allowed) {
                await sendText({
                    ...ctx,
                    message:
                        `❌ ${pre.error || "Tidak diizinkan"}\n\n` +
                        `ℹ️ Mode gateway memakai *saldo personal*. Silakan isi saldo personal terlebih dulu melalui nomor Admin +6285250505445`,
                });
                return;
            }

            // 2) CALL API
            let r;
            try {
                r = await cekNopolFromApi(plate);
            } catch (e) {
                await sendText({ ...ctx, message: `❌ Error cek nopol.\n${e?.message || "Unknown error"}` });
                return;
            }

            // 3) not found -> kirim GROUP saja (tanpa debit)
            if (!r?.ok) {
                await sendText({
                    ...ctx,
                    message:
                        `*CEK NOPOL HUNTER*\n` +
                        `*====================*\n` +
                        `Data tidak ditemukan.\n` +
                        `Nopol: ${plate}`,
                });
                return;
            }

            // 4) leasing mismatch -> kirim GROUP saja (tanpa debit)
            const dataLeasingUp = String(r.leasing_code || r.leasing || "").trim().toUpperCase();
            const groupLeasingUp = String(groupLeasingCode || "").trim().toUpperCase();
            if (groupLeasingUp && dataLeasingUp && dataLeasingUp !== groupLeasingUp) {
                await sendText({
                    ...ctx,
                    message:
                        `*CEK NOPOL HUNTER*\n` +
                        `*====================*\n` +
                        `⚠️ Data ditemukan, tetapi bukan untuk leasing ini.\n` +
                        `Leasing data: *${dataLeasingUp}*\n` +
                        `Leasing group: *${groupLeasingUp}*`,
                });
                return;
            }

            // 5) SUKSES -> DEBIT dulu
            const bill = await checkAndDebit({
                commandKey: "cek_nopol",
                group,
                webhook,
                ref_type: "WA_MESSAGE",
                ref_id: webhook?.idMessage || null,
                notes: "cek_nopol",
                phone_e164: phone,
                debit: true,
                units: 1,
                wallet_scope_override: "PERSONAL",
            });

            if (!bill.ok || !bill.allowed) {
                await sendText({ ...ctx, message: `❌ ${bill.error || "Kredit tidak cukup"}` });
                return;
            }

            // 6) kirim 1 pesan ke PERSONAL: hasil + kredit (jadi 1 message)
            const resultText = formatCekNopolMessage({
                data: { ...r, leasing: r.leasing || "-" },
                checkedByPhone: phone,
            });

            const personalMsg =
                `${resultText}\n\n` +
                `💳 Kredit terpakai: ${bill.credit_cost}\n` +
                `Sisa: ${bill.balance_after}`;

            await sendPersonal(personalMsg);

            // 7) GROUP: notif singkat sukses
            await sendText({
                ...ctx,
                message: `✅ Data ditemukan untuk ${plate}.\n📩 Detail dikirim ke chat pribadi pengirim.`,
            });

            return;
        }

        // ====== MODE LAIN: tetap seperti yang ada (runPaidCommand) ======
        await runPaidCommand({
            commandKey: "cek_nopol",
            group,
            webhook,
            ctx,
            phone_e164: phone,
            args: { plate },
            replyBuilder: async ({ plate }) => {
                const r = await cekNopolFromApi(plate);

                if (!r?.ok) {
                    return { text: `*CEK NOPOL HUNTER*\n*====================*\nData tidak ditemukan.\nNopol: ${plate}`, chargeable: false };
                }

                const dataLeasingUp = String(r.leasing_code || r.leasing || "").trim().toUpperCase();
                const groupLeasingUp = String(groupLeasingCode || "").trim().toUpperCase();

                if (groupLeasingUp && dataLeasingUp && dataLeasingUp !== groupLeasingUp) {
                    const msg =
                        `*CEK NOPOL HUNTER*\n` +
                        `*====================*\n` +
                        `⚠️ Data ditemukan, tetapi bukan untuk leasing ini.\n` +
                        `Leasing data: *${dataLeasingUp}*\n` +
                        `Leasing group: *${groupLeasingUp}*`;
                    return { text: msg.trim(), chargeable: false };
                }

                return {
                    text: formatCekNopolMessage({
                        data: { ...r, leasing: r.leasing || "-" },
                        checkedByPhone: phone,
                    }),
                    chargeable: true,
                    chargeUnits: 1,
                };
            },
        });

        return;
    }


// ... di dalam handleIncoming, ganti block "history" jadi ini:
    if (key === "history") {
        const plate = normPlate(args[0] || "");
        if (!plate) {
            await sendText({ ...ctx, message: "❌ Format: history AB1234CD" });
            return;
        }

        // Leasing group (kalau group sudah diset leasing)
        let groupLeasingCode = "";
        if (group.leasing_id) {
            const leasingRow = await LeasingCompany.findByPk(group.leasing_id, { attributes: ["code"] });
            groupLeasingCode = String(leasingRow?.code || "").trim().toUpperCase();
        }

        await runPaidCommand({
            commandKey: "history",
            group,
            webhook,
            ctx,
            leasingId: group.leasing_id || null,
            groupId: group.id,
            args: { plate },
            replyBuilder: async ({ plate }) => {
                const r = await getAccessHistoryByNopol(plate);

                if (!r?.ok) return `❌ Gagal ambil history ${plate}`;
                const items = Array.isArray(r.items) ? r.items : [];
                if (!items.length) {
                    return `*HISTORY NOPOL ${plate}*\n*================*\nData tidak ditemukan.`;
                }

                const dataLeasing = resolveLeasingFromItems(items); // mis. "KREDITPLUS"
                const dataLeasingUp = String(dataLeasing || "").toUpperCase();
                const groupLeasingUp = String(groupLeasingCode || "").toUpperCase();

                // jika group sudah set leasing, tapi hasil leasing beda -> info mismatch
                if (groupLeasingUp && dataLeasingUp && dataLeasingUp !== groupLeasingUp) {
                    return (
                        `*HISTORY NOPOL ${plate}*\n` +
                        `*================*\n` +
                        `⚠️Data ditemukan, tetapi bukan untuk leasing ini.\n` +
                        `Leasing data: *${dataLeasingUp}*\n` +
                        `Leasing group: *${groupLeasingUp}*`
                    ).trim();
                }

                // cocok / atau group belum set leasing → tampilkan normal
                const msg = formatHistoryMessage({
                    nopol: plate,
                    leasing: dataLeasingUp || groupLeasingUp || "-",
                    items,
                    page: 1,
                    perPage: 10,
                });

                return msg;
            },
        });

        return;
    }

// command: request lokasi
    if (key === "history") {
        const plate = normPlate(args[0] || "");
        if (!plate) {
            await sendText({ ...ctx, message: "❌ Format: history AB1234CD" });
            return;
        }

        // Leasing group (kalau group sudah diset leasing)
        let groupLeasingCode = "";
        if (group.leasing_id) {
            const leasingRow = await LeasingCompany.findByPk(group.leasing_id, { attributes: ["code"] });
            groupLeasingCode = String(leasingRow?.code || "").trim().toUpperCase();
        }

        await runPaidCommand({
            commandKey: "history",
            group,
            webhook,
            ctx,
            phone_e164: phone, // ✅ penting kalau wallet_scope PERSONAL dipakai
            args: { plate },
            replyBuilder: async ({ plate }) => {
                const r = await getAccessHistoryByNopol(plate);

                // 2) semua error -> jangan charge
                if (!r?.ok) {
                    return { text: `❌ Gagal ambil history ${plate}`, chargeable: false };
                }

                const items = Array.isArray(r.items) ? r.items : [];

                // 1) tidak ditemukan -> jangan charge
                if (!items.length) {
                    return {
                        text: `*HISTORY NOPOL ${plate}*\n*================*\nData tidak ditemukan.`,
                        chargeable: false,
                    };
                }

                const dataLeasing = resolveLeasingFromItems(items); // mis. "KREDITPLUS"
                const dataLeasingUp = String(dataLeasing || "").trim().toUpperCase();
                const groupLeasingUp = String(groupLeasingCode || "").trim().toUpperCase();

                // 3) ditemukan tapi leasing lain -> jangan charge
                if (groupLeasingUp && dataLeasingUp && dataLeasingUp !== groupLeasingUp) {
                    const msg = (
                        `*HISTORY NOPOL ${plate}*\n` +
                        `*================*\n` +
                        `⚠️ Data ditemukan, tetapi bukan untuk leasing ini.\n` +
                        `Leasing data: *${dataLeasingUp}*\n` +
                        `Leasing group: *${groupLeasingUp}*`
                    ).trim();

                    return { text: msg, chargeable: false };
                }

                // ✅ tampil normal (cocok / group belum set leasing) -> charge
                const msg = formatHistoryMessage({
                    nopol: plate,
                    leasing: dataLeasingUp || groupLeasingUp || "-",
                    items,
                    page: 1,
                    perPage: 10,
                });

                return { text: msg, chargeable: true };
            },
        });

        return;
    }

    // command: set pt <kode>
    if (key === "set_pt") {
        if (!(await requireMasterOrReply({ master, ctx, sendText }))) return;

        const code = (args[0] || "").trim();
        const r = await setPt(group, code);

        if (!r.ok) {
            await sendText({ ...ctx, message: `❌ ${r.error}\nContoh: set pt PT MAJU MUNDUR` });
            return;
        }

        await sendText({
            ...ctx,
            message: r.created
                ? `✅ PT dibuat & diset: ${r.pt.code}`
                : `✅ PT group diset: ${r.pt.code}`,
        });
        return;
    }

// optional: unset pt
    if (key === "unset_pt") {
        if (!(await requireMasterOrReply({ master, ctx, sendText }))) return;
        group.pt_company_id = null;
        await group.save();
        await sendText({ ...ctx, message: "✅ PT group dihapus (unset)." });
        return;
    }



    if (key === "tarik_report") {
        // master-only atau boleh semua? aku bikin master-only biar aman
        // if (!master) return;

        // leasing wajib dari group
        if (!group.leasing_id) {
            await sendText({ ...ctx, message: "❌ Leasing group belum diset. Jalankan: set leasing <kode>" });
            return;
        }

        const leasingRow = await LeasingCompany.findByPk(group.leasing_id, { attributes: ["code"] });
        const leasingCode = String(leasingRow?.code || "").trim().toUpperCase();
        if (!leasingCode) {
            await sendText({ ...ctx, message: "❌ Leasing group invalid." });
            return;
        }

        // ambil cabang dari setting group
        let cabangParam = "";
        const lvl = String(group.leasing_level || "").toUpperCase();

        if (lvl === "CABANG" && group.leasing_branch_id) {
            const b = await LeasingBranch.findByPk(group.leasing_branch_id, { attributes: ["name", "code"] });
            cabangParam = String(b?.name || b?.code || "").trim().toUpperCase();
        } else if (lvl === "AREA") {
            const rows = await WaGroupLeasingBranch.findAll({
                where: { group_id: group.id, is_active: true },
                include: [{ model: LeasingBranch, as: "branch" }],
                order: [["created_at", "ASC"]],
            });
            const names = rows.map(r => r.branch?.name || r.branch?.code).filter(Boolean).map(s => String(s).trim().toUpperCase());
            cabangParam = names.join(","); // kalau API kamu support multi
        } else {
            // HO / unset
            cabangParam = "";
        }

        // parse tanggal
        const reqText = (args[0] || "").trim();
        const parsed = parseReportDate(reqText);
        if (!parsed.ok) {
            await sendText({ ...ctx, message: `❌ ${parsed.error}` });
            return;
        }

        const baseUrl = "https://api.digitalmanager.id";
        if (!baseUrl) {
            await sendText({ ...ctx, message: "❌ BASE_URL belum diset di env." });
            return;
        }

        await sendText({ ...ctx, message: "⏳ Sedang tarik report excel..." });

        try {
            const buf = await fetchAccessReportXlsx({
                baseUrl,
                leasing: leasingCode,
                cabang: cabangParam, // "" jika nasional
                tahun: parsed.tahun,
                bulan: parsed.bulan,
                tanggal: parsed.tanggal, // "" jika monthly
            });

            const tanggalLabel = parsed.tanggal ? `-${String(parsed.tanggal).padStart(2, "0")}` : "";
            const filename = `report-access-${leasingCode}-${parsed.tahun}-${String(parsed.bulan).padStart(2, "0")}${tanggalLabel}.xlsx`;

            const meta = await saveTempXlsx(buf, filename);

// base public untuk link
            const PUBLIC_BASE = process.env.PUBLIC_BASE_URL;
// contoh: https://check.onestopcheck.id  atau domain yang bisa diakses user WA
            const link = `${PUBLIC_BASE}/api/temp-reports/dl/report/${meta.token}`;

            await sendText({
                ...ctx,
                message:
                    `✅ Report siap.\n` +
                    `Leasing: ${leasingCode}\n` +
                    `Cabang: ${cabangParam || "NASIONAL"}\n` +
                    `Periode: ${parsed.tanggal ? `${parsed.tanggal} ` : ""}${parsed.bulan}/${parsed.tahun}\n\n` +
                    `⬇️ Download (berlaku 5 menit):\n${link}`,
            });
        } catch (e) {
            await sendText({ ...ctx, message: `❌ Gagal tarik report.\n${e?.message || "Unknown error"}` });
        }

        return;
    }

    if (key === "rekap_data") {
        // leasing wajib dari group
        if (!group.leasing_id) {
            await sendText({ ...ctx, message: "❌ Leasing group belum diset. Jalankan: set leasing <kode>" });
            return;
        }

        const leasingRow = await LeasingCompany.findByPk(group.leasing_id, { attributes: ["code"] });
        const leasingCode = String(leasingRow?.code || "").trim().toUpperCase();
        if (!leasingCode) {
            await sendText({ ...ctx, message: "❌ Leasing group invalid." });
            return;
        }

        const baseUrl = "https://api.digitalmanager.id";

        await sendText({ ...ctx, message: "⏳ Sedang tarik rekap data excel..." });

        try {
            const buf = await fetchRekapDataXlsx({
                baseUrl,
                leasing: leasingCode,
            });

            const filename = `rekap-data-${leasingCode}-${Date.now()}.xlsx`;
            const meta = await saveTempXlsx(buf, filename);

            const PUBLIC_BASE = process.env.PUBLIC_BASE_URL;
            const link = `${PUBLIC_BASE}/api/temp-reports/dl/report/${meta.token}`;

            await sendText({
                ...ctx,
                message:
                    `✅ Rekap data siap.\n` +
                    `Leasing: ${leasingCode}\n\n` +
                    `⬇️ Download (berlaku 5 menit):\n${link}`,
            });
        } catch (e) {
            await sendText({ ...ctx, message: `❌ Gagal tarik rekap.\n${e?.message || "Unknown error"}` });
        }

        return;
    }

    // fallback
    await sendText({ ...ctx, message: `Command tidak dikenal.\nKetik: help` });
}
