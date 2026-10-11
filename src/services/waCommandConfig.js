export function commandConfig(env = process.env) {
    const provider = env.WA_COMMAND_PROVIDER || "greenapi";
    if (!["greenapi", "baileys"].includes(provider)) throw new Error("Invalid WA_COMMAND_PROVIDER");
    const config = {
        provider,
        baseURL: (env.WA_COMMAND_GATEWAY_BASE_URL || "").replace(/\/$/, ""),
        token: env.WA_COMMAND_GATEWAY_TOKEN,
        tenant: env.WA_COMMAND_GATEWAY_TENANT,
        sessionId: env.WA_COMMAND_GATEWAY_SESSION_ID,
        secret: env.WA_COMMAND_GATEWAY_WEBHOOK_SECRET,
        shards: Number(env.WA_COMMAND_INBOUND_SHARDS || 4),
    };
    if (!Number.isInteger(config.shards) || config.shards < 1 || config.shards > 32) throw new Error("Invalid WA_COMMAND_INBOUND_SHARDS");
    if (provider === "baileys") {
        for (const key of ["baseURL", "token", "tenant", "sessionId", "secret"]) {
            if (!config[key]) throw new Error(`Missing command gateway config: ${key}`);
        }
        // Existing notifSend worker has this dedicated session hardcoded. Do not change its routing.
        const notifSessions = ["b319ed90-2504-4589-abc7-162d8a449405", env.NOTIF_SESSIONS, env.TARIKAN_NOTIF_SESSIONS, env.WA_COMMAND_RESERVED_SESSIONS].filter(Boolean).join(",").split(",").map(s => s.trim());
        if (notifSessions.includes(config.sessionId)) throw new Error("Command session must differ from notification sessions");
    }
    return config;
}

export function commandShard(chatId, count) {
    let hash = 0;
    for (const char of String(chatId)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return hash % count;
}
