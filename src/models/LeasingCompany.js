export default (sequelize, DataTypes) =>
    sequelize.define("LeasingCompany", {
        id: { type: DataTypes.UUID, primaryKey: true, defaultValue: sequelize.literal("gen_random_uuid()") },
        code: { type: DataTypes.STRING(30), allowNull: false, unique: true },
        name: { type: DataTypes.STRING(120), allowNull: false },
        is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        meta: { type: DataTypes.JSONB },
    }, { tableName: "leasing_companies", underscored: true, timestamps: true });
