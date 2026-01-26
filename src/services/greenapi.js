import axios from "axios";

export async function sendText({ idInstance, apiToken, chatId, message }) {
    const url = `https://api.green-api.com/waInstance${idInstance}/sendMessage/${apiToken}`;
    const payload = { chatId, message };
    const res = await axios.post(url, payload, { timeout: 15000 });
    return res.data;
}
