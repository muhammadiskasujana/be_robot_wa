import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import axios from "axios";
import { generateWhatsAppDocument } from "../src/services/cetakSurat/cetakSuratService.js";

test("new document types reach WhatsApp API with the expected bundle option", async () => {
    const previousToken = process.env.CETAK_SURAT_EXTERNAL_TOKEN;
    process.env.CETAK_SURAT_EXTERNAL_TOKEN = "test-token";
    const requests = [];
    const post = mock.method(axios, "post", async (url, body, options) => {
        requests.push({ url, body, options });
        return {
            status: 200,
            data: Buffer.from("%PDF-1.4 test"),
            headers: { "content-type": "application/pdf", "x-document-count": body.document_type === "lengkap" ? "3" : "2" },
        };
    });
    try {
        const base = {
            vehicleType: "R2", tenant: "LBS", matelPhone: "081351275916",
            nopol: "DN3946OH", requestedByPhone: "081212345678",
        };
        const receipt = await generateWhatsAppDocument({ ...base, documentType: "tanda_terima" });
        const pair = await generateWhatsAppDocument({ ...base, documentType: "bastk_tanda_terima" });
        const complete = await generateWhatsAppDocument({ ...base, documentType: "lengkap", bundleLetterType: "kuasa" });
        assert.equal(requests.length, 3);
        assert.deepEqual(requests.map(({ body }) => body.document_type), ["tanda_terima", "bastk_tanda_terima", "lengkap"]);
        assert.equal(requests[0].body.bundle_letter_type, undefined);
        assert.equal(requests[1].body.bundle_letter_type, undefined);
        assert.equal(requests[2].body.bundle_letter_type, "kuasa");
        assert.equal(requests[2].body.requested_by_phone, "6281212345678");
        assert.equal(requests[2].body.matel_phone, "6281351275916");
        assert.equal(requests[2].body.vehicle_type, "R2");
        assert.equal(requests[2].body.nopol, "DN3946OH");
        assert.equal(receipt.contentType, "application/pdf");
        assert.equal(pair.documentCount, "2");
        assert.equal(complete.documentCount, "3");
        assert.equal(complete.bundleLetterType, "kuasa");
        assert.equal(post.mock.callCount(), 3);
    } finally {
        post.mock.restore();
        if (previousToken === undefined) delete process.env.CETAK_SURAT_EXTERNAL_TOKEN;
        else process.env.CETAK_SURAT_EXTERNAL_TOKEN = previousToken;
    }
});
