import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createTemporaryStore } from "../src/services/temporaryStore.js";
import { createTempReportsRouter, createTempLinksRouter } from "../src/routes/tempDownloadRouter.js";

function sharedRedis() {
    let clock = 100000;
    const values = new Map();
    return {
        now: () => clock,
        advance: ms => { clock += ms; },
        client: () => ({
            async set(key, value, unit, ttl) {
                assert.equal(unit, "PX");
                values.set(key, { data: Buffer.from(value), expiresAt: clock + ttl });
                return "OK";
            },
            async getBuffer(key) {
                const item = values.get(key);
                return item && item.expiresAt > clock ? Buffer.from(item.data) : null;
            },
        }),
    };
}

test("a worker-created report is readable by an independent server store and survives store recreation", async () => {
    const backend = sharedRedis();
    const worker = createTemporaryStore(backend.client(), { now: backend.now });
    const bytes = Buffer.from([0, 255, 128, 10, 13, 65, 0, 66]);
    const result = await worker.saveTempFile(bytes, "report BFI.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const server = createTemporaryStore(backend.client(), { now: backend.now });
    const file = await server.getTempFileMeta(result.token);
    assert.deepEqual(file.buffer, bytes);
    assert.equal(file.filename, "report_BFI.xlsx");
    assert.equal(file.contentType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.equal(result.expiresAt, backend.now() + 300000);
    const restarted = createTemporaryStore(backend.client(), { now: backend.now });
    assert.deepEqual((await restarted.getTempFileMeta(result.token)).buffer, bytes);
    backend.advance(299999);
    assert.ok(await server.getTempFileMeta(result.token));
    backend.advance(1);
    assert.equal(await server.getTempFileMeta(result.token), null);
});

test("temporary links share Redis TTL and cannot be used as file tokens", async () => {
    const backend = sharedRedis();
    const worker = createTemporaryStore(backend.client(), { now: backend.now });
    const server = createTemporaryStore(backend.client(), { now: backend.now });
    const link = await worker.createTempLink("https://example.com/cabang?leasing=BFI", 5000);
    assert.equal((await server.getTempLink(link.token)).targetUrl, "https://example.com/cabang?leasing=BFI");
    assert.equal(await server.getTempFileMeta(link.token), null);
    const file = await worker.saveTempFile(Buffer.from("report"), "test.xlsx");
    assert.equal(await server.getTempLink(file.token), null);
    backend.advance(5000);
    assert.equal(await server.getTempLink(link.token), null);
    await assert.rejects(worker.createTempLink("https://example.com", -1), /TTL/);
});

test("missing tokens are rejected and storage errors/timeouts propagate rather than claiming expiry", async () => {
    const client = { getBuffer: async () => { throw new Error("Redis unavailable"); } };
    const store = createTemporaryStore(client);
    assert.equal(await store.getTempFileMeta("../invalid"), null);
    assert.equal(await store.getTempLink(""), null);
    await assert.rejects(store.getTempFileMeta("a".repeat(36)), /Redis unavailable/);
    const hanging = createTemporaryStore({ getBuffer: () => new Promise(() => {}) }, { timeoutMs: 5 });
    await assert.rejects(hanging.getTempFileMeta("a".repeat(36)), /storage timeout/);
});

test("download and redirect routes await shared storage, preserve binary data and honor real expiry", async t => {
    const backend = sharedRedis();
    const worker = createTemporaryStore(backend.client(), { now: backend.now });
    const serverStore = createTemporaryStore(backend.client(), { now: backend.now });
    const data = Buffer.from([0, 255, 128, 10, 13, 65, 0, 66]);
    const report = await worker.saveTempFile(data, "report.xlsx");
    const pdf = await worker.saveTempFile(Buffer.from("%PDF"), "report.pdf", "application/pdf");
    const link = await worker.createTempLink("https://example.com/cabang");
    const app = express();
    app.use("/files", createTempReportsRouter(serverStore.getTempFileMeta));
    app.use("/links", createTempLinksRouter(serverStore.getTempLink));
    app.use("/unavailable", createTempReportsRouter(async () => { throw new Error("storage offline"); }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/files/dl/${report.token}`);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), data);
    assert.equal(response.headers.get("content-disposition"), 'attachment; filename="report.xlsx"');
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const pdfResponse = await fetch(`${base}/files/dl/${pdf.token}`);
    assert.equal(pdfResponse.headers.get("content-disposition"), 'inline; filename="report.pdf"');
    const redirect = await fetch(`${base}/links/temp-links/${link.token}`, { redirect: "manual" });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get("location"), "https://example.com/cabang");
    assert.equal((await fetch(`${base}/unavailable/dl/${report.token}`)).status, 503);
    backend.advance(300000);
    assert.equal((await fetch(`${base}/files/dl/${report.token}`)).status, 404);
    assert.equal((await fetch(`${base}/links/temp-links/${link.token}`)).status, 410);
});
