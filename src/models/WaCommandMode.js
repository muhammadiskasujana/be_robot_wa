export default (sequelize, DataTypes) =>
    sequelize.define("WaCommandMode", {
        id: { type: DataTypes.UUID, primaryKey: true, defaultValue: sequelize.literal("gen_random_uuid()") },
        command_id: { type: DataTypes.UUID, allowNull: false },
        mode_id: { type: DataTypes.UUID, allowNull: false },
    }, { tableName: "wa_command_modes", underscored: true, timestamps: true });
