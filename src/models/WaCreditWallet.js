export default (sequelize, DataTypes) =>
    sequelize.define(
        "WaCreditWallet",
        {
            id: { type: DataTypes.UUID, primaryKey: true, defaultValue: sequelize.literal("gen_random_uuid()") },

            scope_type: { type: DataTypes.STRING(10), allowNull: false }, // GROUP | LEASING | PERSONAL
            group_id: { type: DataTypes.UUID, allowNull: true },
            leasing_id: { type: DataTypes.UUID, allowNull: true },

            // NEW
            phone_e164: { type: DataTypes.STRING(32), allowNull: true },

            balance: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
            is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

            meta: { type: DataTypes.JSONB, allowNull: true },
        },
        {
            tableName: "wa_credit_wallets",
            underscored: true,
            timestamps: true,
            indexes: [
                { fields: ["scope_type"], name: "ix_wa_wallet_scope" },
                { fields: ["group_id"], name: "ix_wa_wallet_group" },
                { fields: ["leasing_id"], name: "ix_wa_wallet_leasing" },

                // NEW
                { fields: ["phone_e164"], name: "ix_wa_wallet_phone" },

                // UPDATED unique: include phone_e164
                {
                    unique: true,
                    fields: ["scope_type", "group_id", "leasing_id", "phone_e164"],
                    name: "ux_wa_wallet_scope_target",
                },
            ],
            hooks: {
                beforeValidate: (row) => {
                    if (row.scope_type) row.scope_type = String(row.scope_type).trim().toUpperCase();
                    if (row.phone_e164) row.phone_e164 = String(row.phone_e164).trim();

                    // normalize target sesuai scope
                    if (row.scope_type === "GROUP") {
                        row.leasing_id = null;
                        row.phone_e164 = null;
                    } else if (row.scope_type === "LEASING") {
                        row.group_id = null;
                        row.phone_e164 = null;
                    } else if (row.scope_type === "PERSONAL") {
                        row.group_id = null;
                        row.leasing_id = null;
                        // phone_e164 wajib (validasi strict bisa di controller)
                    }

                    if (row.balance !== undefined && row.balance !== null) {
                        row.balance = Math.max(0, Number(row.balance || 0));
                    }
                },
            },
        }
    );
