export function normalizeText(s = "") {
    return String(s)
        .replace(/\r/g, "")
        .trim();
}

export function isGroupChat(chatId = "") {
    // greenapi group biasanya ...@g.us
    return String(chatId).includes("@g.us");
}

// Ambil semua text dari webhook (textMessage, extendedText, quoted)
export function extractText(webhook) {
    const t = webhook?.messageData?.textMessageData?.textMessage;
    const e = webhook?.messageData?.extendedTextMessageData?.text;
    const q = webhook?.messageData?.quotedMessage?.textMessage;
    return normalizeText(t || e || q || "");
}

export function normalizePhone(senderJid = "") {
    // contoh senderJid: "62812xxxx@c.us" atau "+62812..."
    const raw = String(senderJid).replace(/@c\.us|@g\.us/g, "");
    const digits = raw.replace(/[^\d]/g, "");
    if (!digits) return "";
    // kamu bisa pakai aturan e164 yang kamu pakai sebelumnya
    return digits.startsWith("0") ? "62" + digits.slice(1) : digits;
}

/**
 * Parse command berbasis kalimat.
 * - Support multiline, argsLines berisi baris setelah baris pertama.
 *
 * Contoh:
 * "tambah cabang
 *  banjarmasin
 *  jakarta"
 */
export function parseCommandV2(text, opts = {})  {
    const modeKey = String(opts?.modeKey || "").toLowerCase();
    const cleaned = normalizeText(text);
    if (!cleaned) return { key: "", args: [], argsLines: [] };

    const lines = cleaned.split("\n").map(l => l.trim()).filter(Boolean);
    const first = (lines[0] || "").toLowerCase();

    // key = frasa utama
    // kita detect beberapa frasa:
    if (first === "aktifkan robot") return { key: "robot_on", args: [], argsLines: lines.slice(1) };
    if (first === "matikan robot") return { key: "robot_off", args: [], argsLines: lines.slice(1) };

    // set mode leasing
    if (first.startsWith("set mode ")) {
        const mode = first.replace("set mode ", "").trim();
        return { key: "set_mode", args: [mode], argsLines: lines.slice(1) };
    }

    // set leasing adira
    if (first.startsWith("set leasing ")) {
        const code = first.replace("set leasing ", "").trim();
        return { key: "set_leasing", args: [code], argsLines: lines.slice(1) };
    }

    // unset leasing
    if (first === "unset leasing") {
        return { key: "unset_leasing", args: [], argsLines: lines.slice(1) };
    }

    // ✅ set pt <kode/nama>
    // contoh: "set pt PT MAJU MUNDUR" atau "set pt maju mundur"
    if (first.startsWith("set pt ")) {
        const code = first.replace("set pt ", "").trim();
        return { key: "set_pt", args: code ? [code] : [], argsLines: lines.slice(1) };
    }
    // juga dukung: "set pt" multiline (opsional)
    if (first === "set pt") {
        // ambil dari baris berikutnya (gabung)
        const code = lines.slice(1).join(" ").trim();
        return { key: "set_pt", args: code ? [code] : [], argsLines: [] };
    }

    // ✅ unset pt
    if (first === "unset pt") return { key: "unset_pt", args: [], argsLines: lines.slice(1) };
    // alias biar natural
    if (first === "hapus pt") return { key: "unset_pt", args: [], argsLines: lines.slice(1) };

    // start/stop group untuk akses notif data (master-only di handler)
    if (first === "start group") return { key: "group_start", args: [], argsLines: lines.slice(1) };
    if (first === "stop group") return { key: "group_stop", args: [], argsLines: lines.slice(1) };

    // tambah cabang ... (boleh di baris pertama atau multiline)
    if (first.startsWith("tambah cabang")) {
        const after = first.replace("tambah cabang", "").trim(); // bisa "nasional" atau "banjarmasin,jakarta"
        return { key: "add_branch", args: after ? [after] : [], argsLines: lines.slice(1) };
    }

    // hapus cabang ...
    if (first.startsWith("hapus cabang")) {
        const after = first.replace("hapus cabang", "").trim();
        return { key: "del_branch", args: after ? [after] : [], argsLines: lines.slice(1) };
    }

    if (first === "list cabang") {
        return { key: "list_branch", args: [], argsLines: lines.slice(1) };
    }

    if ((first === "input data motor" || first === "input data r2") && lines.length === 1) {
        return { key: "input_data_r2", args: [], argsLines: [] };
    }

    if ((first === "input data mobil" || first === "input data r4") && lines.length === 1) {
        return { key: "input_data_r4", args: [], argsLines: [] };
    }

    // ✅ hapus (khusus quote)
// contoh: reply notif lalu ketik "hapus"
    if (first === "hapus") {
        return { key: "delete_nopol", args: [], argsLines: lines.slice(1), meta: { quotedOnly: true } };
    }

    if (first.startsWith("hapus nopol")) {
        const after = first.replace("hapus nopol", "").trim(); // bisa "fif"
        return { key: "delete_nopol", args: after ? [after] : [], argsLines: lines.slice(1) };
    }

    // cek nopol AB1234CD
    if (first.startsWith("cek nopol")) {
        const after = first.replace("cek nopol", "").trim();
        return { key: "cek_nopol", args: after ? [after] : [], argsLines: lines.slice(1) };
    }

    // cek DA1234BC (khusus gateway)
    if (first.startsWith("cek ")) {
        const after = first.replace("cek ", "").trim();

        // hanya aktif kalau mode gateway
        if (String(modeKey || "").toLowerCase() === "gateway") {
            return { key: "cek_nopol", args: after ? [after] : [], argsLines: lines.slice(1) };
        }
    }

    // history AB1234CD
    if (first.startsWith("history")) {
        const after = first.replace("history", "").trim();
        return { key: "history", args: after ? [after] : [], argsLines: lines.slice(1) };
    }

    // tarik report juli 2025
// tarik report 11 juli 2025
// tarik report hari ini
    if (first.startsWith("tarik report")) {
        const after = first.replace("tarik report", "").trim();
        return { key: "tarik_report", args: after ? [after] : [], argsLines: lines.slice(1) };
    }

    // request lokasi 08123...
    if (first.startsWith("request lokasi")) {
        const after = first.replace("request lokasi", "").trim();
        return { key: "request_lokasi", args: after ? [after] : [], argsLines: lines.slice(1) };
    }

    // help/ping optional
    if (first === "help") return { key: "help", args: [], argsLines: lines.slice(1) };
    if (first === "ping") return { key: "ping", args: [], argsLines: lines.slice(1) };

    return { key: "", args: [], argsLines: [] };
}
