export function parseNopolFromText(text = "") {
    const t = String(text || "");
    const m = t.match(/nopol\s*[:]\s*\*?([A-Z0-9]+)\*?/i);
    return m ? String(m[1]).trim().toUpperCase() : "";
}

export function parseLeasingCodeFromText(text = "") {
    const t = String(text || "");

    const m = t.match(/leasing\s*[:]\s*\*?([A-Z0-9\- ]+)\*?/i);
    if (!m) return "";

    const raw = String(m[1]).trim().toUpperCase();

    // ambil hanya bagian sebelum spasi pertama
    return raw.split(/\s+/)[0];
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

export function getQuotedMessageId(webhook) {
    return (
        webhook?.messageData?.quotedMessage?.stanzaId ||
        webhook?.messageData?.quotedMessage?.idMessage ||
        webhook?.messageData?.quotedMessage?.id ||
        webhook?.messageData?.quotedMessageId ||
        ""
    );
}
