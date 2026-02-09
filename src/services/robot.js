import {
    WaPrivateWhitelist,
    WaMaster,
    WaGroup,
    WaGroupMode,
    LeasingCompany,
    LeasingBranch,
    WaGroupLeasingBranch,
    PtCompany,
} from "../models/index.js";

import { sendText } from "./greenapi.js";
import { normalizePhone, extractText, isGroupChat, parseCommandV2 } from "./parser.js";

import { buildInputTemplate, parseFilledTemplate, sendToNewHunter } from "./inputData/inputData.js";
import { bulkDeleteNopol } from "./deleteNopol/deleteNopol.js"; // atau file helper baru

import { resolvePolicy } from "./waCommandPolicyService.js";
import { debitIfNeeded } from "./waCreditService.js";
import { dummyCekNopol, dummyHistory, dummyRequestLokasi } from "./waDummyApis.js";
import { checkAndDebit } from "./billingService.js";

// robot.js (tambahkan import di atas)
import { getAccessHistoryByNopol } from "./history/newhunterHistory.js";
import { formatHistoryMessage, resolveLeasingFromItems } from "./history/historyFormatter.js";

// robot.js (tambahkan import di atas)
import { cekNopolFromApi, formatCekNopolMessage } from "./cekNopol/newhunterCekNopol.js";

// import { LRUCache } from "lru-cache";
//
// const cache = new LRUCache({
//     max: 200, ttl: 10 * 60 * 1000
// });

import {fetchJson,  fetchBool, fetchString, TTL, CacheKeys, CacheInvalidate } from "./cacheService.js";


async function getGroupCached(chatId, chatName) {
    return fetchJson(
        CacheKeys.group(chatId),
        async () => {
            // ambil minimal kolom yang dipakai di handler
            const g = await WaGroup.findOne({
                where: { chat_id: chatId },
                attributes: [
                    "id",
                    "chat_id",
                    "title",
                    "is_bot_enabled",
                    "mode_id",
                    "leasing_id",
                    "leasing_level",
                    "leasing_branch_id",
                    "pt_company_id",
                ],
            });

            if (g) return g.toJSON();

            const created = await WaGroup.create({
                chat_id: chatId,
                title: chatName || null,
                is_bot_enabled: false,
                notif_data_access_enabled: false,
                mode_id: null,
                leasing_id: null,
                leasing_level: null,
                leasing_branch_id: null,
                pt_company_id: null,
            });

            return created.toJSON();
        },
        TTL.GROUP_SHORT
    );
}

// helper: update group + invalidate cache
async function updateGroup(groupId, patch) {
    await WaGroup.update(patch, { where: { id: groupId } });
    // invalidate by chatId (lebih gampang kalau patch caller pegang chatId)
}

async function getLeasingCodeCached(leasingId) {
    if (!leasingId) return "";
    return fetchString(
        CacheKeys.leasingCode(leasingId),
        async () => {
            const row = await LeasingCompany.findByPk(leasingId, { attributes: ["code"] });
            return String(row?.code || "").trim().toUpperCase();
        },
        TTL.LEASING_CODE
    );
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

// helper: master check
async function isMasterPhone(phone) {
    if (!phone) return false;
    const row = await WaMaster.findOne({ where: { phone_e164: phone, is_active: true } });
    return !!row;
}

// helper: whitelist private
async function checkPrivateWhitelist(phone) {
    const row = await WaPrivateWhitelist.findOne({ where: { phone_e164: phone, is_active: true } });
    return !!row;
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

async function runPaidCommand({ commandKey, group, webhook, ctx, args, replyBuilder }) {
    const bill = await checkAndDebit({
        commandKey,
        group,
        webhook,
        ref_type: "WA_MESSAGE",
        ref_id: webhook?.idMessage || null,
        notes: commandKey,
    });

    if (!bill.ok) {
        await sendText({ ...ctx, message: `❌ ${bill.error || "Gagal billing"}` });
        return;
    }

    if (!bill.allowed) {
        await sendText({ ...ctx, message: `❌ ${bill.error || "Tidak diizinkan"}` });
        return;
    }

    const out = await replyBuilder(args);

    const extra = bill.charged
        ? `\n\n💳 Kredit terpakai: ${bill.credit_cost}\nSisa: ${bill.balance_after}`
        : `\n\n✔️ *_Accessible_*`;

    await sendText({ ...ctx, message: String(out || "") + extra });
}

const t = (label) => {
    const start = Date.now();
    return () => console.log(label, Date.now() - start, "ms");
};


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
    const { key, args, argsLines } = parseCommandV2(text);

    // jika bot mati, stop (kecuali help/aktifkan robot dsb yang sudah kamu handle)
    if (!group.is_bot_enabled) {
        // tetap boleh proses "aktifkan robot" / "help" di code kamu sebelumnya
        // jadi taruh block ini setelah handle "robot_on/robot_off/help"
    }

    // ✅ DETEKSI TEMPLATE SUBMISSION (tanpa perlu command)
    const filled = parseFilledTemplate(text);
    if (filled && (filled.type === "R2" || filled.type === "R4")) {
        // pastikan mode sesuai (kamu minta: template berbeda tergantung mode)
        const modeKey = String(await getModeKeyCached(group.mode_id) || "").toLowerCase();

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
            type: filled.type,          // ✅ R2 atau R4
            visibility: "Publik",
        };

        try {
            const apiRes = await sendToNewHunter({
                phone,          // dari normalizePhone(senderJid)
                senderId: chatId,
                payload,
            });

            await sendText({
                ...ctx,
                message: `✅ Data berhasil dikirim.\nRef: ${apiRes?.id || apiRes?.ref || "-"}`,
            });
        } catch (e) {
            const status = e?.response?.status;
            const data = e?.response?.data; // bisa string atau object
            const msg =
                typeof data === "string"
                    ? data
                    : (data?.error || data?.message || "");

            // ✅ kasus nopol sudah ada (anggap sukses informatif)
            if (status === 400 && /nopol\s*sudah\s*ada/i.test(msg)) {
                await sendText({
                    ...ctx,
                    message: `ℹ️ Data sudah ada di sistem (NOPOL: ${payload.nopol}).`,
                });
                return;
            }

            // ❌ selain itu tetap dianggap gagal
            console.error("SEND DATA ERROR", {
                status,
                data,
                message: e?.message,
            });

            await sendText({
                ...ctx,
                message: `❌ Gagal kirim data ke server.\n${msg || e.message}`,
            });
        }
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
        if (!master) return;
        group.is_bot_enabled = true;
        await group.save();
        await sendText({ ...ctx, message: "✅ Robot diaktifkan untuk group ini." });
        return;
    }
    if (key === "robot_off") {
        if (!master) return;
        group.is_bot_enabled = false;
        await group.save();
        await sendText({ ...ctx, message: "⛔ Robot dimatikan untuk group ini." });
        return;
    }

    // kalau bot mati, stop selain command master yang menghidupkan / help
    if (!group.is_bot_enabled) return;

    if (key === "ping") {
        await sendText({ ...ctx, message: "pong ✅" });
        return;
    }


    // set mode leasing / input data / pt
    if (key === "set_mode") {
        if (!master) return;

        // args bisa ["input","data"] atau ["leasing"] atau ["pt"]
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

        // ✅ MODE PT
        if (raw === "pt") {
            const r = await ensureModePT(group);
            if (!r.ok) {
                await sendText({ ...ctx, message: `❌ ${r.error}` });
                return;
            }
            await sendText({ ...ctx, message: "✅ Mode group diset: PT" });
            return;
        }

        await sendText({
            ...ctx,
            message:
                "❌ Mode tidak dikenal.\n" +
                "Mode yang didukung:\n" +
                "- set mode leasing\n" +
                "- set mode input data\n" +
                "- set mode pt",
        });
        return;
    }

    // set leasing adira
    if (key === "set_leasing") {
        if (!master) return;
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
        if (!master) return;

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
        if (!master) return;

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
        if (!master) return;

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
        if (!master) return;

        group.notif_data_access_enabled = true;
        await group.save();

        await sendText({
            ...ctx,
            message: "✅ Notifikasi data diaktifkan untuk group ini.",
        });
        return;
    }

    if (key === "group_stop") {
        if (!master) return;

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
    if (key === "delete_nopol") {
        // master-only biar aman
        // if (!master) return;

        const nopolList = parseNopolList(args[0] || "", argsLines);

        if (nopolList.length === 0) {
            await sendText({
                ...ctx,
                message:
                    "❌ Format:\n" +
                    "hapus nopol DA1234BC,DA2345BB\n" +
                    "atau:\n" +
                    "hapus nopol\nDA1234BC\nDA2345BB",
            });
            return;
        }

        const modeKey = String(await getModeKeyCached(group.mode_id) || "").toLowerCase();

        const allowedModes = new Set(["leasing", "input_data"]);
        if (!allowedModes.has(modeKey)) {
            await sendText({ ...ctx, message: "❌ Command ini hanya boleh di mode leasing atau input data." });
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
                        "DA1234BC\nDA2345BB",
                });
                return;
            }
        }

        if (!leasingCode) {
            await sendText({ ...ctx, message: "❌ Leasing code tidak valid." });
            return;
        }

        try {
            const apiRes = await bulkDeleteNopol({
                leasingCode,
                nopolList,
            });

            await sendText({
                ...ctx,
                message:
                    `🗑️ Bulk delete dikirim.\n` +
                    `Leasing: ${leasingCode}\n` +
                    `Jumlah nopol: ${nopolList.length}\n` +
                    `Server: ${apiRes?.message || "OK"}`,
            });
        } catch (e) {
            await sendText({
                ...ctx,
                message: `❌ Gagal hapus nopol.\n${e?.response?.data?.error || e.message}`,
            });
        }
        return;
    }

    // ... di dalam handleIncoming:
    if (key === "cek_nopol") {
        const plate = normPlate(args[0] || ""); // dari helper kamu
        if (!plate) {
            await sendText({ ...ctx, message: "❌ Format: cek nopol AB1234CD" });
            return;
        }

        // Leasing group (kalau group sudah diset leasing)
        let groupLeasingCode = "";
        if (group.leasing_id) {
            const leasingRow = await LeasingCompany.findByPk(group.leasing_id, { attributes: ["code"] });
            groupLeasingCode = String(leasingRow?.code || "").trim().toUpperCase();
        }

        await runPaidCommand({
            commandKey: "cek_nopol",
            group,
            webhook,
            ctx,
            leasingId: group.leasing_id || null,
            groupId: group.id,
            args: { plate },
            replyBuilder: async ({ plate }) => {
                const r = await cekNopolFromApi(plate);
                if (!r?.ok) return `❌ ${r?.error || "Gagal cek nopol"}: ${plate}`;

                const dataLeasingUp = String(r.leasing_code || r.leasing || "").trim().toUpperCase();
                const groupLeasingUp = String(groupLeasingCode || "").trim().toUpperCase();

                // kalau group sudah set leasing, tapi hasil leasing beda -> mismatch
                if (groupLeasingUp && dataLeasingUp && dataLeasingUp !== groupLeasingUp) {
                    return (
                        `*CEK NOPOL HUNTER*\n` +
                        `*====================*\n` +
                        `Data ditemukan, tetapi bukan untuk leasing ini.\n` +
                        `Leasing data: *${dataLeasingUp}*\n` +
                        `Leasing group: *${groupLeasingUp}*`
                    ).trim();
                }

                // sukses normal
                return formatCekNopolMessage({
                    data: {
                        ...r,
                        // leasing tampilkan apa adanya (mis. "FIF" atau "FIF 1125" kalau nanti API ubah)
                        leasing: r.leasing || "-",
                    },
                    checkedByPhone: phone, // phone sudah normalizePhone(senderJid)
                });
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
    if (key === "request_lokasi") {
        const phone62 = normPhone62(args[0] || "");
        if (!phone62 || phone62.length < 8) {
            await sendText({ ...ctx, message: "❌ Format: request lokasi 08123456789" });
            return;
        }

        await runPaidCommand({
            commandKey: "request_lokasi",
            group,
            webhook,
            ctx,
            leasingId: group.leasing_id || null,
            groupId: group.id,
            args: { phone62 },
            replyBuilder: async ({ phone62 }) => {
                const r = await dummyRequestLokasi(phone62);
                if (!r.ok) return `❌ Gagal request lokasi ${phone62}`;
                return (
                    `📍 REQUEST LOKASI\n` +
                    `Target: ${r.phone}\n` +
                    `Status: ${r.status}\n` +
                    `${r.catatan || ""}`
                ).trim();
            },
        });
        return;
    }

    // command: set pt <kode>
    if (key === "set_pt") {
        if (!master) return;

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
        if (!master) return;
        group.pt_company_id = null;
        await group.save();
        await sendText({ ...ctx, message: "✅ PT group dihapus (unset)." });
        return;
    }

    // fallback
    await sendText({ ...ctx, message: `Command tidak dikenal.\nKetik: help` });
}
