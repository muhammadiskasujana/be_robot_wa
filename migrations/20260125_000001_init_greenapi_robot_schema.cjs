"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        // --- Extensions ---
        await queryInterface.sequelize.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

        // --- wa_instances ---
        await queryInterface.createTable("wa_instances", {
            id: {
                type: Sequelize.UUID,
                primaryKey: true,
                defaultValue: Sequelize.literal("gen_random_uuid()"),
            },
            id_instance: { type: Sequelize.BIGINT, allowNull: false, unique: true },
            api_token: { type: Sequelize.STRING(255), allowNull: false },
            name: { type: Sequelize.STRING(100), allowNull: true },
            is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
            meta: { type: Sequelize.JSONB, allowNull: true },

            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
        });

        // --- wa_message_logs ---
        await queryInterface.createTable("wa_message_logs", {
            id: {
                type: Sequelize.UUID,
                primaryKey: true,
                defaultValue: Sequelize.literal("gen_random_uuid()"),
            },
            id_instance: { type: Sequelize.BIGINT, allowNull: false },
            id_message: { type: Sequelize.STRING(80), allowNull: false },
            chat_id: { type: Sequelize.STRING(64), allowNull: true },
            sender: { type: Sequelize.STRING(64), allowNull: true },
            type_webhook: { type: Sequelize.STRING(64), allowNull: true },
            type_message: { type: Sequelize.STRING(64), allowNull: true },
            body: { type: Sequelize.JSONB, allowNull: true },

            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
        });

        // Dedup unique: (id_instance, id_message)
        await queryInterface.addIndex("wa_message_logs", ["id_instance", "id_message"], {
            unique: true,
            name: "ux_wa_message_logs_instance_message",
        });
        await queryInterface.addIndex("wa_message_logs", ["chat_id"], { name: "ix_wa_message_logs_chat_id" });
        await queryInterface.addIndex("wa_message_logs", ["created_at"], { name: "ix_wa_message_logs_created_at" });

        // --- wa_private_whitelist ---
        await queryInterface.createTable("wa_private_whitelist", {
            id: {
                type: Sequelize.UUID,
                primaryKey: true,
                defaultValue: Sequelize.literal("gen_random_uuid()"),
            },
            phone_e164: { type: Sequelize.STRING(20), allowNull: false, unique: true },
            label: { type: Sequelize.STRING(120), allowNull: true },
            notes: { type: Sequelize.TEXT, allowNull: true },
            is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
            allowed_instances: { type: Sequelize.JSONB, allowNull: true }, // optional ["11010001","11010002"]

            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
        });

        // --- wa_masters ---
        await queryInterface.createTable("wa_masters", {
            id: {
                type: Sequelize.UUID,
                primaryKey: true,
                defaultValue: Sequelize.literal("gen_random_uuid()"),
            },
            phone_e164: { type: Sequelize.STRING(20), allowNull: false, unique: true },
            role: { type: Sequelize.STRING(30), allowNull: false, defaultValue: "admin" },
            is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },

            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
        });

        // --- wa_group_modes ---
        await queryInterface.createTable("wa_group_modes", {
            id: {
                type: Sequelize.UUID,
                primaryKey: true,
                defaultValue: Sequelize.literal("gen_random_uuid()"),
            },
            key: { type: Sequelize.STRING(40), allowNull: false, unique: true },
            name: { type: Sequelize.STRING(80), allowNull: false },
            description: { type: Sequelize.TEXT, allowNull: true },
            is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },

            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
        });

        // --- leasing_companies ---
        await queryInterface.createTable("leasing_companies", {
            id: {
                type: Sequelize.UUID,
                primaryKey: true,
                defaultValue: Sequelize.literal("gen_random_uuid()"),
            },
            code: { type: Sequelize.STRING(30), allowNull: false, unique: true },
            name: { type: Sequelize.STRING(120), allowNull: false },
            is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
            meta: { type: Sequelize.JSONB, allowNull: true },

            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
        });

        // --- leasing_branches ---
        await queryInterface.createTable("leasing_branches", {
            id: {
                type: Sequelize.UUID,
                primaryKey: true,
                defaultValue: Sequelize.literal("gen_random_uuid()"),
            },
            leasing_id: {
                type: Sequelize.UUID,
                allowNull: false,
                references: { model: "leasing_companies", key: "id" },
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            },
            code: { type: Sequelize.STRING(50), allowNull: true },
            name: { type: Sequelize.STRING(120), allowNull: false },
            level: { type: Sequelize.STRING(10), allowNull: false, defaultValue: "CABANG" }, // AREA/CABANG
            parent_id: {
                type: Sequelize.UUID,
                allowNull: true,
                references: { model: "leasing_branches", key: "id" },
                onDelete: "SET NULL",
                onUpdate: "CASCADE",
            },
            is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
            meta: { type: Sequelize.JSONB, allowNull: true },

            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
        });

        await queryInterface.addIndex("leasing_branches", ["leasing_id", "name"], {
            unique: true,
            name: "ux_leasing_branches_leasing_name",
        });

        // --- wa_groups ---
        await queryInterface.createTable("wa_groups", {
            id: {
                type: Sequelize.UUID,
                primaryKey: true,
                defaultValue: Sequelize.literal("gen_random_uuid()"),
            },
            chat_id: { type: Sequelize.STRING(80), allowNull: false, unique: true }, // ...@g.us
            title: { type: Sequelize.STRING(200), allowNull: true },

            is_bot_enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
            notif_data_access_enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },

            mode_id: {
                type: Sequelize.UUID,
                allowNull: true,
                references: { model: "wa_group_modes", key: "id" },
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
            leasing_level: { type: Sequelize.STRING(10), allowNull: true }, // HO/AREA/CABANG

            // NOTE: single branch field tidak wajib dipakai (karena kita pakai pivot),
            // tapi disimpan kalau kamu mau cepat baca "default branch" untuk level CABANG.
            leasing_branch_id: {
                type: Sequelize.UUID,
                allowNull: true,
                references: { model: "leasing_branches", key: "id" },
                onDelete: "SET NULL",
                onUpdate: "CASCADE",
            },

            meta: { type: Sequelize.JSONB, allowNull: true },

            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
        });

        // --- wa_commands ---
        await queryInterface.createTable("wa_commands", {
            id: {
                type: Sequelize.UUID,
                primaryKey: true,
                defaultValue: Sequelize.literal("gen_random_uuid()"),
            },
            key: { type: Sequelize.STRING(60), allowNull: false, unique: true },
            name: { type: Sequelize.STRING(120), allowNull: false },
            description: { type: Sequelize.TEXT, allowNull: true },

            scope: { type: Sequelize.STRING(10), allowNull: false, defaultValue: "BOTH" }, // PRIVATE/GROUP/BOTH
            requires_master: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
            allow_all_modes: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
            is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },

            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
        });

        // --- wa_command_modes (mapping command -> mode) ---
        await queryInterface.createTable("wa_command_modes", {
            id: {
                type: Sequelize.UUID,
                primaryKey: true,
                defaultValue: Sequelize.literal("gen_random_uuid()"),
            },
            command_id: {
                type: Sequelize.UUID,
                allowNull: false,
                references: { model: "wa_commands", key: "id" },
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            },
            mode_id: {
                type: Sequelize.UUID,
                allowNull: false,
                references: { model: "wa_group_modes", key: "id" },
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            },
            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
        });

        await queryInterface.addIndex("wa_command_modes", ["command_id", "mode_id"], {
            unique: true,
            name: "ux_wa_command_modes_command_mode",
        });

        // --- wa_group_leasing_branches (pivot: group -> allowed branches) ---
        await queryInterface.createTable("wa_group_leasing_branches", {
            id: {
                type: Sequelize.UUID,
                primaryKey: true,
                defaultValue: Sequelize.literal("gen_random_uuid()"),
            },
            group_id: {
                type: Sequelize.UUID,
                allowNull: false,
                references: { model: "wa_groups", key: "id" },
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            },
            leasing_branch_id: {
                type: Sequelize.UUID,
                allowNull: false,
                references: { model: "leasing_branches", key: "id" },
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            },
            is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },

            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
        });

        await queryInterface.addIndex("wa_group_leasing_branches", ["group_id", "leasing_branch_id"], {
            unique: true,
            name: "ux_wglb_group_branch",
        });
        await queryInterface.addIndex("wa_group_leasing_branches", ["group_id"], { name: "ix_wglb_group_id" });
        await queryInterface.addIndex("wa_group_leasing_branches", ["leasing_branch_id"], { name: "ix_wglb_branch_id" });
    },

    async down(queryInterface) {
        // Drop in reverse order of dependencies
        await queryInterface.dropTable("wa_group_leasing_branches");
        await queryInterface.dropTable("wa_command_modes");
        await queryInterface.dropTable("wa_commands");
        await queryInterface.dropTable("wa_groups");
        await queryInterface.dropTable("leasing_branches");
        await queryInterface.dropTable("leasing_companies");
        await queryInterface.dropTable("wa_group_modes");
        await queryInterface.dropTable("wa_masters");
        await queryInterface.dropTable("wa_private_whitelist");
        await queryInterface.dropTable("wa_message_logs");
        await queryInterface.dropTable("wa_instances");

        // optional: keep extension (biasanya jangan di-drop)
        // await queryInterface.sequelize.query(`DROP EXTENSION IF EXISTS pgcrypto;`);
    },
};
