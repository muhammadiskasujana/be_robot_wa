"use strict";
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("wa_groups", "is_ai_enabled", { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    await queryInterface.sequelize.query(`INSERT INTO wa_commands (id, key, name, description, scope, requires_master, allow_all_modes, is_active, created_at, updated_at) VALUES (gen_random_uuid(), 'ai_chat', 'AI Chat', 'Izin AI untuk chat pribadi', 'PRIVATE', false, true, true, now(), now()) ON CONFLICT (key) DO NOTHING`);
  },
  async down(queryInterface) {
    await queryInterface.bulkDelete("wa_commands", { key: "ai_chat" });
    await queryInterface.removeColumn("wa_groups", "is_ai_enabled");
  }
};
