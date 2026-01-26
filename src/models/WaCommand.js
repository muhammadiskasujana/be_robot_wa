export default (sequelize, DataTypes) =>
    sequelize.define("WaCommand", {
        id: { type: DataTypes.UUID, primaryKey: true, defaultValue: sequelize.literal("gen_random_uuid()") },
        key: { type: DataTypes.STRING(60), allowNull: false, unique: true },
        name: { type: DataTypes.STRING(120), allowNull: false },
        description: { type: DataTypes.TEXT },

        scope: { type: DataTypes.STRING(10), allowNull: false, defaultValue: "BOTH" }, // PRIVATE/GROUP/BOTH
        requires_master: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        allow_all_modes: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    }, { tableName: "wa_commands", underscored: true, timestamps: true });
