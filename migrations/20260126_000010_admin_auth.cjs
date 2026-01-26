"use strict";

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.sequelize.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

        await queryInterface.createTable("admin_users", {
            id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal("gen_random_uuid()") },
            email: { type: Sequelize.STRING(120), allowNull: false, unique: true },
            password_hash: { type: Sequelize.STRING(255), allowNull: false },
            name: { type: Sequelize.STRING(120), allowNull: true },
            role: { type: Sequelize.STRING(30), allowNull: false, defaultValue: "admin" }, // admin/superadmin
            is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
            last_login_at: { type: Sequelize.DATE, allowNull: true },
            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
        });

        await queryInterface.createTable("admin_refresh_tokens", {
            id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal("gen_random_uuid()") },
            user_id: {
                type: Sequelize.UUID,
                allowNull: false,
                references: { model: "admin_users", key: "id" },
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            },
            token_hash: { type: Sequelize.STRING(255), allowNull: false },
            expires_at: { type: Sequelize.DATE, allowNull: false },
            revoked_at: { type: Sequelize.DATE, allowNull: true },
            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("now()") },
        });

        await queryInterface.addIndex("admin_refresh_tokens", ["user_id"], { name: "ix_admin_refresh_user" });
        await queryInterface.addIndex("admin_refresh_tokens", ["expires_at"], { name: "ix_admin_refresh_expires" });
        await queryInterface.addIndex("admin_refresh_tokens", ["token_hash"], { unique: true, name: "ux_admin_refresh_tokenhash" });
    },

    async down(queryInterface) {
        await queryInterface.dropTable("admin_refresh_tokens");
        await queryInterface.dropTable("admin_users");
    },
};
