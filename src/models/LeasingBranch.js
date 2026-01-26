export default (sequelize, DataTypes) =>
    sequelize.define("LeasingBranch", {
        id: { type: DataTypes.UUID, primaryKey: true, defaultValue: sequelize.literal("gen_random_uuid()") },
        leasing_id: { type: DataTypes.UUID, allowNull: false },
        code: { type: DataTypes.STRING(50) },
        name: { type: DataTypes.STRING(120), allowNull: false },
        level: { type: DataTypes.STRING(10), allowNull: false, defaultValue: "CABANG" }, // AREA/CABANG
        parent_id: { type: DataTypes.UUID },
        is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        meta: { type: DataTypes.JSONB },
    }, { tableName: "leasing_branches", underscored: true, timestamps: true });
