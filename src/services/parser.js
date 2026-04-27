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

function cleanAfterCommand(s = "") {
    return String(s || "")
        // buang simbol pembuka yang sering dipakai: ":" "," "-" "|" "=" dll
        .replace(/^[\s:;,|=\-–—]+/, "")
        // rapikan spasi
        .replace(/\s+/g, " ")
        .trim();
}

// khusus list nopol (biar "B 1234 CD, D-5555-EE" jadi enak diparse)
function cleanPlateListText(s = "") {
    return String(s || "")
        .replace(/^[\s:;,|=\-–—]+/, "")
        // samakan delimiter jadi spasi
        .replace(/[,\|;/]+/g, " ")
        // hapus karakter aneh tapi biarkan huruf/angka/spasi
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
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

    // contoh:
    // - "set target aktivasi"
    // - "set target aktivasi,hapus_user"
    // - "set target\naktivasi\nhapus_user"
    if (first.startsWith("set target")) {
        const afterRaw = first.replace("set target", "");
        const after = cleanAfterCommand(afterRaw); // buang ":" "," "-" dst di awal

        // gabung multiline juga (fleksibel)
        const extra = lines.slice(1).join(" ").trim();
        const combined = [after, extra].filter(Boolean).join(" ").trim();

        return { key: "set_target", args: combined ? [combined] : [], argsLines: lines.slice(1) };
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

    // ✅ unset management target
    if (first === "unset target") return { key: "unset_target", args: [], argsLines: lines.slice(1) };

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

    // juga dukung: "set pt" multiline (opsional)
    if (first.startsWith("set izin ")) {
        const val = first.replace("set izin ", "").trim(); // "admin" / "umum"
        return { key: "set_izin", args: val ? [val] : [], argsLines: lines.slice(1) };
    }

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
        const rawAfter = first.replace("hapus nopol", "");
        const after = cleanPlateListText(rawAfter); // ✅ cleansing
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

    if (first.startsWith("request lokasi")) {
        const after = first.replace("request lokasi", "").trim();
        return { key: "request_lokasi", args: after ? [after] : [], argsLines: lines.slice(1) };
    }

    // history AB1234CD
    if (first.startsWith("delete")) {
        const after = first.replace("delete", "").trim();
        return { key: "delete_user", args: after ? [after] : [], argsLines: lines.slice(1) };
    }

    // tarik report juli 2025
// tarik report 11 juli 2025
// tarik report hari ini
    if (first.startsWith("tarik report")) {
        const after = first.replace("tarik report", "").trim();
        return { key: "tarik_report", args: after ? [after] : [], argsLines: lines.slice(1) };
    }



    // =========================
// ✅ VPN: CONNECT / STATUS
// contoh:
// "connect vpn"
// "vpn up"
// "vpn status"
// =========================
    if (first === "connect vpn" || first === "vpn up") {
        return { key: "vpn_up", args: [], argsLines: lines.slice(1) };
    }

    if (first === "vpn status" || first === "status vpn") {
        return { key: "vpn_status", args: [], argsLines: lines.slice(1) };
    }

    // rekap jumlah data
// contoh:
// - "rekap jumlah data"
// - "rekap data"
// - "tarik rekap"
// - "rekap"
    if (
        first === "rekap jumlah data"
    ) {
        // belum perlu args (leasing diambil dari group setting)
        return { key: "rekap_data", args: [], argsLines: lines.slice(1) };
    }

    if (
        first === "report pengguna"
    ) {
        // belum perlu args (leasing diambil dari group setting)
        return { key: "report_pengguna", args: [], argsLines: lines.slice(1) };
    }

    // =========================
    // ✅ SFTP: LIST FILE
    // contoh:
    // "list file front"
    // =========================
    if (first.startsWith("list file")) {
        const afterRaw = first.replace("list file", "");
        const after = cleanAfterCommand(afterRaw); // buang ":" "," "-" dst
        // kalau user tulis multiline: "list file\nfront"
        const extra = lines.slice(1).join(" ").trim();
        const dir = (after || extra || "").trim();
        return { key: "list_file", args: dir ? [dir] : [], argsLines: lines.slice(1) };
    }

    // =========================
    // ✅ SFTP: GET FILE
    // contoh:
    // "get file front BAHAN....xlsx"
    // "get file front\nBAHAN....xlsx"
    // =========================
    if (first.startsWith("get file")) {
        const afterRaw = first.replace("get file", "");
        const after = cleanAfterCommand(afterRaw);

        // split sekali: dir + sisanya (filename bisa ada spasi)
        let dir = "";
        let file = "";

        if (after) {
            // ambil token pertama jadi dir
            const parts = after.split(" ");
            dir = (parts.shift() || "").trim();
            file = parts.join(" ").trim();
        }

        // kalau filename kosong, coba ambil dari baris berikutnya
        // contoh: "get file front" lalu baris 2: "BAHAN....xlsx"
        if (!file) {
            const extra = lines.slice(1).join(" ").trim();
            if (extra) file = extra;
        }

        // kalau dir kosong (misal user "get file\nfront\nfile.xlsx")
        if (!dir) {
            const extraLines = lines.slice(1);
            dir = (extraLines[0] || "").trim();
            file = (extraLines.slice(1).join(" ").trim()) || file;
        }

        const args = [];
        if (dir) args.push(dir);
        if (file) args.push(file);

        return { key: "get_file", args, argsLines: lines.slice(1) };
    }

    // =========================
    // ✅ get statistik ...
    // contoh:
    // - "get statistik"
    // - "get statistik 2026"
    // - "get statistik februari 2026"
    // - "get statistik 2 februari 2026"
    // - "get statistik hari ini"
    // - "get statistik minggu ini"
    // - "get statistik 2 februari 2026 to 6 februari 2026"
    // - "get statistik cabang banjarmasin hari ini"
    // =========================
    if (first.startsWith("get statistik")) {
        const afterRaw = first.replace("get statistik", "");
        const after = cleanAfterCommand(afterRaw);
        // gabung multiline
        const extra = lines.slice(1).join(" ").trim();
        const combined = [after, extra].filter(Boolean).join(" ").trim();
        return { key: "get_statistik", args: combined ? [combined] : [], argsLines: lines.slice(1) };
    }

    // =========================
// ✅ REGISTER WEB LEASING (BUAT AKUN)
// =========================

// 1) trigger: "buat akun"
    if (first === "buat akun" || first === "daftar akun" || first === "register akun") {
        return { key: "buat_akun", args: [], argsLines: lines.slice(1) };
    }

// helper kecil: cek format "INPUT DATA LOGIN"
    function isLoginTemplateHeader(line0 = "") {
        const h = String(line0 || "").trim().toUpperCase();
        return h === "INPUT DATA LOGIN" || h.startsWith("INPUT DATA LOGIN");
    }

// 2) submit template: "INPUT DATA LOGIN\nNama: ...\nJabatan: ...\nKelola_Bahan: ..."
    if (isLoginTemplateHeader(lines[0] || "")) {
        // whole message dianggap payload template
        // handler akan parse detailnya via parseRegisterTemplate(text)
        return { key: "register_submit", args: [], argsLines: lines.slice(1), meta: { raw: cleaned } };
    }

// 3) pilih cabang (step 2) -> hanya angka / angka koma
// contoh: "1" atau "1,3,7"
    if (/^\d+(?:\s*,\s*\d+)*$/.test(first)) {
        // ini generic, handler yang cek apakah ada pending register untuk user ini
        return { key: "register_pick_branch", args: [first], argsLines: lines.slice(1) };
    }

    // =========================
// ✅ PT: LIST ANGGOTA
// =========================
    if (first === "list anggota") {
        return { key: "pt_list_members", args: ["all"], argsLines: lines.slice(1) };
    }
    if (first === "list anggota aktif" || first === "list anggota active") {
        return { key: "pt_list_members", args: ["active"], argsLines: lines.slice(1) };
    }
    if (
        first === "list anggota nonaktif" ||
        first === "list anggota non active" ||
        first === "list anggota inactive"
    ) {
        return { key: "pt_list_members", args: ["inactive"], argsLines: lines.slice(1) };
    }

    if (first.startsWith("set filter")) {
        const afterRaw = first.replace("set filter", "").trim();
        const after = cleanAfterCommand(afterRaw); // buang ":" "," "-" dst

        // coba ambil mode (only/except) dari baris pertama
        let mode = "";
        let leasingRaw = after;

        const modeMatch = after.match(/^(only|except)\b/i);
        if (modeMatch) {
            mode = modeMatch[1].toLowerCase();
            leasingRaw = after.replace(/^(only|except)\b/i, "").trim();
        }

        // gabung multiline juga
        const extra = lines.slice(1).join(" ").trim();
        const combined = [leasingRaw, extra].filter(Boolean).join(" ").trim();

        return {
            key: "set_filter_leasing",
            args: mode ? [mode, combined] : [combined],
            argsLines: lines.slice(1),
        };
    }

    // ✅ RESET FILTER LEASING
    // contoh: "reset filter" atau "hapus filter"
    if (first === "reset filter" || first === "hapus filter") {
        return { key: "reset_filter_leasing", args: [], argsLines: lines.slice(1) };
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
