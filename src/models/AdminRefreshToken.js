export default (sequelize, DataTypes) =>
    sequelize.define("AdminRefreshToken", {
        id: { type: DataTypes.UUID, primaryKey: true, defaultValue: sequelize.literal("gen_random_uuid()") },
        user_id: { type: DataTypes.UUID, allowNull: false },
        token_hash: { type: DataTypes.STRING(255), allowNull: false, unique: true },
        expires_at: { type: DataTypes.DATE, allowNull: false },
        revoked_at: { type: DataTypes.DATE },
    }, { tableName: "admin_refresh_tokens", underscored: true, timestamps: true });
