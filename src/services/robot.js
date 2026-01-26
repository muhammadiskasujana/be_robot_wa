import {
    WaPrivateWhitelist,
    WaMaster,
    WaGroup,
    WaGroupMode,
    WaCommand,
    WaCommandMode,
    LeasingCompany,
    LeasingBranch,
    WaGroupLeasingBranch,
} from "../models/index.js";
import { sendText } from "./greenapi.js";
import { normalizePhone, extractText, parseCommand, isGroupChat } from "./parser.js";

async function isMasterPhone(phone) {
    if (!phone) return false;
    const row = await WaMaster.findOne({ where: { phone_e164: phone, is_active: true } });
    return !!row;
}

async function checkPrivateWhitelist(phone) {
    const row = await WaPrivateWhitelist.findOne({ where: { phone_e164: phone, is_active: true } });
    return !!row;
}

async function getOrCreateGroup(chatId, title) {
    let group = await WaGroup.findOne({ where: { chat_id: chatId } });
    if (group) return group;

    // default aman: bot OFF dulu sampai master /on
    group = await WaGroup.create({
        chat_id: chatId,
        title: title || null,
        is_bot_enabled: false,
        notif_data_access_enabled: false,
    });
    return group;
}

async function setGroupMode(group, modeKey) {
    const mode = await WaGroupMode.findOne({ where: { key: modeKey, is_active: true } });
    if (!mode) return { ok: false, error: "Mode tidak ditemukan" };
    group.mode_id = mode.id;
    await group.save();
    return { ok: true, mode };
}

async function toggleNotif(group, onoff) {
    group.notif_data_access_enabled = onoff === "on";
    await group.save();
}

async function setLeasingConfig(group, leasingCode, level, branchCodesCsv) {
    const leasing = await LeasingCompany.findOne({ where: { code: leasingCode, is_active: true } });
    if (!leasing) return { ok: false, error: `Leasing ${leasingCode} tidak ditemukan` };

    const lvl = (level || "").toUpperCase();
    if (!["HO", "AREA", "CABANG"].includes(lvl)) {
        return { ok: false, error: "Level harus HO / AREA / CABANG" };
    }

    group.leasing_id = leasing.id;
    group.leasing_level = lvl;

    // bersihkan pivot dulu (aturan: HO kosong; AREA replace list; CABANG 1)
    await WaGroupLeasingBranch.destroy({ where: { group_id: group.id } });
    group.leasing_branch_id = null;

    if (lvl === "HO") {
        await group.save();
        return { ok: true, leasing, level: lvl, branches: "ALL" };
    }

    // AREA/CABANG butuh cabang
    const rawCodes = (branchCodesCsv || "").trim();
    if (!rawCodes) return { ok: false, error: "Cabang wajib diisi untuk AREA/CABANG" };

    const codes = rawCodes.split(",").map(s => s.trim()).filter(Boolean);

    // cari cabang by code OR name (lebih fleksibel)
    const branches = await LeasingBranch.findAll({
        where: { leasing_id: leasing.id, is_active: true },
    });

    const byCode = new Map();
    for (const b of branches) {
        if (b.code) byCode.set(b.code.toUpperCase(), b);
        byCode.set(b.name.toUpperCase(), b);
    }

    const picked = [];
    for (const c of codes) {
        const b = byCode.get(c.toUpperCase());
        if (b) picked.push(b);
    }
    if (picked.length === 0) return { ok: false, error: "Cabang tidak ditemukan" };

    const finalPicked = lvl === "CABANG" ? [picked[0]] : picked;

    // simpan pivot
    await WaGroupLeasingBranch.bulkCreate(
        finalPicked.map(b => ({
            group_id: group.id,
            leasing_branch_id: b.id,
            is_active: true,
            created_at: new Date(),
            updated_at: new Date(),
        })),
        { ignoreDuplicates: true }
    );

    // optional shortcut untuk CABANG
    if (lvl === "CABANG") group.leasing_branch_id = finalPicked[0].id;

    await group.save();
    return { ok: true, leasing, level: lvl, branches: finalPicked };
}

async function commandAllowedInMode(command, group) {
    if (command.allow_all_modes) return true;
    if (!group?.mode_id) return false;

    const ok = await WaCommandMode.findOne({ where: { command_id: command.id, mode_id: group.mode_id } });
    return !!ok;
}

export async function handleIncoming({ instance, webhook }) {
    const chatId = webhook?.senderData?.chatId;
    const senderJid = webhook?.senderData?.sender;
    const chatName = webhook?.senderData?.chatName;
    const senderName = webhook?.senderData?.senderName;

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
        const allowed = await checkPrivateWhitelist(phone);
        if (!allowed) {
            // kamu bisa pilih: ignore saja atau balas.
            await sendText({ ...ctx, message: "❌ Nomor kamu belum terdaftar (whitelist)." });
            return;
        }

        const { key } = parseCommand(text);
        if (key === "ping") {
            await sendText({ ...ctx, message: "pong ✅" });
            return;
        }
        if (key === "help") {
            await sendText({
                ...ctx,
                message:
                    "Group commands:\n" +
                    "bot on (master)\n" +
                    "bot off (master)\n" +
                    "set mode <general|leasing> (master)\n" +
                    "toggle notif on|off (master)\n" +
                    "set leasing <CODE> <HO|AREA|CABANG> [cabang] (master)\n" +
                    "ping",
            });
            return;
        }

        await sendText({ ...ctx, message: `OK (private). Kamu kirim: ${text}` });
        return;
    }

    // ===== GROUP =====
    const group = await getOrCreateGroup(chatId, chatName);

    const { key, args } = parseCommand(text);
    if (!key) return; // ignore non-command di group

    const master = await isMasterPhone(phone);

    // Load command metadata dari DB (opsional tapi bagus)
    const cmdMeta = await WaCommand.findOne({ where: { key, is_active: true } });

    // Master-only enforcement dari metadata
    if (cmdMeta?.requires_master && !master) return;

    // scope check
    if (cmdMeta && cmdMeta.scope === "PRIVATE") return;

    // /help selalu jalan kalau bot off? boleh—tapi kamu bisa tentukan
    if (key === "help") {
        await sendText({
            ...ctx,
            message:
                "Group commands:\n" +
                "/on (master)\n/off (master)\n/mode <general|leasing> (master)\n/notif on|off (master)\n/leasing set <CODE> <HO|AREA|CABANG> [cabang] (master)\n/ping",
        });
        return;
    }

    if (key === "on") {
        if (!master) return;
        group.is_bot_enabled = true;
        await group.save();
        await sendText({ ...ctx, message: "✅ Bot diaktifkan untuk group ini." });
        return;
    }

    if (key === "off") {
        if (!master) return;
        group.is_bot_enabled = false;
        await group.save();
        await sendText({ ...ctx, message: "⛔ Bot dinonaktifkan untuk group ini." });
        return;
    }

    // jika bot mati, stop selain master command
    if (!group.is_bot_enabled) return;

    if (key === "ping") {
        await sendText({ ...ctx, message: "pong ✅" });
        return;
    }

    if (key === "mode") {
        if (!master) return;
        const modeKey = (args[0] || "").toLowerCase();
        const r = await setGroupMode(group, modeKey);
        if (!r.ok) {
            await sendText({ ...ctx, message: `❌ ${r.error}\nContoh: /mode leasing` });
            return;
        }
        await sendText({ ...ctx, message: `✅ Mode group diset: ${r.mode.key}` });
        return;
    }

    if (key === "notif") {
        if (!master) return;
        const onoff = (args[0] || "").toLowerCase();
        if (!["on", "off"].includes(onoff)) {
            await sendText({ ...ctx, message: "Format: /notif on | /notif off" });
            return;
        }
        await toggleNotif(group, onoff);
        await sendText({ ...ctx, message: `✅ Notif akses data: ${onoff.toUpperCase()}` });
        return;
    }

    if (key === "leasing") {
        if (!master) return;

        // format: /leasing set ADIRA HO
        // format: /leasing set ADIRA AREA BJM,BTG
        // format: /leasing set ADIRA CABANG BJM
        const sub = (args[0] || "").toLowerCase();
        if (sub !== "set") {
            await sendText({ ...ctx, message: "Format:\n/leasing set <CODE> <HO|AREA|CABANG> [CABANGS]" });
            return;
        }

        const leasingCode = (args[1] || "").toUpperCase();
        const level = (args[2] || "").toUpperCase();
        const branchesCsv = args.slice(3).join(" "); // bisa "BJM,BTG" atau "BJM,BTG,BJB"

        const r = await setLeasingConfig(group, leasingCode, level, branchesCsv);
        if (!r.ok) {
            await sendText({ ...ctx, message: `❌ ${r.error}` });
            return;
        }

        const branchText =
            r.branches === "ALL"
                ? "ALL CABANG (HO)"
                : Array.isArray(r.branches)
                    ? r.branches.map(b => b.code || b.name).join(", ")
                    : "-";

        await sendText({
            ...ctx,
            message: `✅ Leasing config set:\nLeasing: ${leasingCode}\nLevel: ${level}\nCabang: ${branchText}`,
        });
        return;
    }

    // Mode gating untuk command lain (kalau ada cmdMeta)
    if (cmdMeta) {
        const okMode = await commandAllowedInMode(cmdMeta, group);
        if (!okMode) {
            await sendText({ ...ctx, message: "❌ Command ini tidak diizinkan pada mode group saat ini." });
            return;
        }
    }

    // fallback
    await sendText({ ...ctx, message: `Command tidak dikenal: /${key}\nKetik /help` });
}
