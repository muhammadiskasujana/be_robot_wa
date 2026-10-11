import test from "node:test";
import assert from "node:assert/strict";
import { checkAndDebit } from "../src/services/billingService.js";
import { commandExecution } from "../src/services/waCommandExecution.js";
import { cache, CacheKeys } from "../src/services/cacheService.js";
import { WaCreditWallet, WaCreditTransaction, sequelize } from "../src/models/index.js";

test("command debit is idempotent per execution while notification billing retains its existing behavior", async t => {
    const originals = { transaction: sequelize.transaction, walletFind: WaCreditWallet.findOne,
        walletPK: WaCreditWallet.findByPk, txFind: WaCreditTransaction.findOne, txCreate: WaCreditTransaction.create };
    t.after(async () => {
        sequelize.transaction = originals.transaction; WaCreditWallet.findOne = originals.walletFind;
        WaCreditWallet.findByPk = originals.walletPK; WaCreditTransaction.findOne = originals.txFind;
        WaCreditTransaction.create = originals.txCreate; cache.clear(); await sequelize.close();
    });
    cache.set(CacheKeys.cmdId("billing_test"), "command-test");
    cache.set(CacheKeys.policyGroup("group-test", "command-test"), JSON.stringify({
        billing_mode: "CREDIT", use_credit: true, credit_cost: 2, wallet_scope: "GROUP", is_enabled: true,
    }));
    const transactions = [];
    const wallet = { id: "wallet-test", group_id: "group-test", is_active: true, balance: 10,
        update: async values => Object.assign(wallet, values) };
    sequelize.transaction = async fn => fn({ LOCK: { UPDATE: "UPDATE" } });
    WaCreditWallet.findOne = WaCreditWallet.findByPk = async () => wallet;
    WaCreditTransaction.findOne = async ({ where }) => transactions.find(tx => Object.entries(where).every(([k, v]) => tx[k] === v));
    WaCreditTransaction.create = async values => { const tx = { id: String(transactions.length + 1), ...values }; transactions.push(tx); return tx; };
    const args = { commandKey: "billing_test", group: { id: "group-test" }, ref_id: "incoming-message" };
    const first = await commandExecution.run({ id: "42" }, () => checkAndDebit(args));
    const repeated = await commandExecution.run({ id: "42" }, () => checkAndDebit(args));
    assert.equal(first.charged, true); assert.equal(first.balance_after, 8);
    assert.equal(repeated.charged, false); assert.equal(repeated.balance_after, 8);
    assert.equal(transactions.length, 1); assert.equal(transactions[0].ref_type, "WA_COMMAND_EVENT");
    await commandExecution.run({ id: "43" }, () => checkAndDebit(args));
    assert.equal(wallet.balance, 6); assert.equal(transactions.length, 2);
    await checkAndDebit({ ...args, ref_type: "NOTIFICATION", ref_id: "notif-event" });
    assert.equal(wallet.balance, 4); assert.equal(transactions[2].ref_type, "NOTIFICATION");
    assert.equal(transactions[2].ref_id, "notif-event");
});
