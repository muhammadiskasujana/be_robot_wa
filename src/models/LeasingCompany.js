export default (sequelize, DataTypes) => {
        const LeasingCompany = sequelize.define("LeasingCompany", {
                id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
                code: { type: DataTypes.STRING(32), allowNull: false, unique: true },
                name: { type: DataTypes.STRING(120), allowNull: false },
                is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        }, {
                tableName: "leasing_companies",
                underscored: true,
                hooks: {
                        beforeValidate: (row) => {
                                if (row.code) row.code = String(row.code).trim().toUpperCase();
                                if (row.name) row.name = String(row.name).trim().toUpperCase();
                        },
                },
        });

        return LeasingCompany;
};