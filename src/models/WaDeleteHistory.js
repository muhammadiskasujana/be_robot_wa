// models/WaDeleteHistory.js
export default (sequelize, DataTypes) =>
    sequelize.define(
        "WaDeleteHistory",
        {
            id: {
                type: DataTypes.UUID,
                primaryKey: true,
                defaultValue: sequelize.literal("gen_random_uuid()"),
            },

            chat_id: {
                type: DataTypes.STRING(64),
                allowNull: false,
            }, // group id

            nopol: {
                type: DataTypes.STRING(16),
                allowNull: false,
            },

            sender: {
                type: DataTypes.STRING(32),
                allowNull: false,
            }, // phone e164 / jid normalized

            leasing_code: {
                type: DataTypes.STRING(32),
                allowNull: false,
            },

            delete_reason: {
                type: DataTypes.STRING(64),
                allowNull: true, // null saat pending
            },

            status: {
                type: DataTypes.ENUM(
                    "PENDING",
                    "DONE",
                    "FAILED",
                    "CANCELLED",
                    "EXPIRED"
                ),
                allowNull: false,
                defaultValue: "PENDING",
            },

            requested_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
            },

            confirmed_at: {
                type: DataTypes.DATE,
                allowNull: true,
            },

            meta: {
                type: DataTypes.JSONB,
                allowNull: false,
                defaultValue: {},
            },
        },
        {
            tableName: "wa_delete_histories",
            underscored: true,
            timestamps: true,
            indexes: [
                {
                    fields: ["chat_id", "status", "requested_at"],
                    name: "ix_wa_delete_hist_chat_status_time",
                },
                {
                    fields: ["chat_id", "nopol"],
                    name: "ix_wa_delete_hist_chat_nopol",
                },
                {
                    fields: ["sender", "status"],
                    name: "ix_wa_delete_hist_sender_status",
                },
                {
                    fields: ["leasing_code", "requested_at"],
                    name: "ix_wa_delete_hist_leasing_time",
                },
            ],
            hooks: {
                beforeValidate: (row) => {
                    if (row.chat_id)
                        row.chat_id = String(row.chat_id).trim();

                    if (row.nopol)
                        row.nopol = String(row.nopol).trim().toUpperCase();

                    if (row.sender)
                        row.sender = String(row.sender).trim();

                    if (row.leasing_code)
                        row.leasing_code = String(row.leasing_code)
                            .trim()
                            .toUpperCase();

                    if (
                        row.delete_reason !== undefined &&
                        row.delete_reason !== null
                    ) {
                        row.delete_reason = String(row.delete_reason)
                            .trim()
                            .toLowerCase();
                    }

                    if (row.status)
                        row.status = String(row.status).trim().toUpperCase();

                    // hard normalize status (extra safety walau sudah ENUM)
                    if (
                        row.status &&
                        ![
                            "PENDING",
                            "DONE",
                            "FAILED",
                            "CANCELLED",
                            "EXPIRED",
                        ].includes(row.status)
                    ) {
                        row.status = "PENDING";
                    }
                },
            },
        }
    );
