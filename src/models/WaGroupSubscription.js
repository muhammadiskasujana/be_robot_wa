export default (sequelize, DataTypes) =>
    sequelize.define("WaGroupSubscription", {
        id: { type: DataTypes.UUID, primaryKey: true, defaultValue: sequelize.literal("gen_random_uuid()") },

        scope_type: { type: DataTypes.STRING(10), allowNull: false }, // GROUP | LEASING | PT
        group_id: { type: DataTypes.UUID, allowNull: true },
        leasing_id: { type: DataTypes.UUID, allowNull: true },
        pt_company_id: { type: DataTypes.UUID, allowNull: true },

        command_id: { type: DataTypes.UUID, allowNull: false },

        starts_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("now()") },
        expires_at: { type: DataTypes.DATE, allowNull: false },
        is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

        meta: { type: DataTypes.JSONB, allowNull: true },
    }, {
        tableName: "wa_group_subscriptions",
        underscored: true,
        timestamps: true,
        indexes: [
            { fields: ["command_id"], name: "ix_wa_subs_command" },
            { fields: ["scope_type"], name: "ix_wa_subs_scope" },
            { fields: ["group_id"], name: "ix_wa_subs_group" },
            { fields: ["leasing_id"], name: "ix_wa_subs_leasing" },
            { fields: ["pt_company_id"], name: "ix_wa_subs_pt" },
            { fields: ["expires_at"], name: "ix_wa_subs_expires" },
            {
                unique: true,
                fields: ["scope_type", "group_id", "leasing_id", "pt_company_id", "command_id"],
                name: "ux_wa_subs_scope_target_command",
            },
        ],
        hooks: {
            beforeValidate: (row) => {
                if (row.scope_type) row.scope_type = String(row.scope_type).trim().toUpperCase();
            },
        },
    });
