export default (sequelize, DataTypes) =>
    sequelize.define("AdminUser", {
        id: { type: DataTypes.UUID, primaryKey: true, defaultValue: sequelize.literal("gen_random_uuid()") },
        email: { type: DataTypes.STRING(120), allowNull: false, unique: true },
        password_hash: { type: DataTypes.STRING(255), allowNull: false },
        name: { type: DataTypes.STRING(120) },
        role: { type: DataTypes.STRING(30), allowNull: false, defaultValue: "admin" },
        is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        last_login_at: { type: DataTypes.DATE },
    }, { tableName: "admin_users", underscored: true, timestamps: true });
