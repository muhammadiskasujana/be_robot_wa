import axios from "axios";
import https from "https";

const httpsAgent = new https.Agent({ keepAlive: true });

export async function sendText({ idInstance, apiToken, chatId, message, quotedMessageId }) {
    const url = `https://api.green-api.com/waInstance${idInstance}/sendMessage/${apiToken}`;

    const payload = { chatId, message };
    if (quotedMessageId) payload.quotedMessageId = quotedMessageId;

    const res = await axios.post(url, payload, {
        timeout: 15000,
        httpsAgent,
    });
    return res.data;
}