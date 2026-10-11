import test from "node:test";
import assert from "node:assert/strict";
import { commandConfig, commandShard } from "../src/services/waCommandConfig.js";
import { createCommandProcessor } from "../src/services/waCommandProcessor.js";
import { commandExecution } from "../src/services/waCommandExecution.js";
import { normalizePhone } from "../src/services/parser.js";

test("Green API remains default without gateway configuration", () => {
    assert.equal(commandConfig({}).provider, "greenapi");
    assert.throws(() => commandConfig({ WA_COMMAND_PROVIDER: "invalid" }));
    assert.throws(() => commandConfig({ WA_COMMAND_INBOUND_SHARDS: "0" }));
});
test("Baileys requires all dedicated env fields and rejects notification sessions", () => {
    const env = { WA_COMMAND_PROVIDER: "baileys", WA_COMMAND_GATEWAY_BASE_URL: "http://localhost/",
        WA_COMMAND_GATEWAY_TOKEN: "test", WA_COMMAND_GATEWAY_TENANT: "gateway", WA_COMMAND_GATEWAY_SESSION_ID: "command-session",
        WA_COMMAND_GATEWAY_WEBHOOK_SECRET: "test-secret", TARIKAN_NOTIF_SESSIONS: "tarikan-session" };
    assert.equal(commandConfig(env).baseURL, "http://localhost");
    assert.throws(() => commandConfig({ ...env, WA_COMMAND_GATEWAY_TOKEN: "" }));
    assert.throws(() => commandConfig({ ...env, WA_COMMAND_GATEWAY_SESSION_ID: "tarikan-session" }));
    assert.throws(() => commandConfig({ ...env, WA_COMMAND_GATEWAY_SESSION_ID: "b319ed90-2504-4589-abc7-162d8a449405" }));
    assert.equal(commandShard("12001@g.us", 4), commandShard("12001@g.us", 4));
});
test("phone normalization removes device suffix and never interprets LID as a phone", () => {
    assert.equal(normalizePhone("628123:12@s.whatsapp.net"), "628123");
    assert.equal(normalizePhone("628123@c.us"), "628123");
    assert.equal(normalizePhone("123456789@lid"), "");
    assert.equal(normalizePhone("12001@g.us"), "");
});

function setup(overrides = {}) {
    const row = { id: "42", status: "queued", provider: "baileys", instance_key: "command-session", direction: "in", payload: {}, ...overrides };
    const counts = { commands: 0, sends: 0, pauses: [] };
    row.update = async values => Object.assign(row, values);
    const processor = createCommandProcessor({
        events: { findByPk: async () => ({ ...row, update: row.update }), update: async (values, { where }) => {
            if (row.status !== where.status) return [0];
            Object.assign(row, values); return [1];
        } },
        instances: { findOne: async () => { throw new Error("Gateway must not access WaInstance"); } },
        config: { provider: "baileys", sessionId: "command-session" }, execution: commandExecution,
        handleIncoming: async () => { counts.commands++; assert.equal(commandExecution.getStore().id, "42"); },
        gatewayRequest: async () => { counts.sends++; return { idMessage: "WA-ID" }; },
        pause: async ms => counts.pauses.push(ms),
    });
    return { row, counts, processor };
}
test("duplicate deliveries execute a command once; gateway commands need no DB instance", async () => {
    const { row, counts, processor } = setup();
    await Promise.all([processor({ data: { eventId: "42" } }), processor({ data: { eventId: "42" } })]);
    await processor({ data: { eventId: "42" } });
    assert.equal(counts.commands, 1);
    assert.equal(row.status, "done");
});
test("interrupted command is marked unknown rather than rerun", async () => {
    const { row, counts, processor } = setup({ status: "processing" });
    await assert.rejects(processor({ data: { eventId: "42" } }), /requires review/);
    assert.equal(row.status, "unknown");
    assert.equal(counts.commands, 0);
});
test("queued messages cannot move to another session or provider", async () => {
    const { row, counts, processor } = setup({ instance_key: "another-session" });
    await processor({ data: { eventId: "42" } });
    assert.equal(row.status, "failed");
    assert.equal(counts.commands, 0);
});
test("outbound job normalizes WhatsApp ID and duplicate jobs do not send again", async () => {
    const { row, counts, processor } = setup({ direction: "out", payload: { kind: "text", to: "12001@g.us", message: "hello" } });
    await processor({ data: { eventId: "42" } });
    await processor({ data: { eventId: "42" } });
    assert.equal(row.status, "sent");
    assert.equal(row.result.idMessage, "WA-ID");
    assert.equal(counts.sends, 1);
});

test("only definite pre-send disconnection retries; ambiguous timeout is not retried", async () => {
    for (const safe of [true, false]) {
        let calls = 0;
        const row = { id: "8", status: "queued", direction: "out", provider: "baileys", instance_key: "command-session", payload: {} };
        row.update = async values => Object.assign(row, values);
        const pauses = [];
        const process = createCommandProcessor({
            events: { findByPk: async () => row, update: async values => { Object.assign(row, values); return [1]; } },
            config: { provider: "baileys", sessionId: "command-session" },
            gatewayRequest: async () => {
                calls++;
                if (safe && calls === 2) return { idMessage: "WA-ID" };
                const error = new Error("timeout");
                if (safe) error.response = { status: 503, data: { error: "SESSION_NOT_CONNECTED" } };
                throw error;
            }, pause: async ms => pauses.push(ms),
        });
        if (safe) { await process({ data: { eventId: "8" } }); assert.equal(calls, 2); assert.equal(row.status, "sent"); }
        else { await assert.rejects(process({ data: { eventId: "8" } })); assert.equal(calls, 1); assert.equal(row.status, "unknown"); }
    }
});
