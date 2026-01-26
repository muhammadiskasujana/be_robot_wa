export default (sequelize, DataTypes) =>
    sequelize.define("WaGroup", {
        id: { type: DataTypes.UUID, primaryKey: true, defaultValue: sequelize.literal("gen_random_uuid()") },
        chat_id: { type: DataTypes.STRING(80), allowNull: false, unique: true },
        title: { type: DataTypes.STRING(200) },
        is_bot_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        notif_data_access_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

        mode_id: { type: DataTypes.UUID },
        leasing_id: { type: DataTypes.UUID },
        leasing_level: { type: DataTypes.STRING(10) }, // HO/AREA/CABANG
        leasing_branch_id: { type: DataTypes.UUID },  // optional shortcut
        meta: { type: DataTypes.JSONB },
    }, { tableName: "wa_groups", underscored: true, timestamps: true });
