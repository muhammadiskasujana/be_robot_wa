import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { bawaSend, bawaGroup } from '../src/services/bawaClient.js';
import { normalizeBawaIncoming, validBawaSignature } from '../src/routes/bawaWebhook.js';

test('Bawa sends a command reply with stable request and quote IDs', async () => {
  let sent;
  const http = { post: async (...args) => { sent = args; return { data: { id: 'wamid.1' } }; } };
  const result = await bawaSend({ baseURL: 'https://api.example', instanceId: 'command', token: 'secret',
    to: '628123@s.whatsapp.net', message: 'OK', requestId: 'command-42', quotedId: 'wamid.in' }, http);
  assert.equal(sent[0], 'https://api.example/v1/instances/command/messages/text');
  assert.deepEqual(sent[1], { to: '628123', text: 'OK', request_id: 'command-42', quoted_id: 'wamid.in' });
  assert.equal(sent[2].headers.Authorization, 'Bearer secret');
  assert.equal(result.idMessage, 'wamid.1');
});

test('Bawa group participants retain admin flags for command and Smith access checks', async () => {
  const http = { get: async () => ({ data: { participants: [{ jid: '628123@s.whatsapp.net', is_admin: true, is_super_admin: false }] } }) };
  const group = await bawaGroup({ baseURL: 'https://api.example', instanceId: 'smith', token: 'secret', groupId: '123@g.us' }, http);
  assert.deepEqual(group.participants[0], { id: '628123@s.whatsapp.net', lid: undefined, isAdmin: true, isSuperAdmin: false });
});

test('Bawa webhook verifies raw body and retains quoted text for command parsing', () => {
  const body = Buffer.from('{"event":"message.received"}');
  const signature = `sha256=${createHmac('sha256', 'webhook-secret').update(body).digest('hex')}`;
  assert.equal(validBawaSignature(body, signature, 'webhook-secret'), true);
  assert.equal(validBawaSignature(Buffer.from('changed'), signature, 'webhook-secret'), false);
  const normalized = normalizeBawaIncoming({ data: { id: 'wamid.in', chat: '123@g.us', sender: '628123@s.whatsapp.net',
    type: 'text', text: 'hapus nopol', quoted: { id: 'wamid.quoted', text: 'DA1234AA' } } });
  assert.equal(normalized.messageData.quotedMessage.textMessage, 'DA1234AA');
  assert.equal(normalized.senderData.chatId, '123@g.us');
  const lidIncoming = normalizeBawaIncoming({ data: { id: 'wamid.lid', chat: '123@g.us', sender: '12345:44@lid',
    sender_phone: '628123456789', type: 'text', text: 'list cabang' } });
  assert.equal(lidIncoming.senderData.sender, '12345:44@lid');
  assert.equal(lidIncoming.senderData.senderPhone, '628123456789');
});
