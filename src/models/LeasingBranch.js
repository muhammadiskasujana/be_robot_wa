export default (sequelize, DataTypes) => {
        const LeasingBranch = sequelize.define("LeasingBranch", {
                id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
                leasing_id: { type: DataTypes.UUID, allowNull: false },
                code: { type: DataTypes.STRING(32), allowNull: true },
                name: { type: DataTypes.STRING(120), allowNull: false },
                is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        }, {
                tableName: "leasing_branches",
                underscored: true,
                hooks: {
                        beforeValidate: (row) => {
                                if (row.code) row.code = String(row.code).trim().toUpperCase();
                                if (row.name) row.name = String(row.name).trim().toUpperCase();
                        },
                },
        });

        return LeasingBranch;
};
