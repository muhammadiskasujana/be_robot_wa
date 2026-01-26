const COMMAND_TRIGGERS = ["bot", "set", "toggle", "ping", "help"];

export function normalizePhone(senderJid) {
    if (!senderJid) return "";
    return senderJid.split("@")[0].replace(/\D/g, "");
}

export function isGroupChat(chatId) {
    return typeof chatId === "string" && chatId.endsWith("@g.us");
}

export function extractText(body) {
    const msg = body?.messageData;
    const t1 = msg?.textMessageData?.textMessage;
    const t2 = msg?.extendedTextMessageData?.text;
    return (t1 || t2 || "").trim();
}

/**
 * Natural command parser
 * Examples:
 *  bot on
 *  set mode leasing
 *  set leasing ADIRA HO
 *  toggle notif on
 *  ping
 *  help
 */
export function parseCommand(text) {
    if (!text) return { key: "", args: [], raw: "" };

    const t = text.trim().toLowerCase();
    const parts = t.split(/\s+/);

    if (parts.length === 0) return { key: "", args: [], raw: "" };

    const first = parts[0];

    if (!COMMAND_TRIGGERS.includes(first)) {
        return { key: "", args: [], raw: "" }; // bukan command
    }

    // mapping multi-word command key
    let key = first;
    let args = parts.slice(1);

    if (first === "bot" && args[0] === "on") key = "on";
    else if (first === "bot" && args[0] === "off") key = "off";

    else if (first === "set" && args[0] === "mode") {
        key = "mode";
        args = args.slice(1); // remove "mode"
    }

    else if (first === "set" && args[0] === "leasing") {
        key = "leasing";
        args = args.slice(1); // remove "leasing"
    }

    else if (first === "toggle" && args[0] === "notif") {
        key = "notif";
        args = args.slice(1); // remove "notif"
    }

    else if (first === "ping") {
        key = "ping";
        args = [];
    }

    else if (first === "help") {
        key = "help";
        args = [];
    }

    return { key, args, raw: t };
}
