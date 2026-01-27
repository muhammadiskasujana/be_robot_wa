import axios from "axios";

export async function sendText({ idInstance, apiToken, chatId, message, quotedMessageId }) {
    const url = `https://api.green-api.com/waInstance${idInstance}/sendMessage/${apiToken}`;

    const payload = { chatId, message };
    if (quotedMessageId) payload.quotedMessageId = quotedMessageId; // ✅ quote pesan sebelumnya

    const res = await axios.post(url, payload, { timeout: 15000 });
    return res.data;
}
