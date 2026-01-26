export default (sequelize, DataTypes) =>
    sequelize.define("WaGroupMode", {
        id: { type: DataTypes.UUID, primaryKey: true, defaultValue: sequelize.literal("gen_random_uuid()") },
        key: { type: DataTypes.STRING(40), allowNull: false, unique: true },
        name: { type: DataTypes.STRING(80), allowNull: false },
        description: { type: DataTypes.TEXT },
        is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    }, { tableName: "wa_group_modes", underscored: true, timestamps: true });
