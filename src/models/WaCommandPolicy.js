export default (sequelize, DataTypes) =>
    sequelize.define(
        "WaCommandPolicy",
        {
            id: { type: DataTypes.UUID, primaryKey: true, defaultValue: sequelize.literal("gen_random_uuid()") },

            scope_type: { type: DataTypes.STRING(10), allowNull: false }, // GROUP | LEASING
            group_id: { type: DataTypes.UUID, allowNull: true },
            leasing_id: { type: DataTypes.UUID, allowNull: true },

            command_id: { type: DataTypes.UUID, allowNull: false },

            is_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
            use_credit: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
            credit_cost: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },

            wallet_scope: { type: DataTypes.STRING(10), allowNull: false, defaultValue: "GROUP" }, // GROUP | LEASING
            meta: { type: DataTypes.JSONB, allowNull: true },
        },
        {
            tableName: "wa_command_policies",
            underscored: true,
            timestamps: true,
            indexes: [
                { fields: ["command_id"], name: "ix_wa_policies_command" },
                { fields: ["scope_type"], name: "ix_wa_policies_scope" },
                { fields: ["group_id"], name: "ix_wa_policies_group" },
                { fields: ["leasing_id"], name: "ix_wa_policies_leasing" },
                {
                    unique: true,
                    fields: ["scope_type", "group_id", "leasing_id", "command_id"],
                    name: "ux_wa_policies_scope_target_command",
                },
            ],
            hooks: {
                beforeValidate: (row) => {
                    if (row.scope_type) row.scope_type = String(row.scope_type).trim().toUpperCase();
                    if (row.wallet_scope) row.wallet_scope = String(row.wallet_scope).trim().toUpperCase();
                    if (row.credit_cost !== undefined && row.credit_cost !== null) {
                        row.credit_cost = Math.max(1, Number(row.credit_cost || 1));
                    }
                },
            },
        }
    );
