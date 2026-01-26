"use strict";

module.exports = {
    async up(queryInterface) {
        // Modes
        await queryInterface.bulkInsert(
            "wa_group_modes",
            [
                {
                    id: queryInterface.sequelize.literal("gen_random_uuid()"),
                    key: "general",
                    name: "General",
                    description: "Mode umum",
                    is_active: true,
                    created_at: new Date(),
                    updated_at: new Date(),
                },
                {
                    id: queryInterface.sequelize.literal("gen_random_uuid()"),
                    key: "leasing",
                    name: "Leasing",
                    description: "Mode khusus leasing",
                    is_active: true,
                    created_at: new Date(),
                    updated_at: new Date(),
                },
            ],
            {}
        );

        // Commands (minimal untuk admin & demo)
        await queryInterface.bulkInsert(
            "wa_commands",
            [
                // admin group
                {
                    id: queryInterface.sequelize.literal("gen_random_uuid()"),
                    key: "on",
                    name: "Bot On",
                    description: "Aktifkan bot di group",
                    scope: "GROUP",
                    requires_master: true,
                    allow_all_modes: true,
                    is_active: true,
                    created_at: new Date(),
                    updated_at: new Date(),
                },
                {
                    id: queryInterface.sequelize.literal("gen_random_uuid()"),
                    key: "off",
                    name: "Bot Off",
                    description: "Nonaktifkan bot di group",
                    scope: "GROUP",
                    requires_master: true,
                    allow_all_modes: true,
                    is_active: true,
                    created_at: new Date(),
                    updated_at: new Date(),
                },
                {
                    id: queryInterface.sequelize.literal("gen_random_uuid()"),
                    key: "mode",
                    name: "Set Mode",
                    description: "Set mode group",
                    scope: "GROUP",
                    requires_master: true,
                    allow_all_modes: true,
                    is_active: true,
                    created_at: new Date(),
                    updated_at: new Date(),
                },
                {
                    id: queryInterface.sequelize.literal("gen_random_uuid()"),
                    key: "notif",
                    name: "Toggle Notif",
                    description: "Toggle notif akses data",
                    scope: "GROUP",
                    requires_master: true,
                    allow_all_modes: true,
                    is_active: true,
                    created_at: new Date(),
                    updated_at: new Date(),
                },
                {
                    id: queryInterface.sequelize.literal("gen_random_uuid()"),
                    key: "leasing",
                    name: "Leasing Config",
                    description: "Set leasing + level + cabang untuk group",
                    scope: "GROUP",
                    requires_master: true,
                    allow_all_modes: true,
                    is_active: true,
                    created_at: new Date(),
                    updated_at: new Date(),
                },

                // utility
                {
                    id: queryInterface.sequelize.literal("gen_random_uuid()"),
                    key: "help",
                    name: "Help",
                    description: "Tampilkan bantuan",
                    scope: "BOTH",
                    requires_master: false,
                    allow_all_modes: true,
                    is_active: true,
                    created_at: new Date(),
                    updated_at: new Date(),
                },
                {
                    id: queryInterface.sequelize.literal("gen_random_uuid()"),
                    key: "ping",
                    name: "Ping",
                    description: "Ping test",
                    scope: "BOTH",
                    requires_master: false,
                    allow_all_modes: true,
                    is_active: true,
                    created_at: new Date(),
                    updated_at: new Date(),
                },
            ],
            {}
        );
    },

    async down(queryInterface) {
        await queryInterface.bulkDelete("wa_commands", { key: ["on", "off", "mode", "notif", "leasing", "help", "ping"] });
        await queryInterface.bulkDelete("wa_group_modes", { key: ["general", "leasing"] });
    },
};
