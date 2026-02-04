"use strict";

module.exports = {
    async up(queryInterface, Sequelize) {
        // Pastikan gen_random_uuid() tersedia
        await queryInterface.sequelize.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

        // =========================================================
        // 1) pt_companies
        // =========================================================
        await queryInterface.createTable("pt_companies", {
            id: {
                type: Sequelize.UUID,
                primaryKey: true,
                defaultValue: Sequelize.literal("gen_random_uuid()"),
            },
            code: { type: Sequelize.STRING(32), allowNull: false, unique: true },
            name: { type: Sequelize.STRING(180), allowNull: false, unique: true },
            is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
        });

        await queryInterface.addIndex("pt_companies", ["is_active"], { name: "ix_pt_companies_active" });
        await queryInterface.addIndex("pt_companies", ["name"], { name: "ix_pt_companies_name" });

        // =========================================================
        // 2) wa_groups add pt_company_id (FK)
        // =========================================================
        await queryInterface.addColumn("wa_groups", "pt_company_id", {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: "pt_companies", key: "id" },
            onUpdate: "CASCADE",
            onDelete: "SET NULL",
        });

        await queryInterface.addIndex("wa_groups", ["pt_company_id"], { name: "ix_wa_groups_pt_company" });

        // =========================================================
        // 3) wa_group_subscriptions (time-based subscription)
        // =========================================================
        await queryInterface.createTable("wa_group_subscriptions", {
            id: {
                type: Sequelize.UUID,
                primaryKey: true,
                defaultValue: Sequelize.literal("gen_random_uuid()"),
            },

            // scope target
            scope_type: { type: Sequelize.STRING(10), allowNull: false }, // GROUP | LEASING | PT
            group_id: {
                type: Sequelize.UUID,
                allowNull: true,
                references: { model: "wa_groups", key: "id" },
                onUpdate: "CASCADE",
                onDelete: "CASCADE",
            },
            leasing_id: {
                type: Sequelize.UUID,
                allowNull: true,
                references: { model: "leasing_companies", key: "id" },
                onUpdate: "CASCADE",
                onDelete: "CASCADE",
            },
            pt_company_id: {
                type: Sequelize.UUID,
                allowNull: true,
                references: { model: "pt_companies", key: "id" },
                onUpdate: "CASCADE",
                onDelete: "CASCADE",
            },

            // which feature/command is subscribed
            command_id: {
                type: Sequelize.UUID,
                allowNull: false,
                references: { model: "wa_commands", key: "id" },
                onUpdate: "CASCADE",
                onDelete: "CASCADE",
            },

            starts_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
            expires_at: { type: Sequelize.DATE, allowNull: false },
            is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },

            meta: { type: Sequelize.JSONB, allowNull: true },

            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
        });

        // Indexes untuk performa query routing/billing
        await queryInterface.addIndex("wa_group_subscriptions", ["command_id"], { name: "ix_wa_subs_command" });
        await queryInterface.addIndex("wa_group_subscriptions", ["scope_type"], { name: "ix_wa_subs_scope" });
        await queryInterface.addIndex("wa_group_subscriptions", ["group_id"], { name: "ix_wa_subs_group" });
        await queryInterface.addIndex("wa_group_subscriptions", ["leasing_id"], { name: "ix_wa_subs_leasing" });
        await queryInterface.addIndex("wa_group_subscriptions", ["pt_company_id"], { name: "ix_wa_subs_pt" });
        await queryInterface.addIndex("wa_group_subscriptions", ["expires_at"], { name: "ix_wa_subs_expires" });

        // Unique key sama style tabel kamu yang lain
        await queryInterface.addConstraint("wa_group_subscriptions", {
            type: "unique",
            fields: ["scope_type", "group_id", "leasing_id", "pt_company_id", "command_id"],
            name: "ux_wa_subs_scope_target_command",
        });

        // =========================================================
        // 4) wa_command_policies add billing_mode
        // =========================================================
        await queryInterface.addColumn("wa_command_policies", "billing_mode", {
            type: Sequelize.STRING(20), // FREE | CREDIT | SUBSCRIPTION
            allowNull: false,
            defaultValue: "FREE",
        });

        await queryInterface.addIndex("wa_command_policies", ["billing_mode"], { name: "ix_wa_policies_billing_mode" });
    },

    async down(queryInterface) {
        // balik urutan (reverse safe)
        // 4) drop billing_mode
        await queryInterface.removeIndex("wa_command_policies", "ix_wa_policies_billing_mode").catch(() => {});
        await queryInterface.removeColumn("wa_command_policies", "billing_mode");

        // 3) drop subscriptions
        await queryInterface.removeConstraint("wa_group_subscriptions", "ux_wa_subs_scope_target_command").catch(() => {});
        await queryInterface.dropTable("wa_group_subscriptions");

        // 2) remove pt_company_id from wa_groups
        await queryInterface.removeIndex("wa_groups", "ix_wa_groups_pt_company").catch(() => {});
        await queryInterface.removeColumn("wa_groups", "pt_company_id");

        // 1) drop pt_companies
        await queryInterface.dropTable("pt_companies");
    },
};
