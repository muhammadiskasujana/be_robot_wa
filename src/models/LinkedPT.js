export default function (sequelize, DataTypes) {
    const LinkedPT = sequelize.define(
        "LinkedPT",
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
            },
            name: {
                type: DataTypes.STRING(255),
                allowNull: false,
                comment: "Nama PT, contoh: PT LINTAS BORNEO SUKSES",
            },
            code: {
                type: DataTypes.STRING(50),
                allowNull: false,
                unique: true,
                comment: "Kode PT, contoh: lbs",
            },
            is_active: {
                type: DataTypes.BOOLEAN,
                defaultValue: true,
                allowNull: false,
            },
            meta: {
                type: DataTypes.JSONB,
                defaultValue: {},
                allowNull: true,
            },
            created_at: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
            },
            updated_at: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
            },
        },
        {
            tableName: "linked_pt",
            timestamps: false,
            underscored: true,
            indexes: [
                { unique: true, fields: ["code"] },
                { fields: ["is_active"] },
            ],
            hooks: {
                beforeValidate(pt) {
                    if (pt.name) pt.name = String(pt.name).trim().toUpperCase();
                    if (pt.code) pt.code = String(pt.code).trim().toLowerCase();
                },
                beforeUpdate(pt) {
                    pt.updated_at = new Date();
                },
            },
        }
    );

    return LinkedPT;
}