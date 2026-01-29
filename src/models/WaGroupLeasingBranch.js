export default (sequelize, DataTypes) =>
    sequelize.define("WaGroupLeasingBranch", {
        id: { type: DataTypes.UUID, primaryKey: true, defaultValue: sequelize.literal("gen_random_uuid()") },
        group_id: { type: DataTypes.UUID, allowNull: false },
        leasing_branch_id: { type: DataTypes.UUID, allowNull: false },
        is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    }, {
        tableName: "wa_group_leasing_branches",
        underscored: true,
        timestamps: true,
        indexes: [
            { unique: true, fields: ["group_id", "leasing_branch_id"] },
            // partial index tidak bisa native di indexes sequelize tanpa raw migration,
            // tapi minimal index group_id dulu:
            { fields: ["group_id"] },
        ],
    });