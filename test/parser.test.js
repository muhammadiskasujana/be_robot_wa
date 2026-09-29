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

test("parses input tarikan management configuration commands", () => {
    assert.equal(parseCommandV2("set input tarikan all").key, "set_input_tarikan");
    assert.deepEqual(parseCommandV2("set input tarikan leasing FIF, BFI").args, ["leasing fif, bfi"]);
    assert.deepEqual(parseCommandV2("set input tarikan tenant hsn").args, ["tenant hsn"]);
    assert.deepEqual(
        parseCommandV2("set input tarikan leasing FIF, BFI tenant hsn" ).args,
        ["leasing fif, bfi tenant hsn"]
    );
    assert.equal(parseCommandV2("status input tarikan").key, "status_input_tarikan");
    assert.equal(parseCommandV2("unset input tarikan").key, "unset_input_tarikan");
});
