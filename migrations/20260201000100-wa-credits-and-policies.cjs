"use strict";

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.sequelize.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

        // =========================
        // 1) wa_command_policies
        // =========================
        await queryInterface.createTable("wa_command_policies", {
            id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal("gen_random_uuid()") },

            // scope: GROUP atau LEASING
            scope_type: { type: Sequelize.STRING(10), allowNull: false }, // "GROUP" | "LEASING"
            group_id: {
                type: Sequelize.UUID,
                allowNull: true,
                references: { model: "wa_groups", key: "id" },
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            },
            leasing_id: {
                type: Sequelize.UUID,
                allowNull: true,
                references: { model: "leasing_companies", key: "id" },
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            },

            command_id: {
                type: Sequelize.UUID,
                allowNull: false,
                references: { model: "wa_commands", key: "id" },
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            },

            // default: enabled+free jika row tidak ada (logic di service)
            is_enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },

            // bayar atau tidak
            use_credit: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },

            // cost per 1 eksekusi (kalau use_credit=true)
            credit_cost: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },

            /**
             * wallet_scope:
             * - GROUP: debit dari wallet group itu sendiri
             * - LEASING: debit dari wallet leasing (berlaku untuk semua group yg set leasing tsb)
             * Default:
             * - kalau policy scope GROUP -> default GROUP
             * - kalau policy scope LEASING -> default LEASING
             */
            wallet_scope: { type: Sequelize.STRING(10), allowNull: false, defaultValue: "GROUP" }, // "GROUP" | "LEASING"

            meta: { type: Sequelize.JSONB, allowNull: true },

            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
        });

        // indexes
        await queryInterface.addIndex("wa_command_policies", ["command_id"], { name: "ix_wa_policies_command" });
        await queryInterface.addIndex("wa_command_policies", ["scope_type"], { name: "ix_wa_policies_scope" });
        await queryInterface.addIndex("wa_command_policies", ["group_id"], { name: "ix_wa_policies_group" });
        await queryInterface.addIndex("wa_command_policies", ["leasing_id"], { name: "ix_wa_policies_leasing" });

        // unique policy per scope+command (tanpa partial index biar simpel)
        // trik: gunakan unique index gabungan; app layer memastikan field yang tidak relevan null.
        await queryInterface.addIndex(
            "wa_command_policies",
            ["scope_type", "group_id", "leasing_id", "command_id"],
            { unique: true, name: "ux_wa_policies_scope_target_command" }
        );

        // (opsional tapi bagus) CHECK constraint ringan
        // - scope_type GROUP => group_id not null, leasing_id null
        // - scope_type LEASING => leasing_id not null, group_id null
        await queryInterface.sequelize.query(`
      ALTER TABLE wa_command_policies
      ADD CONSTRAINT ck_wa_policies_scope_target
      CHECK (
        (scope_type='GROUP' AND group_id IS NOT NULL AND leasing_id IS NULL)
        OR
        (scope_type='LEASING' AND leasing_id IS NOT NULL AND group_id IS NULL)
      );
    `);

        await queryInterface.sequelize.query(`
      ALTER TABLE wa_command_policies
      ADD CONSTRAINT ck_wa_policies_cost
      CHECK (credit_cost >= 1);
    `);

        // =========================
        // 2) wa_credit_wallets
        // =========================
        await queryInterface.createTable("wa_credit_wallets", {
            id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal("gen_random_uuid()") },

            scope_type: { type: Sequelize.STRING(10), allowNull: false }, // "GROUP" | "LEASING"
            group_id: {
                type: Sequelize.UUID,
                allowNull: true,
                references: { model: "wa_groups", key: "id" },
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            },
            leasing_id: {
                type: Sequelize.UUID,
                allowNull: true,
                references: { model: "leasing_companies", key: "id" },
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            },

            balance: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
            is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },

            meta: { type: Sequelize.JSONB, allowNull: true },

            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
        });

        await queryInterface.addIndex("wa_credit_wallets", ["scope_type"], { name: "ix_wa_wallet_scope" });
        await queryInterface.addIndex("wa_credit_wallets", ["group_id"], { name: "ix_wa_wallet_group" });
        await queryInterface.addIndex("wa_credit_wallets", ["leasing_id"], { name: "ix_wa_wallet_leasing" });

        // 1 wallet per target scope
        await queryInterface.addIndex(
            "wa_credit_wallets",
            ["scope_type", "group_id", "leasing_id"],
            { unique: true, name: "ux_wa_wallet_scope_target" }
        );

        await queryInterface.sequelize.query(`
      ALTER TABLE wa_credit_wallets
      ADD CONSTRAINT ck_wa_wallet_scope_target
      CHECK (
        (scope_type='GROUP' AND group_id IS NOT NULL AND leasing_id IS NULL)
        OR
        (scope_type='LEASING' AND leasing_id IS NOT NULL AND group_id IS NULL)
      );
    `);

        await queryInterface.sequelize.query(`
      ALTER TABLE wa_credit_wallets
      ADD CONSTRAINT ck_wa_wallet_balance_nonneg
      CHECK (balance >= 0);
    `);

        // =========================
        // 3) wa_credit_transactions (ledger)
        // =========================
        await queryInterface.createTable("wa_credit_transactions", {
            id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal("gen_random_uuid()") },

            wallet_id: {
                type: Sequelize.UUID,
                allowNull: false,
                references: { model: "wa_credit_wallets", key: "id" },
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            },

            tx_type: { type: Sequelize.STRING(10), allowNull: false }, // "DEBIT" | "CREDIT"
            amount: { type: Sequelize.INTEGER, allowNull: false }, // positif

            balance_before: { type: Sequelize.INTEGER, allowNull: false },
            balance_after: { type: Sequelize.INTEGER, allowNull: false },

            // optional referensi command
            command_id: {
                type: Sequelize.UUID,
                allowNull: true,
                references: { model: "wa_commands", key: "id" },
                onDelete: "SET NULL",
                onUpdate: "CASCADE",
            },

            // redundansi untuk reporting cepat (tidak wajib tapi membantu)
            group_id: {
                type: Sequelize.UUID,
                allowNull: true,
                references: { model: "wa_groups", key: "id" },
                onDelete: "SET NULL",
                onUpdate: "CASCADE",
            },
            leasing_id: {
                type: Sequelize.UUID,
                allowNull: true,
                references: { model: "leasing_companies", key: "id" },
                onDelete: "SET NULL",
                onUpdate: "CASCADE",
            },

            // referensi event (idMessage dll)
            ref_type: { type: Sequelize.STRING(32), allowNull: true }, // e.g. "GREENAPI_MESSAGE" / "ADMIN_TOPUP"
            ref_id: { type: Sequelize.STRING(120), allowNull: true },  // e.g. idMessage
            notes: { type: Sequelize.STRING(255), allowNull: true },

            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
        });

        await queryInterface.addIndex("wa_credit_transactions", ["wallet_id", "created_at"], { name: "ix_wa_tx_wallet_time" });
        await queryInterface.addIndex("wa_credit_transactions", ["command_id"], { name: "ix_wa_tx_command" });
        await queryInterface.addIndex("wa_credit_transactions", ["group_id"], { name: "ix_wa_tx_group" });
        await queryInterface.addIndex("wa_credit_transactions", ["leasing_id"], { name: "ix_wa_tx_leasing" });
        await queryInterface.addIndex("wa_credit_transactions", ["ref_type", "ref_id"], { name: "ix_wa_tx_ref" });

        await queryInterface.sequelize.query(`
      ALTER TABLE wa_credit_transactions
      ADD CONSTRAINT ck_wa_tx_amount_pos
      CHECK (amount >= 1);
    `);

        await queryInterface.sequelize.query(`
      ALTER TABLE wa_credit_transactions
      ADD CONSTRAINT ck_wa_tx_balances_nonneg
      CHECK (balance_before >= 0 AND balance_after >= 0);
    `);
    },

    async down(queryInterface) {
        await queryInterface.dropTable("wa_credit_transactions");
        await queryInterface.dropTable("wa_credit_wallets");
        await queryInterface.dropTable("wa_command_policies");
    },
};
