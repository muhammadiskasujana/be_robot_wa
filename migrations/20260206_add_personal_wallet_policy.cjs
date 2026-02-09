"use strict";

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.sequelize.transaction(async (t) => {
            // =========================
            // wa_command_policies
            // =========================
            // add phone_e164
            await queryInterface.addColumn(
                "wa_command_policies",
                "phone_e164",
                { type: Sequelize.STRING(32), allowNull: true },
                { transaction: t }
            ).catch(() => null);

            // add index phone
            await queryInterface.addIndex(
                "wa_command_policies",
                ["phone_e164"],
                { name: "ix_wa_policies_phone", transaction: t }
            ).catch(() => null);

            // drop unique lama (yang belum ada phone_e164)
            await queryInterface.removeIndex(
                "wa_command_policies",
                "ux_wa_policies_scope_target_command",
                { transaction: t }
            ).catch(() => null);

            // recreate unique baru (include phone_e164)
            await queryInterface.addIndex(
                "wa_command_policies",
                ["scope_type", "group_id", "leasing_id", "phone_e164", "command_id"],
                {
                    unique: true,
                    name: "ux_wa_policies_scope_target_command",
                    transaction: t,
                }
            );

            // =========================
            // wa_credit_wallets
            // =========================
            await queryInterface.addColumn(
                "wa_credit_wallets",
                "phone_e164",
                { type: Sequelize.STRING(32), allowNull: true },
                { transaction: t }
            ).catch(() => null);

            await queryInterface.addIndex(
                "wa_credit_wallets",
                ["phone_e164"],
                { name: "ix_wa_wallet_phone", transaction: t }
            ).catch(() => null);

            // drop unique lama wallet (name sudah kamu pakai)
            await queryInterface.removeIndex(
                "wa_credit_wallets",
                "ux_wa_wallet_scope_target",
                { transaction: t }
            ).catch(() => null);

            // recreate unique baru wallet (include phone_e164)
            await queryInterface.addIndex(
                "wa_credit_wallets",
                ["scope_type", "group_id", "leasing_id", "phone_e164"],
                {
                    unique: true,
                    name: "ux_wa_wallet_scope_target",
                    transaction: t,
                }
            );

            // =========================
            // wa_credit_transactions
            // =========================
            await queryInterface.addColumn(
                "wa_credit_transactions",
                "phone_e164",
                { type: Sequelize.STRING(32), allowNull: true },
                { transaction: t }
            ).catch(() => null);

            await queryInterface.addIndex(
                "wa_credit_transactions",
                ["phone_e164"],
                { name: "ix_wa_tx_phone", transaction: t }
            ).catch(() => null);
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.sequelize.transaction(async (t) => {
            // =========================
            // wa_credit_transactions
            // =========================
            await queryInterface.removeIndex("wa_credit_transactions", "ix_wa_tx_phone", { transaction: t }).catch(() => null);
            await queryInterface.removeColumn("wa_credit_transactions", "phone_e164", { transaction: t }).catch(() => null);

            // =========================
            // wa_credit_wallets
            // =========================
            await queryInterface.removeIndex("wa_credit_wallets", "ux_wa_wallet_scope_target", { transaction: t }).catch(() => null);

            // restore unique lama wallet (tanpa phone_e164)
            await queryInterface.addIndex(
                "wa_credit_wallets",
                ["scope_type", "group_id", "leasing_id"],
                { unique: true, name: "ux_wa_wallet_scope_target", transaction: t }
            ).catch(() => null);

            await queryInterface.removeIndex("wa_credit_wallets", "ix_wa_wallet_phone", { transaction: t }).catch(() => null);
            await queryInterface.removeColumn("wa_credit_wallets", "phone_e164", { transaction: t }).catch(() => null);

            // =========================
            // wa_command_policies
            // =========================
            await queryInterface.removeIndex("wa_command_policies", "ux_wa_policies_scope_target_command", { transaction: t }).catch(() => null);

            // restore unique lama policies (tanpa phone_e164)
            await queryInterface.addIndex(
                "wa_command_policies",
                ["scope_type", "group_id", "leasing_id", "command_id"],
                { unique: true, name: "ux_wa_policies_scope_target_command", transaction: t }
            ).catch(() => null);

            await queryInterface.removeIndex("wa_command_policies", "ix_wa_policies_phone", { transaction: t }).catch(() => null);
            await queryInterface.removeColumn("wa_command_policies", "phone_e164", { transaction: t }).catch(() => null);
        });
    },
};
