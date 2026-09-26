"use strict";

module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.query(`
            INSERT INTO wa_commands
                (id, key, name, description, scope, requires_master, allow_all_modes, is_active, created_at, updated_at)
            VALUES
                (gen_random_uuid(), 'cetak_surat', 'Cetak Surat',
                 'Cetak penugasan, BASTK, atau paket ke chat pribadi',
                 'GROUP', false, true, true, now(), now())
            ON CONFLICT (key)
            DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                scope = EXCLUDED.scope,
                requires_master = EXCLUDED.requires_master,
                allow_all_modes = EXCLUDED.allow_all_modes,
                is_active = EXCLUDED.is_active,
                updated_at = now();
        `);
    },

    async down(queryInterface) {
        await queryInterface.bulkDelete("wa_commands", { key: "cetak_surat" });
    },
};
