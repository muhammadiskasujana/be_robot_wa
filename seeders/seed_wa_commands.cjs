"use strict";

module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.query(`
      INSERT INTO wa_commands (id, key, name, description, scope, requires_master, allow_all_modes, is_active, created_at, updated_at)
      VALUES
        (gen_random_uuid(), 'cek_nopol', 'Cek Nopol', 'Cek data kendaraan berdasarkan nopol. Contoh: cek nopol AB1234CD', 'GROUP', false, true, true, now(), now()),
        (gen_random_uuid(), 'history', 'History', 'Ambil history berdasarkan nopol. Contoh: history AB1234CD', 'GROUP', false, true, true, now(), now()),
        (gen_random_uuid(), 'request_lokasi', 'Request Lokasi', 'Request lokasi ke nomor. Contoh: request lokasi 08123456789', 'GROUP', false, true, true, now(), now())
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
        await queryInterface.bulkDelete("wa_commands", {
            key: ["cek_nopol", "history", "request_lokasi"],
        });
    },
};
