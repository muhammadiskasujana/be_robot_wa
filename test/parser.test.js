import test from "node:test";
import assert from "node:assert/strict";
import { parseCommandV2 } from "../src/services/parser.js";

test("parses cetak surat command with tenant slug without changing normalized command behavior", () => {
    assert.deepEqual(parseCommandV2("cetak paket R4 hsn 085212345678 DA4321BB"), {
        key: "cetak_surat",
        args: ["paket", "r4", "hsn", "085212345678", "da4321bb"],
        argsLines: [],
    });

    assert.deepEqual(parseCommandV2("cek nopol DA1234BB"), {
        key: "cek_nopol",
        args: ["da1234bb"],
        argsLines: [],
    });
});

test("recognizes incomplete cetak command so the handler can return format help", () => {
    assert.deepEqual(parseCommandV2("cetak"), {
        key: "cetak_surat",
        args: [],
        argsLines: [],
    });
});
