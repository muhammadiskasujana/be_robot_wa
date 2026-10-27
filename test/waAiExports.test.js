import test from 'node:test';
import assert from 'node:assert/strict';
import { sendAiExports } from '../src/services/waAiExports.js';

const exportId = '11111111-1111-4111-8111-111111111111';
const config = { agentURL: 'https://llm.example', apiKey: 'local-secret', baseURL: 'https://gateway.example',
  sessionId: 'ai-session', token: 'gateway-secret', tenant: 'tenant' };
const aiScope = { mode: 'group', pts: [], leasings: ['ADIRA'], branches: [] };

test('AI Excel is downloaded with the same scope and sent as a WhatsApp document', async () => {
  const calls = [];
  const http = {
    get: async (url, options) => { calls.push({ url, options }); return { data: Buffer.from('PK\x03\x04xlsx') }; },
    post: async (url, body, options) => { calls.push({ url, body, options }); return { data: { idMessage: 'sent' } }; },
  };
  const exports = [{ export_id: exportId, status: 'ready', download_path: `/v1/exports/${exportId}` }];
  assert.equal(await sendAiExports({ exports, aiScope, chatId: '62812@c.us', eventId: 7, config, http }), 1);
  assert.equal(calls[0].url, `https://llm.example/v1/exports/${exportId}`);
  assert.equal(calls[0].options.headers['X-Local-Api-Key'], config.apiKey);
  assert.deepEqual(JSON.parse(Buffer.from(calls[0].options.headers['X-AI-Scope'], 'base64url').toString()), aiScope);
  assert.equal(calls[1].body.kind, 'document');
  assert.equal(calls[1].body.to, '62812@c.us');
  assert.equal(calls[1].body.request_id, `ai-7-export-${exportId}`);
  assert.equal(Buffer.from(calls[1].body.base64, 'base64').toString(), 'PK\x03\x04xlsx');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer gateway-secret');
});

test('AI export rejects an untrusted download path before making a request', async () => {
  const http = { get: () => { throw new Error('unexpected download'); }, post: () => { throw new Error('unexpected send'); } };
  await assert.rejects(sendAiExports({ exports: [{ export_id: exportId, status: 'ready',
    download_path: 'https://attacker.example/file' }], aiScope, chatId: '62812@c.us', eventId: 7, config, http }),
  /Invalid AI export reference/);
});
