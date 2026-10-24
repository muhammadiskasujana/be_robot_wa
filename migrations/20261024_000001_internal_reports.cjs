"use strict";
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable("wa_internal_reports", {
            id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.literal("gen_random_uuid()") },
            nopol: { type: Sequelize.STRING(20), allowNull: false },
            leasing: { type: Sequelize.STRING(64), allowNull: false },
            access_at: { type: Sequelize.STRING(19), allowNull: false },
            report_at: { type: Sequelize.STRING(19), allowNull: false },
            access_user: { type: Sequelize.STRING(255), allowNull: false },
            access_phone: { type: Sequelize.STRING(32), allowNull: false },
            internal_phone: { type: Sequelize.STRING(32), allowNull: false },
            group_id: { type: Sequelize.STRING(64), allowNull: false },
            report_internal: { type: Sequelize.STRING(32), allowNull: false },
            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
            updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
        });
        await queryInterface.addIndex("wa_internal_reports", ["nopol", "leasing", "access_at", "access_user", "access_phone"], { unique: true, name: "uq_wa_internal_access" });
    },
    async down(queryInterface) { await queryInterface.dropTable("wa_internal_reports"); },
};
