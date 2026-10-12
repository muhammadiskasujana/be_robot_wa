import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { fetchKartuPiutangDocument, normalizePiutangIdentifier } from "../src/services/kartuPiutang/kartuPiutangService.js";

test("downloads binary document and preserves API filename", async () => {
    const originalAdapter = axios.defaults.adapter;
    const originalBase = process.env.KARTU_PIUTANG_API_BASE;
    delete process.env.KARTU_PIUTANG_API_BASE;
    try {
        axios.defaults.adapter = async config => {
            assert.equal(config.method, "get");
            assert.equal(config.url, "https://api-piutang.digitalmanager.id/schedule/740010058091");
            assert.equal(config.responseType, "arraybuffer");
            return { status: 200, data: Buffer.from("%PDF-1.7\nbinary"), headers: {
                "content-type": "application/pdf",
                "content-disposition": "attachment; filename*=UTF-8''kartu%20piutang.pdf",
            }, config };
        };
        const result = await fetchKartuPiutangDocument({ identifier: "740010058091" });
        assert.equal(result.buffer.toString(), "%PDF-1.7\nbinary");
        assert.equal(result.filename, "kartu_piutang.pdf");
        assert.equal(result.contentType, "application/pdf");
    } finally {
        axios.defaults.adapter = originalAdapter;
        if (originalBase === undefined) delete process.env.KARTU_PIUTANG_API_BASE;
        else process.env.KARTU_PIUTANG_API_BASE = originalBase;
    }
});

test("rejects failed, JSON, HTML and empty API responses", async () => {
    const originalAdapter = axios.defaults.adapter;
    try {
        for (const response of [
            { status: 404, data: Buffer.from('{"message":"Data tidak ditemukan"}'), headers: { "content-type": "application/json" } },
            { status: 200, data: Buffer.from('{"error":"Tidak tersedia"}'), headers: {} },
            { status: 200, data: Buffer.from("<html>Error</html>"), headers: { "content-type": "text/html" } },
            { status: 200, data: Buffer.alloc(0), headers: {} },
        ]) {
            axios.defaults.adapter = async config => ({ ...response, config });
            await assert.rejects(fetchKartuPiutangDocument({ identifier: "DA1234BB" }));
        }
    } finally { axios.defaults.adapter = originalAdapter; }
});

test("normalizes identifiers preserving leading zeroes and rejects path injection", () => {
    assert.equal(normalizePiutangIdentifier(" da 4321 bb "), "DA4321BB");
    assert.equal(normalizePiutangIdentifier("00123456789"), "00123456789");
    assert.equal(normalizePiutangIdentifier("eng-123"), "ENG-123");
    for (const value of ["", "../schedule", "DA123?token=x", "foo/bar"]) {
        assert.throws(() => normalizePiutangIdentifier(value));
    }
});
