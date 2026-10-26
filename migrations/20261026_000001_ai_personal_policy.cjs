"use strict";

module.exports = {
  async up(queryInterface) {
    const columns = await queryInterface.describeTable("wa_command_policies");
    if (!columns.phone_e164) {
      throw new Error("Migration 20260206_add_personal_wallet_policy must run before AI personal policy");
    }
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(`
        ALTER TABLE wa_command_policies
        DROP CONSTRAINT IF EXISTS ck_wa_policies_scope_target;
        ALTER TABLE wa_command_policies
        ADD CONSTRAINT ck_wa_policies_scope_target CHECK (
          (scope_type = 'GROUP' AND group_id IS NOT NULL AND leasing_id IS NULL)
          OR (scope_type = 'LEASING' AND leasing_id IS NOT NULL AND group_id IS NULL)
          OR (scope_type = 'PERSONAL' AND phone_e164 IS NOT NULL
              AND NOT (group_id IS NOT NULL AND leasing_id IS NOT NULL))
        );
      `, { transaction });
    });
  },
  async down(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(
      "SELECT count(*)::int AS total FROM wa_command_policies WHERE scope_type = 'PERSONAL'"
    );
    if (rows[0].total) throw new Error("Remove PERSONAL policies before reverting this constraint");
    await queryInterface.sequelize.query(`
      ALTER TABLE wa_command_policies
      DROP CONSTRAINT IF EXISTS ck_wa_policies_scope_target;
      ALTER TABLE wa_command_policies
      ADD CONSTRAINT ck_wa_policies_scope_target CHECK (
        (scope_type = 'GROUP' AND group_id IS NOT NULL AND leasing_id IS NULL)
        OR (scope_type = 'LEASING' AND leasing_id IS NOT NULL AND group_id IS NULL)
      );
    `);
  }
};
