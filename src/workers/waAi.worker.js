import 'dotenv/config';
import axios from 'axios';
import { sequelize, WaCommandEvent, WaGroup, WaMaster, WaCommand, WaCommandPolicy } from '../models/index.js';
import { aiConfig } from '../services/aiConfig.js';
import { resolveAiScope } from '../services/aiScope.js';
import { extractText, normalizePhone, isGroupChat } from '../services/parser.js';

const config = aiConfig();
for (const key of ['sessionId', 'tenant', 'secret', 'baseURL', 'token', 'agentURL', 'apiKey']) {
  if (!config[key]) throw new Error(`Missing AI config: ${key}`);
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function send(to, message, eventId) {
  await axios.post(`${config.baseURL}/api/external/whatsapp/command/send`, {
    session_id: config.sessionId, kind: 'text', to, message,
    request_id: `ai-${eventId}`,
  }, { headers: { Authorization: `Bearer ${config.token}`, 'X-Tenant': config.tenant }, timeout: 120000 });
}

async function mayAskInGroup(record, chatId, senderJid) {
  if (String(record.izin_group || 'UMUM').toUpperCase() !== 'ADMIN') return true;
  const phone = normalizePhone(senderJid);
  if (phone && await WaMaster.findOne({ where: { phone_e164: phone, is_active: true }, attributes: ['id'] })) return true;
  const response = await axios.post(`${config.baseURL}/api/external/whatsapp/command/group`,
    { session_id: config.sessionId, group_id: chatId },
    { headers: { Authorization: `Bearer ${config.token}`, 'X-Tenant': config.tenant }, timeout: 15000 });
  return Array.isArray(response.data?.participants) && response.data.participants.some(participant => {
    if (!participant.isAdmin && !participant.isSuperAdmin) return false;
    return [participant.id, participant.lid].some(id =>
      id === senderJid || (phone && normalizePhone(id) === phone));
  });
}

export async function processAiEvent(row) {
  const webhook = row.payload;
  const chatId = webhook.senderData.chatId;
  const question = /^smith\s+([\s\S]+)$/i.exec(extractText(webhook))?.[1]?.trim();
  if (!question) return;
  const group = isGroupChat(chatId);
  let record;
  if (group) {
    record = await WaGroup.findOne({ where: { chat_id: chatId } });
    if (!record?.is_ai_enabled) return;
    if (!(await mayAskInGroup(record, chatId, webhook.senderData.sender))) return;
  } else {
    const phone = normalizePhone(webhook.senderData.sender);
    if (!phone) return;
    const command = await WaCommand.findOne({ where: { key: 'ai_chat', is_active: true }, attributes: ['id'] });
    if (!command) return;
    const policy = await WaCommandPolicy.findOne({ where: {
      scope_type: 'PERSONAL', phone_e164: phone, command_id: command.id, is_enabled: true,
    }, attributes: ['id', 'group_id', 'leasing_id'] });
    if (!policy) return;
    if (policy.group_id) record = await WaGroup.findByPk(policy.group_id);
    else if (policy.leasing_id) record = { leasing_id: policy.leasing_id };
  }
  const aiScope = await resolveAiScope(record);
  if (!aiScope) return;
  const response = await axios.post(`${config.agentURL}/v1/channels/whatsapp/chat`,
    { message: question, use_memory: !group, sender_id: group ? null : normalizePhone(webhook.senderData.sender), ai_scope: aiScope },
    { headers: { 'X-Local-Api-Key': config.apiKey }, timeout: 180000 });
  const answer = response.data?.answer;
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('LLM returned empty answer');
  await send(chatId, answer, row.id);
}

await sequelize.authenticate();
console.log('[WA_AI] ready', config.sessionId);
while (true) {
  try {
    const row = await WaCommandEvent.findOne({ where: {
      provider: 'ai', instance_key: config.sessionId, direction: 'in', status: 'pending',
    }, order: [['id', 'ASC']] });
    if (!row) { await pause(500); continue; }
    const [claimed] = await WaCommandEvent.update({ status: 'processing' }, { where: { id: row.id, status: 'pending' } });
    if (!claimed) continue;
    try {
      await processAiEvent(row);
      await row.update({ status: 'done' });
    } catch (error) {
      await row.update({ status: 'unknown', error: error.message });
      console.error('[WA_AI event]', row.id, error.message);
    }
  } catch (error) {
    console.error('[WA_AI worker]', error.message);
    await pause(2000);
  }
}
