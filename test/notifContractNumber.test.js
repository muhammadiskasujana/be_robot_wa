import test from "node:test";
import assert from "node:assert/strict";
import { lookupNotifContractNumber } from "../src/services/cekNopol/notifContractNumber.js";

test("looks up contract only for configured notification leasing", async () => {
    const calls = [];
    const lookup = async (nopol, options) => {
        calls.push({ nopol, options });
        return { ok: true, nopol, leasing_code: "SJM", raw: { nokontrak: "501901641824" } };
    };
    assert.equal(await lookupNotifContractNumber({ leasing: "SJM 1126", nopol: "DA2413BN" }, { lookup }), "501901641824");
    assert.deepEqual(calls, [{ nopol: "DA2413BN", options: { timeoutMs: 5000 } }]);
    assert.equal(await lookupNotifContractNumber({ leasing: "FIF", nopol: "DA2413BN" }, { lookup }), "");
    assert.equal(calls.length, 1);
    assert.equal(await lookupNotifContractNumber({ leasing: "FIF", nopol: "DA2413BN" }, { leasingCodes: "SJM, FIF", lookup }), "");
    assert.equal(calls.length, 2);
});

test("never adds contract from another leasing or vehicle", async () => {
    const payload = { leasing_code: "SJM", nopol: "DA2413BN" };
    const lookup = async () => ({ ok: true, nopol: "DA2413BN", leasing: "FIF", raw: { nokontrak: "123" } });
    assert.equal(await lookupNotifContractNumber(payload, { lookup }), "");
    assert.equal(await lookupNotifContractNumber(payload, { lookup: async () => ({ ok: true, nopol: "DA9999AA", leasing: "SJM", raw: { nokontrak: "123" } }) }), "");
    assert.equal(await lookupNotifContractNumber(payload, { lookup: async () => ({ ok: true, nopol: "DA2413BN", leasing: "SJM", raw: { nokontrak: "-" } }) }), "");
});

test("lookup failures leave the notification without a contract number", async () => {
    const previousWarn = console.warn;
    console.warn = () => {};
    try {
        assert.equal(await lookupNotifContractNumber(
            { leasing: "SJM", nopol: "DA2413BN" },
            { lookup: async () => { throw new Error("API unavailable"); } }
        ), "");
    } finally {
        console.warn = previousWarn;
    }
});
