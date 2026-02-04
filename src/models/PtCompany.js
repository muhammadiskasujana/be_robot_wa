export default (sequelize, DataTypes) => {
    const PtCompany = sequelize.define("PtCompany", {
        id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
        code: { type: DataTypes.STRING(32), allowNull: false, unique: true }, // optional short code
        name: { type: DataTypes.STRING(180), allowNull: false, unique: true },
        is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    }, {
        tableName: "pt_companies",
        underscored: true,
        hooks: {
            beforeValidate: (row) => {
                if (row.code) row.code = String(row.code).trim().toUpperCase();
                if (row.name) row.name = String(row.name).trim().toUpperCase();
            },
        },
    });

    return PtCompany;
};
