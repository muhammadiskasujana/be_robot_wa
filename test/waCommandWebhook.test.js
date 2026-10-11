import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import routes from "../src/routes/webhook.js";
import { WaInstance, WaCommandEvent, WaMessageLog, sequelize } from "../src/models/index.js";

test("webhook persists before ACK, deduplicates, isolates providers and rejects incorrect gateway source", async t => {
    const envKeys = ["WA_COMMAND_PROVIDER", "WEBHOOK_SECRET", "WA_COMMAND_GATEWAY_BASE_URL", "WA_COMMAND_GATEWAY_TOKEN", "WA_COMMAND_GATEWAY_TENANT", "WA_COMMAND_GATEWAY_SESSION_ID", "WA_COMMAND_GATEWAY_WEBHOOK_SECRET"];
    const savedEnv = Object.fromEntries(envKeys.map(k => [k, process.env[k]]));
    const original = { instance: WaInstance.findOne, event: WaCommandEvent.findOrCreate, log: WaMessageLog.findOrCreate };
    const records = new Map();
    let failSave = false;
    WaInstance.findOne = async () => ({ api_token: "fake", meta: { roles: ["BOT"] } });
    WaCommandEvent.findOrCreate = async ({ where, defaults }) => {
        if (failSave) throw new Error("database unavailable");
        if (records.has(where.event_key)) return [records.get(where.event_key), false];
        const row = { id: String(records.size + 1), ...defaults };
        records.set(where.event_key, row); return [row, true];
    };
    WaMessageLog.findOrCreate = async () => [{}, true];
    Object.assign(process.env, { WA_COMMAND_PROVIDER: "greenapi", WEBHOOK_SECRET: "green-test-secret" });
    const app = express(); app.use(express.json()); app.use("/webhook", routes);
    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    t.after(async () => {
        WaInstance.findOne = original.instance; WaCommandEvent.findOrCreate = original.event; WaMessageLog.findOrCreate = original.log;
        for (const key of envKeys) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; }
        await new Promise(resolve => server.close(resolve)); await sequelize.close();
    });
    const post = async (path, body, headers = {}) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/webhook/${path}`, {
            method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
    };
    const webhook = { typeWebhook: "incomingMessageReceived", idMessage: "message-1", instanceData: { idInstance: "7100001" },
        senderData: { chatId: "12001@g.us", sender: "628123@c.us" }, messageData: { textMessageData: { textMessage: "ping" } } };
    assert.equal((await post("greenapi", webhook)).status, 401);
    const first = await post("greenapi?secret=green-test-secret", webhook);
    assert.equal(first.status, 200); assert.equal(records.size, 1); assert.equal(first.body.duplicate, false);
    assert.equal((await post("greenapi?secret=green-test-secret", webhook)).body.duplicate, true);
    assert.equal(records.size, 1);
    failSave = true;
    assert.equal((await post("greenapi?secret=green-test-secret", { ...webhook, idMessage: "message-2" })).status, 503);
    failSave = false;
    Object.assign(process.env, { WA_COMMAND_PROVIDER: "baileys", WA_COMMAND_GATEWAY_BASE_URL: "http://unused", WA_COMMAND_GATEWAY_TOKEN: "fake", WA_COMMAND_GATEWAY_TENANT: "test", WA_COMMAND_GATEWAY_SESSION_ID: "dedicated", WA_COMMAND_GATEWAY_WEBHOOK_SECRET: "callback-test" });
    assert.equal((await post("greenapi?secret=green-test-secret", webhook)).body.ignored, "inactive_provider");
    const gatewayBody = { tenant: "test", session_id: "dedicated", webhook };
    assert.equal((await post("gateway", gatewayBody)).status, 401);
    assert.equal((await post("gateway", { ...gatewayBody, session_id: "notification" }, { "X-Command-Secret": "callback-test" })).status, 403);
    const accepted = await post("gateway", gatewayBody, { "X-Command-Secret": "callback-test" });
    assert.equal(accepted.status, 200); assert.equal(records.size, 2);
    assert.equal((await post("gateway", gatewayBody, { "X-Command-Secret": "callback-test" })).body.duplicate, true);
});
