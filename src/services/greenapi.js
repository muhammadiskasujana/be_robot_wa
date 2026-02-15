import axios from "axios";
import https from "https";
import FormData from "form-data";

const httpsAgent = new https.Agent({ keepAlive: true });


export async function sendText(ctx) {
    const t0 = Date.now();
    try {
        const res = await axios.post(
            `https://api.green-api.com/waInstance${ctx.idInstance}/sendMessage/${ctx.apiToken}`,
            {
                chatId: ctx.chatId,
                message: ctx.message,
                ...(ctx.quotedMessageId ? { quotedMessageId: ctx.quotedMessageId } : {}),
            },
            {
                timeout: 8000,
                httpsAgent,
                validateStatus: () => true, // jangan auto throw
            }
        );

        const ms = Date.now() - t0;
        const body = res.data;

        const msgId = body?.idMessage || body?.messageId;

        console.log("[sendText]", {
            chatId: ctx.chatId,
            instance: ctx.idInstance,
            status: res.status,
            ms,
            hasMessageId: !!msgId,
            quoted: !!ctx.quotedMessageId,
            len: (ctx.message || "").length,
            response: body,
        });

        // ⛔ WAJIB: kalau tidak ada idMessage → anggap gagal
        if (res.status !== 200 || !msgId) {
            throw new Error(
                `GreenAPI send failed: status=${res.status} body=${JSON.stringify(body)}`
            );
        }

        return body;
    } catch (err) {
        console.log("[sendText ERROR]", {
            chatId: ctx.chatId,
            instance: ctx.idInstance,
            ms: Date.now() - t0,
            error: err.message,
        });
        throw err;
    }
}

