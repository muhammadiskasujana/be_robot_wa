import {
    WaPrivateWhitelist,
    WaMaster,
    WaGroup,
    WaGroupFeature,
    WaGroupMode,
    LeasingCompany,
    LeasingBranch,
    WaGroupLeasingBranch,
    PtCompany,
    WaDeleteHistory,
} from "../models/index.js";
import crypto from "crypto";
import { sendText } from "./greenapi.js";
import { fetchAccessReportXlsx } from "./tarikreport/reportsAccess.js";
import { fetchRekapDataXlsx } from "./rekapJumlahData/fetchRekapDataXlsx.js";
import {listSftpFiles, downloadSftpFileXlsx, vpnStatus, vpnUp} from "./sftp/sftpFiles.js";
import { fetchAccessStatPng } from "./statistik/statistikService.js";
import { parseStatistikArgs } from "./statistik/statistikParser.js";
import { fetchPtMembers, formatPtMembersMessage, buildPtMembersMessages } from "./ptMembers/ptMembersService.js";
import { saveTempFile } from "./tempReportStore.js"; // sesuaikan path
import {normalizePhone, extractText, isGroupChat, parseCommandV2, normalizeText} from "./parser.js";
import { createPendingStore, makeQuotedKey, startPendingCleaner } from "./pending/pendingJsonStore.js";

import {
    buildRegisterTemplate,
    parseRegisterTemplate,
    fetchCabangList,
    registerLeasingUser,
} from "./registerWebLeasing/leasingRegister.js";

import {buildInputTemplate, parseFilledTemplate, sendToTitipanInsert} from "./inputData/inputData.js";
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
import { parseNopolFromText,parseLeasingCodeFromText,getQuotedText, getQuotedMessageId  } from "./deleteNopol/parserDelete.js";
import Sequelize from "sequelize";
import {formatRekapJumlahDataText} from "./rekapJumlahData/rekapFormatter.js";
import {resolveCabangParamFromGroup} from "./helper/resolveCabangGroup.js";
import {createTempLink} from "./tempLink/tempLinkService.js";
import {deleteLeasingUser} from "./registerWebLeasing/deleteLeasingUser.js";
import {formatRequestLokasiMessage, parseRequestLokasiInput, requestLokasiTerbaru} from "./lokasi/requestLokasi.js";
import {fetchUsersReportXlsx} from "./tarikreport/fetchUsersReportXlsx.js";
import {guardFeature} from "./middleware/cekFitur.js";
const { Op } = Sequelize;




const pendingRegStore = createPendingStore("pending_register.json", 5 * 60 * 1000);
const pendingDelStore = createPendingStore("pending_delete.json", 5 * 60 * 1000);

// optional cleaner (1 menit sekali)
startPendingCleaner([pendingRegStore, pendingDelStore], 60 * 1000);

// Pending state sederhana (bisa pindah ke Redis kalau mau tahan restart)
const pendingRegister = new Map();
/**
 * key: `${chatId}:${sender}`
 * val: {
 *   step: "choose_cabang",
 *   leasingCode,
 *   form: { nama, role, handling, jabatan },
 *   cabangList: string[],
 *   createdAt: number
 * }
 */


function normCabang(v) {
    return String(v || "").trim().toUpperCase();
}

function uniq(arr) {
    const out = [];
    const seen = new Set();
    for (const x of arr || []) {
        const v = normCabang(x);
        if (!v) continue;
        if (seen.has(v)) continue;
        seen.add(v);
        out.push(v);
    }
    return out;
}

function quotedIdFromText(quotedText) {
    const q = String(quotedText || "").trim();
    if (!q) return "";
    return crypto.createHash("sha1").update(q).digest("hex");
}

function makePendingKey({ chatId, sender }) {
    return `${chatId}:${sender}`;
}

function parseCabangSelection(textRaw) {
    // terima: "1" atau "1,2,5"
    const s = String(textRaw || "").trim();
    if (!s) return [];
    return s
        .split(",")
        .map(x => x.trim())
        .filter(Boolean)
        .map(x => Number(x))
        .filter(n => Number.isFinite(n) && n > 0);
}

function formatCabangMenu(cabangList) {
    // batasi panjang WA kalau cabang banyak
    const maxShow = 100;
    const show = cabangList.slice(0, maxShow);

    const lines = show.map((c, i) => `${i + 1}. ${c}`);
    if (cabangList.length > maxShow) {
        lines.push(`...dan ${cabangList.length - maxShow} cabang lainnya`);
    }
    return lines.join("\n");
}

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

async function ensureModeManagement(group) {
    const mode = await WaGroupMode.findOne({ where: { key: "management", is_active: true } });
    if (!mode) return { ok: false, error: "Mode management belum ada di DB" };

    group.mode_id = mode.id;

    // reset yang bisa bentrok
    group.leasing_id = null;
    group.leasing_level = null;
    group.leasing_branch_id = null;
    group.pt_company_id = null;

    // ✅ pastikan meta ada
    group.meta = group.meta || {};
    if (typeof group.meta !== "object") group.meta = {};

    await group.save();
    return { ok: true, mode };
}

function normTargets(input = "") {
    // "aktivasi, hapus_user" -> ["AKTIVASI","HAPUS_USER"]
    const s = String(input || "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();

    if (!s) return [];

    return s
        .split(/[,\n|]/g)
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => x.replace(/\s+/g, "_"))
        .map((x) => x.toUpperCase());
}

async function setManageTarget(group, targetRaw) {
    const targets = normTargets(targetRaw);

    if (!targets.length) {
        return { ok: false, error: "Target kosong. Contoh: set target aktivasi" };
    }

    // ✅ field sendiri (string fleksibel)
    // contoh tersimpan: "AKTIVASI,HAPUS_USER"
    group.manage_target = targets.join(",");

    // (opsional) tetap simpan array di meta biar gampang filter/cek
    group.meta = group.meta && typeof group.meta === "object" ? group.meta : {};
    group.meta.manage_targets = targets;

    await group.save();
    return { ok: true, targets };
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

async function unsetManageTarget(group) {
    if (!group) return { ok: false, error: "Group tidak ditemukan" };

    // pastikan meta object
    group.meta = group.meta || {};
    if (typeof group.meta !== "object") group.meta = {};

    // hapus flexible fields
    group.meta.manage_target = null;
    group.meta.manage_targets = null;

    // kalau field manage_target ada di kolom sendiri (bukan meta)
    if ("manage_target" in group) {
        group.manage_target = null;
    }

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

async function createDeleteHistory({
                                       WaDeleteHistory,
                                       chatId,
                                       nopol,
                                       sender,
                                       leasingCode,
                                       modeKey,
                                       source,
                                       meta = {},
                                   }) {
    return await WaDeleteHistory.create({
        chat_id: String(chatId).trim(),
        nopol: String(nopol).trim().toUpperCase(),
        sender: String(sender || "").trim(),
        leasing_code: String(leasingCode || "").trim().toUpperCase(),
        delete_reason: null,
        status: "PENDING",
        requested_at: new Date(),
        meta: {
            modeKey,
            source,
            ...meta,
        },
    });
}

async function updateDeleteHistoryById({
                                           WaDeleteHistory,
                                           historyId,
                                           status,
                                           deleteReason,
                                           metaPatch = {},
                                           confirmedAt = null,
                                       }) {
    if (!historyId) return null;

    const row = await WaDeleteHistory.findByPk(historyId);
    if (!row) return null;

    const nextMeta = {
        ...(row.meta || {}),
        ...metaPatch,
    };

    row.status = status || row.status;

    if (deleteReason !== undefined) {
        row.delete_reason = deleteReason;
    }

    if (confirmedAt !== undefined) {
        row.confirmed_at = confirmedAt;
    }

    row.meta = nextMeta;

    await row.save();
    return row;
}

// tryConfirmQuotedDeleteReason.js
export async function tryConfirmQuotedDeleteReason({
                                                       webhook,
                                                       ctx,
                                                       group,
                                                       phone,
                                                       chatId,
                                                       sendText,
                                                       bulkDeleteNopol,
                                                       runPaidCommand,
                                                       getModeKeyCached,
                                                       pendingDelStore,
                                                       WaDeleteHistory,
                                                   }) {
    const body = extractText(webhook);
    const t = normalizeText(body);

    if (!/^[1-7]$/.test(t)) return false;

    // wajib reply/quote menu
    const quotedText = getQuotedText(webhook);
    if (!quotedText) return false;

    const sender = webhook?.senderData?.sender || "";
    const pKey = makePendingKey({ chatId, sender });

    const pending = await pendingDelStore.get(pKey);
    if (!pending || pending.step !== "choose_reason") return false;

    const historyId = pending?.historyId || null;

    // pastikan quote memang menu hapus
    const qt = String(quotedText || "").toUpperCase();
    const mustNopol = String(pending.nopol || "").toUpperCase();
    const mustLeasing = String(pending.leasingCode || "").toUpperCase();

    const looksLikeMenu =
        qt.includes("ANDA AKAN MENGHAPUS NOPOL") &&
        (!mustNopol || qt.includes(mustNopol)) &&
        (!mustLeasing || qt.includes(mustLeasing));

    if (!looksLikeMenu) return false;

    const reason = getDeleteReasonByNumber(t);
    if (!reason) return false;

    const modeKey = String((await getModeKeyCached(group.mode_id)) || "").toLowerCase();
    const personalOnly = modeKey === "input_data";

    // simpan alasan dulu, status tetap PENDING
    await updateDeleteHistoryById({
        WaDeleteHistory,
        historyId,
        deleteReason: reason,
        metaPatch: {
            reason_selected_at: new Date().toISOString(),
            confirmed_via: "quoted_reason_reply",
        },
    });

    let shouldDeletePending = false;

    try {
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
                leasingCode: pending.leasingCode,
                nopolList: [pending.nopol],
                reason,
            },

            replyBuilder: async ({ leasingCode, nopolList, reason }) => {
                try {
                    const apiRes = await bulkDeleteNopol({
                        leasingCode,
                        nopolList,
                        reason, // kirim juga kalau upstream support
                    });

                    const success = Array.isArray(apiRes?.success) ? apiRes.success : [];
                    const notFound = Array.isArray(apiRes?.notFound) ? apiRes.notFound : [];
                    const successCount = Number(apiRes?.successCount ?? success.length ?? 0);
                    const notFoundCount = Number(apiRes?.notFoundCount ?? notFound.length ?? 0);

                    await updateDeleteHistoryById({
                        WaDeleteHistory,
                        historyId,
                        status: successCount > 0 ? "DONE" : "FAILED",
                        deleteReason: reason,
                        confirmedAt: new Date(),
                        metaPatch: {
                            api_result: {
                                leasing: apiRes?.leasing || leasingCode,
                                requested: 1,
                                success,
                                notFound,
                                successCount,
                                notFoundCount,
                            },
                            finished_at: new Date().toISOString(),
                        },
                    });

                    if (successCount > 0 || notFoundCount > 0) {
                        shouldDeletePending = true;
                    }

                    const lines = [];
                    lines.push(`*HAPUS NOPOL (TITIPAN)*`);
                    lines.push(`Leasing: *${String(apiRes?.leasing || leasingCode).toUpperCase()}*`);
                    lines.push(`Alasan: *${reason}*`);

                    if (successCount > 0) {
                        lines.push(`✅ Berhasil dihapus (*${successCount}*):`);
                        lines.push(success.map((x) => `• ${String(x).toUpperCase()}`).join("\n"));
                    }

                    if (notFoundCount > 0) {
                        lines.push(`➖ Tidak ditemukan (*${notFoundCount}*):`);
                        lines.push(notFound.map((x) => `• ${String(x).toUpperCase()}`).join("\n"));
                    }

                    if (successCount === 0 && notFoundCount > 0) {
                        lines.push(`➖ Tidak ada nopol yang dihapus karena tidak ditemukan.`);
                    }

                    return {
                        text: lines.join("\n").trim(),
                        chargeable: successCount > 0,
                        chargeUnits: successCount,
                    };
                } catch (e) {
                    const d = e?.response?.data;

                    await updateDeleteHistoryById({
                        WaDeleteHistory,
                        historyId,
                        status: "FAILED",
                        deleteReason: reason,
                        confirmedAt: new Date(),
                        metaPatch: {
                            error: {
                                message: e?.message || "Unknown error",
                                response: d || null,
                            },
                            finished_at: new Date().toISOString(),
                        },
                    });

                    shouldDeletePending = true;

                    if (d?.ok === false && /leasing/i.test(String(d?.message || ""))) {
                        const mismatch = Array.isArray(d?.mismatch) ? d.mismatch : [];
                        const details = mismatch.length
                            ? "\n" + mismatch.map((x) =>
                            `• ${String(x.nopol || "").toUpperCase()} (actual: ${String(x.actualLeasing || "-").toUpperCase()})`
                        ).join("\n")
                            : "";

                        return {
                            text:
                                `❌ Gagal hapus nopol (leasing tidak sesuai).\n` +
                                `Param leasing: *${String(d?.leasingParam || leasingCode).toUpperCase()}*\n` +
                                `Mismatch: *${d?.mismatchCount ?? mismatch.length}*` +
                                details,
                            chargeable: false,
                            chargeUnits: 0,
                        };
                    }

                    const msg =
                        (typeof d === "string" ? d : (d?.error || d?.message)) ||
                        e?.message ||
                        "Unknown error";

                    return {
                        text: `❌ Gagal hapus nopol.\n${msg}`,
                        chargeable: false,
                        chargeUnits: 0,
                    };
                }
            },
        });

        if (shouldDeletePending) {
            await pendingDelStore.del(pKey);
        }

        return true;
    } catch (e) {
        await updateDeleteHistoryById({
            WaDeleteHistory,
            historyId,
            status: "FAILED",
            deleteReason: reason,
            confirmedAt: new Date(),
            metaPatch: {
                run_paid_command_error: e?.message || "Unknown error",
                finished_at: new Date().toISOString(),
            },
        });

        await pendingDelStore.del(pKey);
        throw e;
    }
}


function formatBytes(n) {
    const num = Number(n || 0);
    if (!Number.isFinite(num)) return "-";
    if (num < 1024) return `${num} B`;
    const kb = num / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(1)} GB`;
}

function formatTime(ms) {
    const t = Number(ms);
    if (!Number.isFinite(t) || t <= 0) return "-";
    // simple: ISO lokal bisa, atau WIB. (pakai moment kalau sudah ada)
    const d = new Date(t);
    return d.toLocaleString("id-ID");
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



    const handled = await tryConfirmQuotedDeleteReason({
        webhook,
        ctx,
        group,
        phone,
        chatId,              // ✅ INI YANG KURANG

        sendText,
        bulkDeleteNopol,
        runPaidCommand,
        getModeKeyCached,
        pendingDelStore,
        WaDeleteHistory
    });

    if (handled) return;

    const { key, args, argsLines, meta } = parseCommandV2(text, { modeKey });

    // jika bot mati, stop (kecuali help/aktifkan robot dsb yang sudah kamu handle)
    if (!group.is_bot_enabled) {
        // tetap boleh proses "aktifkan robot" / "help" di code kamu sebelumnya
        // jadi taruh block ini setelah handle "robot_on/robot_off/help"
    }

    // ✅ DETEKSI TEMPLATE SUBMISSION (tanpa perlu command)
    const filled = parseFilledTemplate(text);
    if (filled && (filled.type === "R2" || filled.type === "R4")) {

        // ✅ GUARD: cek apakah fitur input_data diaktifkan
        const featureKey = filled.type === "R4" ? "input_data_r4" : "input_data_r2";
        if (!(await guardFeature({ groupId: group.id, featureKey, ctx, sendText }))) {
            return;
        }

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
                    const apiRes = await sendToTitipanInsert({
                        phone,
                        senderId: chatId,
                        payload,
                    });

                    // action: insert | update | exists
                    const action = String(apiRes?.action || "").toLowerCase();

                    if (action === "exists") {
                        // "Data sudah ada" -> tidak charge (samakan dengan rule lama "nopol sudah ada")
                        return {
                            text: `ℹ️ Data sudah ada di sistem (NOPOL: ${payload.nopol}).`,
                            chargeable: false,
                        };
                    }

                    // insert / update -> charge
                    const ref = apiRes?.data?.uuid || apiRes?.data?.nopol || "-";
                    const msg = apiRes?.message || "Berhasil";

                    // kalau update, tampilkan field yang berubah (opsional, ringkas)
                    const upd = Array.isArray(apiRes?.updatedFields) && apiRes.updatedFields.length
                        ? `\nUpdated: ${apiRes.updatedFields.join(", ")}`
                        : "";

                    return {
                        text: `✅ ${msg}\nRef: ${ref}${upd}`,
                        chargeable: true,
                    };
                } catch (e) {
                    const resp = e?.response?.data;
                    const msg =
                        (resp && (resp.error || resp.message)) ||
                        e?.message ||
                        "Gagal kirim data";

                    return {
                        text: `❌ Gagal kirim data ke server.\n${msg}`,
                        chargeable: false,
                    };
                }
            }
        });

        return;
    }

    // ====== REGISTRATION FLOW (WAJIB QUOTE) ======
    // ====== REGISTRATION FLOW ======
    const sender = webhook?.senderData?.sender || "";
    if (!sender) {
        await sendText({ ...ctx, message: "❌ Sender tidak valid." });
        return;
    }

    const pkey = makePendingKey({ chatId, sender });

// 1) Kalau user sedang pending pilih cabang -> WAJIB QUOTE menu cabang
    const pendingReg = await pendingRegStore.get(pkey);

    if (pendingReg?.step === "choose_cabang") {
        const quotedMsgId = getQuotedMessageId(webhook); // ✅ wajib ada di step ini

        if (!quotedMsgId) {
            // ✅ wajib quote, tapi kalau tidak quote -> DIAMKAN (tanpa respon)
            return;
        }

        const picks = parseCabangSelection(text);
        if (!picks.length) {
            await sendText({ ...ctx, message: "❌ Pilih cabang pakai nomor. Contoh: 1 atau 1,2,3" });
            return;
        }

        // validasi range
        const outOfRange = picks.filter((n) => n < 1 || n > pendingReg.cabangList.length);
        if (outOfRange.length) {
            await sendText({ ...ctx, message: `❌ Nomor cabang tidak valid: ${outOfRange.join(", ")}` });
            return;
        }

        const unique = Array.from(new Set(picks));

        if (pendingReg.form.jabatan === 3 && unique.length !== 1) {
            await sendText({ ...ctx, message: "❌ Jabatan 3 hanya boleh memilih 1 cabang." });
            return;
        }
        if (pendingReg.form.jabatan === 2 && unique.length < 1) {
            await sendText({ ...ctx, message: "❌ Minimal pilih 1 cabang." });
            return;
        }

        const chosenCabang = unique.map((n) => pendingReg.cabangList[n - 1]);

        const leasingCode = pendingReg.leasingCode;

        const reg = await registerLeasingUser({
            nama: pendingReg.form.nama,
            phone,
            leasing: leasingCode,
            cabang: chosenCabang,
            handling: pendingReg.form.handling,
            role: pendingReg.form.role,
        });

        if (!reg.ok) {
            // ✅ apapun gagal -> hapus pending biar gak ganggu
            await pendingRegStore.del(pkey);

            await sendText({
                ...ctx,
                message: `❌ Gagal daftar.\n${reg.error}\n(${reg.status || "-"})`,
            });
            return;
        }

        // ✅ hapus pending (file store)
        await pendingRegStore.del(pkey);

        await sendText({
            ...ctx,
            message:
                "✅ Berhasil membuat akun.\n" +
                `Nama: ${pendingReg.form.nama}\n` +
                `Leasing: ${leasingCode}\n` +
                `Cabang: ${chosenCabang.join(", ")}\n` +
                `Handling: ${pendingReg.form.handling} | Role: ${pendingReg.form.role}`,
        });

        return;
    }

// 2) Submit template (TIDAK PERLU QUOTE)
    const parsed = parseRegisterTemplate(text);
    if (parsed?.ok) {
        // leasing diambil dari setting group
        // leasing diambil dari group (tetap sama)
        if (!group?.leasing_id) {
            await sendText({ ...ctx, message: "❌ Group ini belum diset leasing. Jalankan: set leasing <kode>" });
            return;
        }

        const leasing = await LeasingCompany.findByPk(group.leasing_id);
        const leasingCode = leasing?.code ? String(leasing.code).toUpperCase() : "";
        if (!leasingCode) {
            await sendText({ ...ctx, message: "❌ Leasing group tidak valid." });
            return;
        }

// 1) Ambil semua cabang dari API (sebagai fallback / validasi)
        let allCabang = [];
        try {
            const lc = await fetchCabangList({ leasingCode });
            allCabang = uniq(lc.cabang || []);
        } catch (e) {
            await sendText({ ...ctx, message: `❌ Gagal ambil list cabang.\n${e.message}` });
            return;
        }

        if (!allCabang.length) {
            await sendText({ ...ctx, message: "❌ List cabang dari API kosong untuk leasing ini." });
            return;
        }

// 2) Ambil cabang milik group
        let cabangList = [];
        try {
            const gb = await listBranchesForGroup(group);

            if (!gb.ok) {
                await sendText({ ...ctx, message: `❌ ${gb.error || "Gagal ambil cabang group"}` });
                return;
            }

            // HO => ALL (pakai full API)
            if (gb.branches === "ALL") {
                cabangList = allCabang;
            } else {
                const groupBranches = uniq(gb.branches || []);

                // jika group tidak punya list -> fallback full API
                if (!groupBranches.length) {
                    cabangList = allCabang;
                } else {
                    // // ✅ tampilkan cabang sesuai group
                    // // opsional: filter supaya cuma yang valid di API (hindari typo)
                    // const allSet = new Set(allCabang.map(normCabang));
                    // const filtered = groupBranches.filter((c) => allSet.has(normCabang(c)));
                    //
                    // cabangList = filtered.length ? filtered : groupBranches;
                    const apiNormMap = new Map();
                    for (const c of allCabang) {
                        const key = normCabang(c);
                        if (!apiNormMap.has(key)) apiNormMap.set(key, c);
                    }

                    const groupNormMap = new Map();
                    for (const c of groupBranches) {
                        const key = normCabang(c);
                        if (!groupNormMap.has(key)) groupNormMap.set(key, c);
                    }

// match mengikuti urutan API
                    const matchedInApiOrder = [];
                    for (const apiCabang of allCabang) {
                        const key = normCabang(apiCabang);
                        if (groupNormMap.has(key)) {
                            matchedInApiOrder.push(apiCabang);
                        }
                    }

// yang tidak ada di API, tetap tampil di belakang
                    const unmatchedFromGroup = [];
                    for (const groupCabang of groupBranches) {
                        const key = normCabang(groupCabang);
                        if (!apiNormMap.has(key)) {
                            unmatchedFromGroup.push(groupCabang);
                        }
                    }

                    cabangList = uniq([...matchedInApiOrder, ...unmatchedFromGroup]);
                }
            }
        } catch (e) {
            // jika error baca group branch, fallback full API biar tetap jalan
            cabangList = allCabang;
        }

        if (!cabangList.length) {
            await sendText({ ...ctx, message: "❌ List cabang kosong untuk leasing ini." });
            return;
        }

        const form = parsed.data;

        // jabatan 1 = nasional → langsung semua cabang (tidak perlu quote)
        if (form.jabatan === 1) {
            const reg = await registerLeasingUser({
                nama: form.nama,
                phone,
                leasing: leasingCode,
                cabang: cabangList,
                handling: form.handling,
                role: form.role,
            });

            if (!reg.ok) {
                await sendText({ ...ctx, message: `❌ Gagal daftar.\n${reg.error}\n(${reg.status || "-"})` });
                return;
            }

            await sendText({
                ...ctx,
                message:
                    "✅ Berhasil membuat akun (Handle Nasional).\n" +
                    `Nama: ${form.nama}\n` +
                    `Leasing: ${leasingCode}\n` +
                    `Cabang: ${cabangList.length} cabang\n` +
                    `Handling: ${form.handling} | Role: ${form.role}`,
            });

            return;
        }

        const MAX_WA_CABANG = 100;

        // jabatan 2/3 → tampilkan menu cabang dan simpan pending (TTL 5 menit)
        await pendingRegStore.set(pkey, {
            step: "choose_cabang",
            leasingCode,
            form,
            cabangList,
        });

        // <= 100: kirim menu seperti biasa
        if (cabangList.length <= MAX_WA_CABANG) {
            await sendText({
                ...ctx,
                message:
                    `📌 Pilih cabang untuk ${leasingCode}:\n\n` +
                    `${formatCabangMenu(cabangList)}\n\n` +
                    (form.jabatan === 2
                        ? "✅ *WAJIB reply/quote pesan ini* lalu balas nomor cabang (bisa beberapa, pisahkan koma). Contoh: 1,3,7"
                        : "✅ *WAJIB reply/quote pesan ini* lalu balas *1 nomor cabang saja*. Contoh: 5"),
            });
            return;
        }

        // > 100: kirim link temp 5 menit ke HTML API
        const PUBLIC_BASE = process.env.PUBLIC_BASE_URL;
        if (!PUBLIC_BASE) {
            await sendText({ ...ctx, message: "❌ PUBLIC_BASE_URL belum diset di env." });
            return;
        }

        const targetUrl = `https://api.digitalmanager.id/api/list/cabang?leasing=${encodeURIComponent(leasingCode)}`;
        const { token } = createTempLink(targetUrl, 5 * 60 * 1000);
        const link = `${PUBLIC_BASE}/api/temp/temp-links/${token}`;

        await sendText({
            ...ctx,
            message:
                `📌 Cabang untuk ${leasingCode} terlalu banyak (${cabangList.length}).\n\n` +
                `Buka link ini (aktif 5 menit) untuk lihat nomor cabang:\n${link}\n\n` +
                (form.jabatan === 2
                    ? "✅ *WAJIB reply/quote pesan link ini* lalu balas nomor cabang (bisa beberapa). Contoh: 1,2,9"
                    : "✅ *WAJIB reply/quote pesan link ini* lalu balas *1 nomor cabang saja*. Contoh: 5"),
        });
        return;
    }

// 3) Kalau parsed.ok false, kasih pesan ramah
    if (parsed && parsed.ok === false) {
        const msg =
            parsed.error === "incomplete"
                ? "❌ Template belum lengkap. Pastikan Nama, Jabatan, dan Kelola_Bahan terisi."
                : parsed.error === "invalid_jabatan"
                    ? "❌ Jabatan tidak valid. Isi 1 / 2 / 3."
                    : parsed.error === "invalid_kelola_bahan"
                        ? "❌ Kelola_Bahan tidak valid. Isi 1 / 2 / 3."
                        : "❌ Template tidak valid.";
        await sendText({ ...ctx, message: msg });
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

        // ✅ MODE MANAGEMENT
        if (raw === "management" || raw === "manage" || raw === "mgmt") {
            const r = await ensureModeManagement(group);
            if (!r.ok) {
                await sendText({ ...ctx, message: `❌ ${r.error}` });
                return;
            }
            await sendText({ ...ctx, message: "✅ Mode group diset: management" });
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
                "- set mode management\n" +
                "- set mode gateway",
        });
        return;
    }

    if (key === "set_target") {
        if (!(await requireMasterOrReply({ master, ctx, sendText }))) return;

        const modeKeyNow = String((await getModeKeyCached(group.mode_id)) || "").toLowerCase();
        if (modeKeyNow !== "management") {
            await sendText({
                ...ctx,
                message: "❌ Command ini hanya untuk mode management.\nGunakan: set mode management",
            });
            return;
        }

        const rawTarget = []
            .concat(args || [])
            .concat(argsLines || [])
            .filter(Boolean)
            .join(" ")
            .trim();

        const r = await setManageTarget(group, rawTarget);
        if (!r.ok) {
            await sendText({ ...ctx, message: `❌ ${r.error}` });
            return;
        }

        await sendText({
            ...ctx,
            message: `✅ Target management diset:\n- ${r.targets.join("\n- ")}`,
        });
        return;
    }

    if (key === "unset_target") {
        if (!(await requireMasterOrReply({ master, ctx, sendText }))) return;

        const modeKeyNow = String((await getModeKeyCached(group.mode_id)) || "").toLowerCase();
        if (modeKeyNow !== "management") {
            await sendText({
                ...ctx,
                message: "❌ Command ini hanya untuk mode management.\nGunakan: set mode management",
            });
            return;
        }

        const r = await unsetManageTarget(group);
        if (!r.ok) {
            await sendText({ ...ctx, message: `❌ ${r.error}` });
            return;
        }

        await sendText({
            ...ctx,
            message: `✅ Target management berhasil dihapus.\nGroup ini tidak akan menerima notifikasi management.`,
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
        const r = await listBranchesForGroup(group);
        if (!r.ok) {
            await sendText({ ...ctx, message: `❌ ${r.error}` });
            return;
        }

        const leasingCode = r.leasing?.code || "-";
        const level = r.level || "-";

        let branchLines = "-";
        if (r.branches === "ALL") {
            branchLines = "NASIONAL (ALL cabang)";
        } else if (Array.isArray(r.branches) && r.branches.length) {
            branchLines = r.branches
                .map((b, i) => `${i + 1}. ${String(b).toUpperCase()}`)
                .join("\n");
        }

        await sendText({
            ...ctx,
            message:
                `📌 Konfigurasi Cabang Group\n` +
                `Leasing: ${String(leasingCode).toUpperCase()}\n` +
                `Level: ${String(level).toUpperCase()}\n` +
                `Cabang:\n${branchLines}`,
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


    if (key === "delete_user") {
        if (!(await requireMasterOrReply({ master, ctx, sendText }))) return;
        const phone = String(args[0] || "").trim();

        console.log(`Deleting user with phone: ${phone}`);

        if (!phone) {
            await sendText({
                ...ctx,
                message: "❌ Format salah.\nContoh:\ndelete user 085754855140",
            });
            return;
        }

        await sendText({ ...ctx, message: "⏳ Menghapus user..." });

        const res = await deleteLeasingUser({ phoneNumber: phone });

        if (!res.ok) {
            await sendText({
                ...ctx,
                message: `❌ Gagal hapus user.\n${res.error}`,
            });
            return;
        }

        await sendText({
            ...ctx,
            message: `✅ User berhasil dihapus.\nPhone: ${phone}`,
        });

        return;
    }

    // ===== template: input data motor/r2 =====
    // ===== template: input data motor/r2 =====
    if (key === "input_data_r2" || key === "input_data_r4") {
        if (!(await guardFeature({ groupId: group.id, featureKey: "input_data_r2" || "input_data_r4", ctx, sendText }))) {
            return;
        }
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
        if (!(await guardFeature({ groupId: group.id, featureKey: "delete_nopol", ctx, sendText }))) {
            return;
        }
        const nopolList = parseNopolList(args[0] || "", argsLines);

        const modeKey = String((await getModeKeyCached(group.mode_id)) || "").toLowerCase();
        const allowedModes = new Set(["leasing", "input_data"]);
        if (!allowedModes.has(modeKey)) {
            await sendText({ ...ctx, message: "❌ Command ini hanya boleh di mode leasing atau input data." });
            return;
        }

        const quotedOnly = Boolean(meta?.quotedOnly);

        // =========================
        // 1) QUOTED ONLY (command "hapus") -> bikin pending (file json)
        // =========================
        if (quotedOnly) {
            const quotedText = getQuotedText(webhook);
            if (!quotedText) return; // no response

            const nopol = parseNopolFromText(quotedText);
            if (!nopol) {
                await sendText({ ...ctx, message: "❌ Tidak menemukan NOPOL di pesan yang kamu quote." });
                return;
            }

            let leasingCode = parseLeasingCodeFromText(quotedText);

            if (!leasingCode && modeKey === "leasing") {
                if (!group.leasing_id) return;
                const leasing = await LeasingCompany.findByPk(group.leasing_id);
                leasingCode = String(leasing?.code || "").toUpperCase();
            }

            if (!leasingCode) {
                await sendText({
                    ...ctx,
                    message:
                        "❌ Leasing tidak ditemukan di quote.\n" +
                        "Pastikan pesan yang di-quote memuat 'Leasing: ...' (contoh: Leasing: *FIF 0123*).",
                });
                return;
            }

            // =========================
            // CEK DULU KE API
            // =========================
            let cekRes;
            try {
                cekRes = await cekNopolFromApi(String(nopol).toUpperCase());
            } catch (e) {
                await sendText({
                    ...ctx,
                    message: `❌ Gagal cek data nopol sebelum hapus.\n${e?.message || "Unknown error"}`,
                });
                return;
            }

            // kalau tidak ditemukan, STOP di sini
            if (!cekRes?.ok) {
                await sendText({
                    ...ctx,
                    message:
                        `❌ Nopol *${String(nopol).toUpperCase()}* tidak ditemukan.\n` +
                        `Penghapusan dibatalkan.`,
                });
                return;
            }

            // validasi leasing hasil cek vs leasing target
            const actualLeasing = String(cekRes?.leasing_code || cekRes?.leasing || "").trim().toUpperCase();
            const expectedLeasing = String(leasingCode || "").trim().toUpperCase();

            if (expectedLeasing && actualLeasing && actualLeasing !== expectedLeasing) {
                await sendText({
                    ...ctx,
                    message:
                        `❌ Data ditemukan, tetapi leasing tidak sesuai.\n` +
                        `Nopol: *${String(nopol).toUpperCase()}*\n` +
                        `Leasing data: *${actualLeasing}*\n` +
                        `Leasing target: *${expectedLeasing}*`,
                });
                return;
            }

            // =========================
            // BARU lanjut pending alasan
            // =========================
            const sender = webhook?.senderData?.sender || "";
            const pKey = makePendingKey({ chatId, sender });


            const hist = await createDeleteHistory({
                WaDeleteHistory,
                chatId,
                nopol: String(nopol).toUpperCase(),
                sender,
                leasingCode: String(leasingCode).toUpperCase(),
                modeKey,
                source: "QUOTE_CMD_HAPUS",
                meta: {
                    quotedOnly: true,
                    quotedText,
                    cekResult: {
                        leasing_code: cekRes?.leasing_code || null,
                        leasing: cekRes?.leasing || null,
                        source: cekRes?.source || null,
                        matchedBy: cekRes?.matchedBy || null,
                    },
                },
            });

            await pendingDelStore.set(pKey, {
                step: "choose_reason",
                modeKey,
                nopol: String(nopol).toUpperCase(),
                leasingCode: String(leasingCode).toUpperCase(),
                source: "QUOTE_CMD_HAPUS",
                historyId: hist.id,
            });

            const reasonsText = DELETE_REASONS.map((r, i) => `${i + 1}. ${r}`).join("\n");

            await sendText({
                ...ctx,
                message:
                    `Data ditemukan. Anda akan menghapus nopol *${String(nopol).toUpperCase()}* dari leasing *${String(leasingCode).toUpperCase()}*.\n\n` +
                    `*WAJIB REPLY pesan ini* lalu ketik nomor alasan (contoh: 1):\n` +
                    reasonsText,
            });

            return;
        }

        // =========================
        // 2) TANPA QUOTE: tidak ada nopol -> tampilkan format (rule lama)
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
// 3) SINGLE (1 nopol): boleh TANPA QUOTE untuk memulai (rule lama),
//    tapi KONFIRMASI alasan tetap WAJIB QUOTE menu alasan (ditangani di tryConfirm...)
// =========================
        if (nopolList.length === 1) {
            const nopol = String(nopolList[0] || "").trim().toUpperCase();
            if (!nopol) return;

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

            // MODE INPUT_DATA: leasing wajib disebut di command
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

            // =========================
            // CEK DULU KEBERADAAN NOPOL
            // =========================
            let cekRes;
            try {
                cekRes = await cekNopolFromApi(nopol);
            } catch (e) {
                await sendText({
                    ...ctx,
                    message: `❌ Gagal cek data nopol sebelum hapus.\n${e?.message || "Unknown error"}`,
                });
                return;
            }

            if (!cekRes?.ok) {
                await sendText({
                    ...ctx,
                    message:
                        `❌ Nopol *${nopol}* tidak ditemukan.\n` +
                        `Penghapusan dibatalkan.`,
                });
                return;
            }

            const actualLeasing = String(cekRes?.leasing_code || cekRes?.leasing || "").trim().toUpperCase();
            const expectedLeasing = String(leasingCode || "").trim().toUpperCase();

            if (expectedLeasing && actualLeasing && actualLeasing !== expectedLeasing) {
                await sendText({
                    ...ctx,
                    message:
                        `❌ Data ditemukan, tetapi leasing tidak sesuai.\n` +
                        `Nopol: *${nopol}*\n` +
                        `Leasing data: *${actualLeasing}*\n` +
                        `Leasing target: *${expectedLeasing}*`,
                });
                return;
            }

            const sender = webhook?.senderData?.sender || "";
            const pKey = makePendingKey({ chatId, sender });

            const hist = await createDeleteHistory({
                WaDeleteHistory,
                chatId,
                nopol,
                sender,
                leasingCode,
                modeKey,
                source: "SINGLE_TEXT",
                meta: {
                    quotedOnly: false,
                    cekResult: {
                        leasing_code: cekRes?.leasing_code || null,
                        leasing: cekRes?.leasing || null,
                        source: cekRes?.source || null,
                        matchedBy: cekRes?.matchedBy || null,
                    },
                },
            });

            await pendingDelStore.set(pKey, {
                step: "choose_reason",
                modeKey,
                nopol,
                leasingCode,
                source: "SINGLE_TEXT",
                historyId: hist.id,
            });

            const reasonsText = DELETE_REASONS.map((r, i) => `${i + 1}. ${r}`).join("\n");

            await sendText({
                ...ctx,
                message:
                    `Data ditemukan. Anda akan menghapus nopol *${nopol}* dari leasing *${leasingCode}*.\n\n` +
                    `*WAJIB REPLY pesan ini* lalu ketik nomor alasan (contoh: 1):\n` +
                    reasonsText,
            });

            return;
        }

        // =========================
        // 4) BULK (>1): tetap runPaidCommand (rule lama) + endpoint baru
        // =========================
        let leasingCode = "";

        if (modeKey === "leasing") {
            if (!group.leasing_id) {
                await sendText({ ...ctx, message: "❌ Group ini belum diset leasing. Jalankan: set leasing <kode>" });
                return;
            }
            const leasing = await LeasingCompany.findByPk(group.leasing_id);
            leasingCode = String(leasing?.code || "").toUpperCase();
        }

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
                    const apiRes = await bulkDeleteNopol({ leasingCode, nopolList });

                    const success = Array.isArray(apiRes?.success) ? apiRes.success : [];
                    const notFound = Array.isArray(apiRes?.notFound) ? apiRes.notFound : [];
                    const successCount = Number(apiRes?.successCount ?? success.length ?? 0);
                    const notFoundCount = Number(apiRes?.notFoundCount ?? notFound.length ?? 0);

                    const lines = [];
                    lines.push(`*HAPUS NOPOL (TITIPAN)*`);
                    lines.push(`Leasing: *${String(apiRes?.leasing || leasingCode).toUpperCase()}*`);
                    lines.push(`Requested: *${apiRes?.requested ?? nopolList.length}*`);

                    if (successCount > 0) {
                        lines.push(`✅ Berhasil dihapus (*${successCount}*):`);
                        lines.push(success.map((x) => `• ${String(x).toUpperCase()}`).join("\n"));
                    }

                    if (notFoundCount > 0) {
                        lines.push(`➖ Tidak ditemukan (*${notFoundCount}*):`);
                        lines.push(notFound.map((x) => `• ${String(x).toUpperCase()}`).join("\n"));
                    }

                    if (successCount === 0 && notFoundCount > 0) {
                        lines.push(`➖ Tidak ada nopol yang dihapus karena tidak ditemukan.`);
                    }

                    return {
                        text: lines.join("\n").trim(),
                        // RULE LAMA: charge hanya kalau ada sukses
                        chargeable: successCount > 0,
                        chargeUnits: successCount,
                    };
                } catch (e) {
                    const d = e?.response?.data;

                    if (d?.ok === false && /leasing/i.test(String(d?.message || ""))) {
                        const mismatch = Array.isArray(d?.mismatch) ? d.mismatch : [];
                        const details = mismatch.length
                            ? "\n" + mismatch.map((x) => `• ${String(x.nopol || "").toUpperCase()} (actual: ${String(x.actualLeasing || "-").toUpperCase()})`).join("\n")
                            : "";

                        return {
                            text:
                                `❌ Gagal hapus nopol (leasing tidak sesuai).\n` +
                                `Param leasing: *${String(d?.leasingParam || "").toUpperCase()}*\n` +
                                `Mismatch: *${d?.mismatchCount ?? mismatch.length}*` +
                                details,
                            chargeable: false,
                            chargeUnits: 0,
                        };
                    }

                    const msg =
                        (typeof d === "string" ? d : (d?.error || d?.message)) ||
                        e?.message ||
                        "Unknown error";

                    return {
                        text: `❌ Gagal hapus nopol.\n${msg}`,
                        chargeable: false,
                        chargeUnits: 0,
                    };
                }
            },
        });

        return;
    }



    // ... di dalam handleIncoming:
    if (key === "cek_nopol") {
        if (!(await guardFeature({ groupId: group.id, featureKey: "cek_nopol", ctx, sendText }))) {
            return;
        }
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



// command: request lokasi
    if (key === "history") {
        if (!(await guardFeature({ groupId: group.id, featureKey: "history", ctx, sendText }))) {
            return;
        }
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
                    nopol: r?.resolvedNopol || plate,
                    leasing: dataLeasingUp || groupLeasingUp || "-",
                    items,
                    page: 1,
                    perPage: 10,
                    mode: r?.mode || "",
                    input: r?.input || plate,
                });

                return { text: msg, chargeable: true };
            },
        });

        return;
    }

    if (key === "request_lokasi") {
        if (!(await guardFeature({ groupId: group.id, featureKey: "request_lokasi", ctx, sendText }))) {
            return;
        }
        const rawInput = [args[0], ...(argsLines || [])].filter(Boolean).join(" ").trim();
        const { phone: targetPhone, name: targetName } = parseRequestLokasiInput(rawInput);

        if (!targetPhone && !targetName) {
            await sendText({
                ...ctx,
                message: "❌ Format:\nrequest_lokasi 081385695993\natau\nrequest_lokasi Andilau Soares",
            });
            return;
        }

        const modeKey = String((await getModeKeyCached(group.mode_id)) || "").toLowerCase();
        const isGateway = modeKey === "gateway";

        const labelTarget = targetPhone || targetName;

        // ====== MODE GATEWAY: hasil sukses -> PERSONAL ======
        if (isGateway) {
            const personalChatId = webhook?.senderData?.sender || null;

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

            // 1) PRECHECK PERSONAL
            const pre = await checkAndDebit({
                commandKey: "request_lokasi",
                group,
                webhook,
                ref_type: "WA_MESSAGE",
                ref_id: webhook?.idMessage || null,
                notes: `request_lokasi:${labelTarget}`,
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
                r = await requestLokasiTerbaru({
                    phone: targetPhone,
                    name: targetName,
                });
            } catch (e) {
                await sendText({
                    ...ctx,
                    message: `❌ Error request lokasi.\n${e?.message || "Unknown error"}`,
                });
                return;
            }

            // 3) not found -> GROUP only, no debit
            if (!r?.ok) {
                await sendText({
                    ...ctx,
                    message: `❌ Lokasi terbaru tidak ditemukan untuk *${labelTarget}*`,
                });
                return;
            }

            // 4) DEBIT PERSONAL
            const bill = await checkAndDebit({
                commandKey: "request_lokasi",
                group,
                webhook,
                ref_type: "WA_MESSAGE",
                ref_id: webhook?.idMessage || null,
                notes: `request_lokasi:${labelTarget}`,
                phone_e164: phone,
                debit: true,
                units: 1,
                wallet_scope_override: "PERSONAL",
            });

            if (!bill.ok || !bill.allowed) {
                await sendText({ ...ctx, message: `❌ ${bill.error || "Kredit tidak cukup"}` });
                return;
            }

            // 5) PERSONAL result
            const resultText = formatRequestLokasiMessage(r);
            const personalMsg =
                `${resultText}\n\n` +
                `💳 Kredit terpakai: ${bill.credit_cost}\n` +
                `Sisa: ${bill.balance_after}`;

            await sendPersonal(personalMsg);

            // 6) GROUP notif
            await sendText({
                ...ctx,
                message: `✅ Lokasi terbaru untuk *${labelTarget}* ditemukan.\n📩 Detail dikirim ke chat pribadi pengirim.`,
            });

            return;
        }

        // ====== MODE LAIN: langsung ke GROUP ======
        await runPaidCommand({
            commandKey: "request_lokasi",
            group,
            webhook,
            ctx,
            phone_e164: phone,
            args: {
                targetPhone,
                targetName,
                labelTarget,
            },
            replyBuilder: async ({ targetPhone, targetName, labelTarget }) => {
                const r = await requestLokasiTerbaru({
                    phone: targetPhone,
                    name: targetName,
                });

                if (!r?.ok) {
                    return {
                        text: `❌ Lokasi terbaru tidak ditemukan untuk *${labelTarget}*`,
                        chargeable: false,
                    };
                }

                return {
                    text: formatRequestLokasiMessage(r),
                    chargeable: true,
                    chargeUnits: 1,
                };
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
        if (!(await guardFeature({ groupId: group.id, featureKey: "tarik_report", ctx, sendText }))) {
            return;
        }
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

            const meta = await saveTempFile(buf, filename);

// base public untuk link
            const PUBLIC_BASE = process.env.PUBLIC_BASE_URL;
// contoh: https://check.onestopcheck.id  atau domain yang bisa diakses user WA
            const link = `${PUBLIC_BASE}/api/temp-files/dl/${meta.token}`;

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

    if (key === "report_pengguna") {
        // hanya master
        if (!master) {
            await sendText({
                ...ctx,
                message: "❌ Command ini hanya bisa digunakan oleh master.",
            });
            return;
        }

        // hanya mode management
        const modeKey = String((await getModeKeyCached(group.mode_id)) || "").toLowerCase();
        if (modeKey !== "management") {
            await sendText({
                ...ctx,
                message: "❌ Command ini hanya bisa dipakai di group dengan mode management.",
            });
            return;
        }

        const baseUrl = "https://api.digitalmanager.id";
        if (!baseUrl) {
            await sendText({ ...ctx, message: "❌ BASE_URL belum diset di env." });
            return;
        }

        await sendText({ ...ctx, message: "⏳ Sedang menyiapkan report pengguna excel..." });

        try {
            const buf = await fetchUsersReportXlsx({ baseUrl });

            const now = new Date();
            const yyyy = now.getFullYear();
            const mm = String(now.getMonth() + 1).padStart(2, "0");
            const dd = String(now.getDate()).padStart(2, "0");
            const hh = String(now.getHours()).padStart(2, "0");
            const mi = String(now.getMinutes()).padStart(2, "0");

            const filename = `report-pengguna-${yyyy}${mm}${dd}-${hh}${mi}.xlsx`;

            const meta = await saveTempFile(
                buf,
                filename,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );

            const PUBLIC_BASE = process.env.PUBLIC_BASE_URL;
            if (!PUBLIC_BASE) {
                await sendText({
                    ...ctx,
                    message: "❌ PUBLIC_BASE_URL belum diset di env.",
                });
                return;
            }

            const link = `${PUBLIC_BASE}/api/temp-files/dl/${meta.token}`;

            await sendText({
                ...ctx,
                message:
                    `✅ Report pengguna siap.\n` +
                    `Mode: MANAGEMENT\n` +
                    `Akses: MASTER ONLY\n\n` +
                    `⬇️ Download (berlaku 5 menit):\n${link}`,
            });
        } catch (e) {
            await sendText({
                ...ctx,
                message: `❌ Gagal tarik report pengguna.\n${e?.message || "Unknown error"}`,
            });
        }

        return;
    }

    if (key === "rekap_data") {
        if (!(await guardFeature({ groupId: group.id, featureKey: "rekap_data", ctx, sendText }))) {
            return;
        }
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

        // ===== cabangParam sama seperti tarik_report =====
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
            const names = rows
                .map(r => r.branch?.name || r.branch?.code)
                .filter(Boolean)
                .map(s => String(s).trim().toUpperCase());

            // bisa multi: "A,B,C"
            cabangParam = names.join(",");
        } else {
            cabangParam = ""; // HO / unset
        }

        // hitung jumlah cabang (buat rule >20 => excel)
        const cabangCount = cabangParam
            ? cabangParam.split(",").map(s => s.trim()).filter(Boolean).length
            : 0;

        const baseUrl = "https://api.digitalmanager.id";
        const PUBLIC_BASE = process.env.PUBLIC_BASE_URL;

        await sendText({ ...ctx, message: "⏳ Sedang ambil rekap jumlah data..." });

        try {
            // rule: kalau cabang kosong atau >20 -> excel
            const forceExcel = !cabangParam || cabangCount > 20;

            const { kind, json, buffer } = await fetchRekapDataXlsx({
                baseUrl,
                leasing: leasingCode,
                cabang: forceExcel ? "" : cabangParam,
                source: "all",
            });

            if (!forceExcel && kind === "json") {
                const msg = formatRekapJumlahDataText(json);
                await sendText({ ...ctx, message: msg });
                return;
            }

            // excel flow (baik karena forceExcel atau API balas xlsx)
            const filename = `rekap-data-${leasingCode}-${Date.now()}.xlsx`;
            const meta = await saveTempFile(buffer || Buffer.from([]), filename);
            const link = `${PUBLIC_BASE}/api/temp-files/dl/${meta.token}`;

            await sendText({
                ...ctx,
                message:
                    `✅ Rekap data siap.\n` +
                    `Leasing: ${leasingCode}\n` +
                    `Cabang: ${cabangParam || "NASIONAL"}\n` +
                    `⬇️ Download (berlaku 5 menit):\n${link}`,
            });
        } catch (e) {
            await sendText({ ...ctx, message: `❌ Gagal ambil rekap.\n${e?.message || "Unknown error"}` });
        }

        return;
    }

    if (key === "get_statistik") {
        if (!(await guardFeature({ groupId: group.id, featureKey: "get_statistik", ctx, sendText }))) {
            return;
        }
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

        // parse args: bisa ada "cabang X ..." + waktu
        const argsText = (args[0] || "").trim();
        const parsed = parseStatistikArgs(argsText);
        if (!parsed.ok) {
            await sendText({ ...ctx, message: `❌ ${parsed.error}` });
            return;
        }

        // cabang default dari group
        let cabangParam = await resolveCabangParamFromGroup({ group, LeasingBranch, WaGroupLeasingBranch });

        // override cabang jika user tulis "cabang ..."
        if (parsed.cabangOverride) {
            cabangParam = parsed.cabangOverride; // hanya cabang itu
        }

        const PUBLIC_BASE = process.env.PUBLIC_BASE_URL;
        if (!PUBLIC_BASE) {
            await sendText({ ...ctx, message: "❌ PUBLIC_BASE_URL belum diset di env." });
            return;
        }

        await sendText({ ...ctx, message: "⏳ Sedang tarik gambar statistik..." });

        try {
            const buf = await fetchAccessStatPng({
                leasing: leasingCode,
                cabang: cabangParam || "",
                year: parsed.year || "",
                month: parsed.month || "",
                day: parsed.day || "",
                start: parsed.start || "",
                end: parsed.end || "",
            });

            // nama file rapih
            const labelSafe = String(parsed.label || "stat")
                .replace(/[^\w.\-]+/g, "_")
                .slice(0, 40);

            const filename = `stat-access-${leasingCode}-${labelSafe}.png`;

            const meta = await saveTempFile(buf, filename, "image/png");
            const link = `${PUBLIC_BASE}/api/temp-files/dl/${meta.token}`;

            await sendText({
                ...ctx,
                message:
                    `✅ Statistik siap.\n` +
                    `Leasing: ${leasingCode}\n` +
                    `Cabang: ${cabangParam || "NASIONAL"}\n` +
                    `Waktu: ${parsed.label}\n\n` +
                    `🖼️ Link (berlaku 5 menit):\n${link}`,
            });
        } catch (e) {
            await sendText({ ...ctx, message: `❌ Gagal tarik statistik.\n${e?.message || "Unknown error"}` });
        }

        return;
    }

    // misal di parseCommandV2 kamu mapping "buat akun" -> key "buat_akun"
    if (key === "buat_akun") {
        if (!(await guardFeature({ groupId: group.id, featureKey: "buat_akun", ctx, sendText }))) {
            return;
        }
        const template = buildRegisterTemplate();

        const sent1 = await sendText({ ...ctx, message: template });
        const quotedId = sent1?.idMessage || sent1?.messageId || sent1?.id;

        await sendText({
            ...ctx,
            quotedMessageId: quotedId,
            message:
                "Untuk menginput data, salin dan isi template di atas.\n" +
                "Ket:\n" +
                "- Jabatan :\n" +
                "  1 = Handle Nasional\n" +
                "  2 = Handle Beberapa Cabang\n" +
                "  3 = Handle 1 Cabang\n" +
                "- Kelola Bahan :\n" +
                "  1 = R2\n" +
                "  2 = R4\n" +
                "  3 = MIX",
        });

        return;
    }

    // =========================
// ✅ PT: LIST ANGGOTA
// Command:
// - list anggota
// - list anggota aktif
// - list anggota nonaktif
// =========================
    if (key === "pt_list_members") {
        // hanya mode pt
        const modeKeyNow = String((await getModeKeyCached(group.mode_id)) || "").toLowerCase();
        if (modeKeyNow !== "pt") {
            await sendText({
                ...ctx,
                message: "❌ Command ini hanya bisa dipakai di group dengan mode PT.\nGunakan: set mode pt (master)",
            });
            return;
        }

        if (!group.pt_company_id) {
            await sendText({
                ...ctx,
                message: "❌ PT group belum diset.\nGunakan: set pt <nama pt> (master)",
            });
            return;
        }

        const ptRow = await PtCompany.findByPk(group.pt_company_id, { attributes: ["code", "name"] });
        const ptName = String(ptRow?.name || ptRow?.code || "").trim();
        if (!ptName) {
            await sendText({ ...ctx, message: "❌ Data PT tidak valid di group." });
            return;
        }

        const mode = String(args?.[0] || "all").toLowerCase(); // all|active|inactive

        await sendText({ ...ctx, message: "⏳ Sedang ambil list anggota PT..." });

        try {
            const r = await fetchPtMembers({ ptName, mode });

            const messages = buildPtMembersMessages({
                pt: r.pt || ptName,
                mode: r.mode,
                items: r.items,
                count: r.count,
            });

            // kirim bertahap (biar WA aman)
            for (let i = 0; i < messages.length; i++) {
                await sendText({ ...ctx, message: messages[i] });

                // optional: jeda dikit biar gak “spam flood”
                if (i < messages.length - 1) {
                    await new Promise((resolve) => setTimeout(resolve, 350));
                }
            }
        } catch (e) {
            const status = e?.response?.status;
            const data = e?.response?.data;
            const errMsg =
                typeof data === "string"
                    ? data
                    : (data?.error || data?.message || e?.message || "Unknown error");

            await sendText({
                ...ctx,
                message: `❌ Gagal ambil anggota PT.\n${status ? `HTTP ${status}\n` : ""}${errMsg}`,
            });
        }

        return;
    }

    if (key === "list_file") {
        // perintah: "list file front"
        const dir = (args[0] || "").trim();

        try {
            const data = await listSftpFiles({ dir });
            const files = Array.isArray(data.files) ? data.files : [];

            if (!files.length) {
                await sendText({
                    ...ctx,
                    message:
                        `✅ List file OK\n` +
                        `Dir: ${data.dir}\n` +
                        `Path: ${data.path || "-"}\n\n` +
                        `⚠️ Tidak ada file.`,
                });
                return;
            }

            // optional: sort by modifyTime desc
            files.sort((a, b) => Number(b.modifyTime || 0) - Number(a.modifyTime || 0));

            const lines = files.slice(0, 20).map((f, i) => {
                return (
                    `${i + 1}. ${f.name}\n` +
                    `   size: ${formatBytes(f.size)} | mtime: ${formatTime(f.modifyTime)}`
                );
            });

            const more = files.length > 20 ? `\n\n…dan ${files.length - 20} file lainnya.` : "";

            await sendText({
                ...ctx,
                message:
                    `✅ List file OK\n` +
                    `Dir: ${data.dir}\n` +
                    `Path: ${data.path || "-"}\n\n` +
                    lines.join("\n") +
                    more +
                    `\n\n📥 Ambil file:\nget file ${data.dir} <nama file>`,
            });
        } catch (e) {
            await sendText({ ...ctx, message: `❌ Gagal list file.\n${e?.message || "Unknown error"}` });
        }
        return;
    }

    if (key === "get_file") {
        // perintah: "get file front <nama file...>"
        const dir = (args[0] || "").trim();
        const fileName = String(args.slice(1).join(" ") || "").trim(); // nama file bisa ada spasi

        if (!dir) {
            await sendText({ ...ctx, message: "❌ Format: get file <dir> <nama file.xlsx>" });
            return;
        }
        if (!fileName) {
            await sendText({ ...ctx, message: "❌ Masukkan nama file. Contoh:\nget file front BAHAN_....xlsx" });
            return;
        }

        const PUBLIC_BASE = process.env.PUBLIC_BASE_URL;
        if (!PUBLIC_BASE) {
            await sendText({ ...ctx, message: "❌ PUBLIC_BASE_URL belum diset di env." });
            return;
        }

        await sendText({ ...ctx, message: "⏳ Sedang download file..." });

        try {
            const { buffer, filename } = await downloadSftpFileXlsx({ dir, file: fileName });

            // simpan temp (TTL 5 menit)
            const meta = await saveTempFile(buffer, filename);

            // re-use endpoint download temp kamu (kalau sudah ada)
            // contoh sebelumnya: /api/temp-reports/dl/report/:token
            // kalau mau dipakai juga untuk file ini, boleh:
            const link = `${PUBLIC_BASE}/api/temp-files/dl/${meta.token}`;

            await sendText({
                ...ctx,
                message:
                    `✅ File siap.\n` +
                    `Dir: ${dir}\n` +
                    `File: ${filename}\n\n` +
                    `⬇️ Download (berlaku 5 menit):\n${link}`,
            });
        } catch (e) {
            await sendText({ ...ctx, message: `❌ Gagal ambil file.\n${e?.message || "Unknown error"}` });
        }

        return;
    }

    if (key === "vpn_up") {
        await sendText({ ...ctx, message: "⏳ Menghubungkan VPN (ipsec up myvpn)..." });

        try {
            const r = await vpnUp(); // { ok:true, message, output }
            const out = String(r?.output || "").trim();

            await sendText({
                ...ctx,
                message:
                    "✅ VPN UP sukses.\n" +
                    (out ? `\nOutput:\n${out}` : ""),
            });
        } catch (e) {
            await sendText({
                ...ctx,
                message: `❌ VPN UP gagal.\n${e?.message || "Unknown error"}`,
            });
        }
        return;
    }

    if (key === "vpn_status") {
        await sendText({ ...ctx, message: "⏳ Mengecek status VPN..." });

        try {
            const r = await vpnStatus(); // { ok:true, output }
            const out = String(r?.output || "");

            const isEstablished =
                out.includes("ESTABLISHED") &&
                !out.includes("0 up");

            if (isEstablished) {
                await sendText({
                    ...ctx,
                    message: "🟢 VPN STATUS: ESTABLISHED (CONNECTED)",
                });
            } else {
                await sendText({
                    ...ctx,
                    message: "🔴 VPN STATUS: NOT CONNECTED",
                });
            }
        } catch (e) {
            await sendText({
                ...ctx,
                message: `❌ VPN STATUS gagal.\n${e?.message || "Unknown error"}`,
            });
        }

        return;
    }

    // fallback
    await sendText({ ...ctx, message: `Command tidak dikenal.\nKetik: help` });
}
