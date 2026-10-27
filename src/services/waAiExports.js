import axios from 'axios';

const exportPath = /^\/v1\/exports\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const maxDocumentBytes = 16 * 1024 * 1024;

export async function sendAiExports({ exports, aiScope, chatId, eventId, config, http = axios }) {
  if (!Array.isArray(exports)) return 0;
  const seen = new Set();
  let sent = 0;
  const scopeHeader = Buffer.from(JSON.stringify(aiScope)).toString('base64url');
  for (const item of exports) {
    if (item?.status !== 'ready') continue;
    const match = exportPath.exec(item.download_path || '');
    if (!match || match[1].toLowerCase() !== item.export_id?.toLowerCase()) {
      throw new Error('Invalid AI export reference');
    }
    const exportId = match[1].toLowerCase();
    if (seen.has(exportId)) continue;
    seen.add(exportId);
    const downloaded = await http.get(`${config.agentURL}${item.download_path}`, {
      headers: { 'X-Local-Api-Key': config.apiKey, 'X-AI-Scope': scopeHeader },
      responseType: 'arraybuffer', maxContentLength: maxDocumentBytes, maxRedirects: 0, timeout: 120000,
    });
    const file = Buffer.from(downloaded.data);
    if (!file.length || file.length > maxDocumentBytes || file.subarray(0, 4).toString('hex') !== '504b0304') {
      throw new Error('Invalid AI Excel export');
    }
    await http.post(`${config.baseURL}/api/external/whatsapp/command/send`, {
      session_id: config.sessionId, kind: 'document', to: chatId,
      filename: `robot-hunter-${exportId}.xlsx`,
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      caption: 'File Excel Robot Hunter', base64: file.toString('base64'),
      request_id: `ai-${eventId}-export-${exportId}`,
    }, {
      headers: { Authorization: `Bearer ${config.token}`, 'X-Tenant': config.tenant },
      timeout: 120000, maxBodyLength: 24 * 1024 * 1024,
    });
    sent++;
  }
  return sent;
}
