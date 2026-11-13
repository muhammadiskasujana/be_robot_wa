import axios from "axios";

export function bawaRecipient(value) {
    const recipient = String(value || "").trim();
    if (recipient.endsWith("@c.us") || recipient.endsWith("@s.whatsapp.net")) {
        return recipient.split("@")[0].split(":")[0];
    }
    return recipient;
}

export function bawaMessageResult(data = {}) {
    const idMessage = data.idMessage || data.id || data.message_id || data.messageId;
    return { ...data, idMessage };
}

export async function bawaSend({ baseURL, instanceId, token, kind = "text", to, message,
    base64, filename, mimetype, caption, requestId, quotedId, mentions = [], timeout = 120000,
}, http = axios) {
    const endpoint = kind === "document" ? "document" : "text";
    const body = endpoint === "document"
        ? { to: bawaRecipient(to), base64, filename, mimetype, caption: caption || "" }
        : { to: bawaRecipient(to), text: message };
    if (requestId) body.request_id = requestId;
    if (quotedId) body.quoted_id = quotedId;
    if (mentions.length) body.mentioned = mentions;
    const response = await http.post(`${baseURL}/v1/instances/${encodeURIComponent(instanceId)}/messages/${endpoint}`,
        body, { headers: { Authorization: `Bearer ${token}` }, timeout, maxBodyLength: 24 * 1024 * 1024 });
    return bawaMessageResult(response.data);
}

export async function bawaGroup({ baseURL, instanceId, token, groupId }, http = axios) {
    const response = await http.get(`${baseURL}/v1/instances/${encodeURIComponent(instanceId)}/groups/${encodeURIComponent(groupId)}`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });
    return { ...response.data, participants: (response.data?.participants || []).map(participant => ({
        id: participant.jid, lid: participant.lid, isAdmin: participant.is_admin,
        isSuperAdmin: participant.is_super_admin,
    })) };
}
