// services/waCreditService.js
import sequelize from "../config/sequelize.js";
import { WaCreditWallet, WaCreditTransaction } from "../models/index.js";

function walletWhere({ walletScope, groupId, leasingId }) {
    if (walletScope === "LEASING") {
        if (!leasingId) return null;
        return { scope_type: "LEASING", leasing_id: leasingId };
    }
    // default GROUP
    if (!groupId) return null;
    return { scope_type: "GROUP", group_id: groupId };
}

export async function debitIfNeeded({ use_credit, credit_cost, wallet_scope, groupId, leasingId, command_id, ref_id, notes }) {
    if (!use_credit) return { ok: true, skipped: true };

    const where = walletWhere({ walletScope: wallet_scope, groupId, leasingId });
    if (!where) return { ok: false, error: "Wallet scope invalid / missing groupId/leasingId" };

    const cost = Math.max(1, Number(credit_cost || 1));

    return sequelize.transaction(async (t) => {
        // find or create wallet, lock row
        let wallet = await WaCreditWallet.findOne({
            where,
            transaction: t,
            lock: t.LOCK.UPDATE,
        });

        if (!wallet) {
            wallet = await WaCreditWallet.create(
                { ...where, balance: 0, is_active: true },
                { transaction: t }
            );

            // lock lagi biar konsisten
            wallet = await WaCreditWallet.findOne({
                where: { id: wallet.id },
                transaction: t,
                lock: t.LOCK.UPDATE,
            });
        }

        if (!wallet.is_active) {
            return { ok: false, error: "Wallet nonaktif" };
        }

        const before = Number(wallet.balance || 0);
        if (before < cost) {
            return { ok: false, error: `Kredit tidak cukup. Sisa: ${before}, butuh: ${cost}` };
        }

        const after = before - cost;

        await wallet.update({ balance: after }, { transaction: t });

        await WaCreditTransaction.create(
            {
                wallet_id: wallet.id,
                tx_type: "DEBIT",
                amount: cost,
                balance_before: before,
                balance_after: after,
                command_id,
                group_id: groupId || null,
                leasing_id: leasingId || null,
                ref_type: "GREENAPI_MESSAGE",
                ref_id: ref_id || null,
                notes: notes || null,
            },
            { transaction: t }
        );

        return { ok: true, debited: cost, balance_after: after, wallet_scope };
    });
}
