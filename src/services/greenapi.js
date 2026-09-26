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

export async function sendFileByUpload({
    idInstance,
    apiToken,
    chatId,
    buffer,
    filename,
    contentType = "application/pdf",
    caption = "",
}) {
    const fileBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
    if (!fileBuffer.length) throw new Error("File WhatsApp kosong");

    const form = new FormData();
    form.append("chatId", String(chatId || ""));
    form.append("file", fileBuffer, {
        filename: String(filename || "document.pdf"),
        contentType,
        knownLength: fileBuffer.length,
    });
    form.append("fileName", String(filename || "document.pdf"));
    if (caption) form.append("caption", String(caption).slice(0, 1024));

    const response = await axios.post(
        `https://media.green-api.com/waInstance${idInstance}/sendFileByUpload/${apiToken}`,
        form,
        {
            headers: form.getHeaders(),
            httpsAgent,
            timeout: 120000,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            validateStatus: () => true,
        }
    );

    const messageId = response.data?.idMessage || response.data?.messageId;
    if (response.status !== 200 || !messageId) {
        throw new Error(
            `GreenAPI upload gagal: status=${response.status} body=${JSON.stringify(response.data)}`
        );
    }

    return response.data;
}

