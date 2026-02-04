import axios from "axios";
import https from "https";

const httpsAgent = new https.Agent({ keepAlive: true });

// export async function sendText({ idInstance, apiToken, chatId, message, quotedMessageId }) {
//     const url = `https://api.green-api.com/waInstance${idInstance}/sendMessage/${apiToken}`;
//
//     const payload = { chatId, message };
//     if (quotedMessageId) payload.quotedMessageId = quotedMessageId;
//
//     const res = await axios.post(url, payload, {
//         timeout: 15000,
//         httpsAgent,
//     });
//     return res.data;
// }

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
                timeout: 8000,          // ⬅️ turunkan dari 15s
                httpsAgent,
                validateStatus: () => true, // jangan throw otomatis
            }
        );

        console.log(
            "[sendText]",
            ctx.chatId,
            "status=", res.status,
            "ms=", Date.now() - t0
        );

        return res.data;
    } catch (err) {
        console.log(
            "[sendText ERROR]",
            ctx.chatId,
            "ms=", Date.now() - t0,
            err.message
        );
        throw err;
    }
}