export default (sequelize, DataTypes) =>
    sequelize.define("WaMaster", {
        id: { type: DataTypes.UUID, primaryKey: true, defaultValue: sequelize.literal("gen_random_uuid()") },
        phone_e164: { type: DataTypes.STRING(20), allowNull: false, unique: true },
        role: { type: DataTypes.STRING(30), allowNull: false, defaultValue: "admin" },
        is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    }, { tableName: "wa_masters", underscored: true, timestamps: true });
