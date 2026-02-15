export function parseNopolFromText(text = "") {
    const t = String(text || "");
    const m = t.match(/nopol\s*[:]\s*\*?([A-Z0-9]+)\*?/i);
    return m ? String(m[1]).trim().toUpperCase() : "";
}

export function parseLeasingCodeFromText(text = "") {
    const t = String(text || "");
    const m = t.match(/leasing\s*[:]\s*\*?([A-Z0-9 ]+)\*?/i);
    if (!m) return "";
    const raw = String(m[1]).trim().toUpperCase();
    return (raw.split(/\s+/)[0] || "").trim(); // ambil kata pertama (TRUE/KRESNA/FIF/...)
}

export function getQuotedText(webhook) {
    // sesuaikan dengan struktur webhook greenAPI kamu
    return (
        webhook?.messageData?.quotedMessage?.textMessage ||
        webhook?.messageData?.quotedMessage?.text ||
        webhook?.messageData?.quotedMessage?.extendedTextMessageData?.text ||
        ""
    );
}
