export default (sequelize, DataTypes) =>
    sequelize.define(
        "WaGroupMatel",
        {
            id: {
                type: DataTypes.UUID,
                primaryKey: true,
                defaultValue: sequelize.literal("gen_random_uuid()"),
            },

            group_id: {
                type: DataTypes.UUID,
                allowNull: false,
            },

            phone_e164: {
                type: DataTypes.STRING(30),
                allowNull: false,
            },

            matel_name: {
                type: DataTypes.STRING(200),
                allowNull: true,
            },

            is_active: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: true,
            },

            created_by_phone: {
                type: DataTypes.STRING(30),
                allowNull: true,
            },

            meta: {
                type: DataTypes.JSONB,
                allowNull: true,
            },
        },
        {
            tableName: "wa_group_matels",
            underscored: true,
            timestamps: true,
            indexes: [
                {
                    unique: true,
                    fields: ["group_id", "phone_e164"],
                    name: "uq_wa_group_matels_group_phone",
                },
                {
                    fields: ["phone_e164", "is_active"],
                    name: "idx_wa_group_matels_phone_active",
                },
                {
                    fields: ["group_id", "is_active"],
                    name: "idx_wa_group_matels_group_active",
                },
            ],
        }
    );