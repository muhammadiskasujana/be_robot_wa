"use strict";
module.exports = {
    async up(q, S) {
        if (await q.tableExists("wa_command_events")) return;
        await q.sequelize.transaction(async transaction => {
        await q.createTable("wa_command_events", {
            id: { type: S.BIGINT, autoIncrement: true, primaryKey: true },
            event_key: { type: S.STRING(255), allowNull: false, unique: true },
            direction: { type: S.STRING(12), allowNull: false },
            provider: { type: S.STRING(16), allowNull: false },
            instance_key: { type: S.STRING(100), allowNull: false },
            chat_id: { type: S.STRING(100), allowNull: false },
            status: { type: S.STRING(16), allowNull: false, defaultValue: "pending" },
            payload: { type: S.JSONB, allowNull: false },
            result: { type: S.JSONB, allowNull: true },
            error: { type: S.TEXT, allowNull: true },
            created_at: { type: S.DATE, allowNull: false, defaultValue: S.literal("now()") },
            updated_at: { type: S.DATE, allowNull: false, defaultValue: S.literal("now()") },
        }, { transaction });
        await q.addIndex("wa_command_events", ["status", "id"], { transaction });
        });
    },
    async down(q) { await q.dropTable("wa_command_events"); },
};
