export default (sequelize, DataTypes) =>
    sequelize.define("WaPrivateWhitelist", {
        id: { type: DataTypes.UUID, primaryKey: true, defaultValue: sequelize.literal("gen_random_uuid()") },
        phone_e164: { type: DataTypes.STRING(20), allowNull: false, unique: true },
        label: { type: DataTypes.STRING(120) },
        notes: { type: DataTypes.TEXT },
        is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        allowed_instances: { type: DataTypes.JSONB },
    }, { tableName: "wa_private_whitelist", underscored: true, timestamps: true });
