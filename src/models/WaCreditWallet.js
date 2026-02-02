export default (sequelize, DataTypes) =>
    sequelize.define(
        "WaCreditWallet",
        {
            id: { type: DataTypes.UUID, primaryKey: true, defaultValue: sequelize.literal("gen_random_uuid()") },

            scope_type: { type: DataTypes.STRING(10), allowNull: false }, // GROUP | LEASING
            group_id: { type: DataTypes.UUID, allowNull: true },
            leasing_id: { type: DataTypes.UUID, allowNull: true },

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
                {
                    unique: true,
                    fields: ["scope_type", "group_id", "leasing_id"],
                    name: "ux_wa_wallet_scope_target",
                },
            ],
            hooks: {
                beforeValidate: (row) => {
                    if (row.scope_type) row.scope_type = String(row.scope_type).trim().toUpperCase();
                    if (row.balance !== undefined && row.balance !== null) {
                        row.balance = Math.max(0, Number(row.balance || 0));
                    }
                },
            },
        }
    );
