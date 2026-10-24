export default (sequelize, DataTypes) => sequelize.define("WaInternalReport", {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    nopol: { type: DataTypes.STRING(20), allowNull: false },
    leasing: { type: DataTypes.STRING(64), allowNull: false },
    access_at: { type: DataTypes.STRING(19), allowNull: false },
    report_at: { type: DataTypes.STRING(19), allowNull: false },
    access_user: { type: DataTypes.STRING(255), allowNull: false },
    access_phone: { type: DataTypes.STRING(32), allowNull: false },
    internal_phone: { type: DataTypes.STRING(32), allowNull: false },
    group_id: { type: DataTypes.STRING(64), allowNull: false },
    report_internal: { type: DataTypes.STRING(32), allowNull: false },
}, { tableName: "wa_internal_reports", underscored: true, timestamps: true,
    indexes: [{ unique: true, name: "uq_wa_internal_access", fields: ["nopol", "leasing", "access_at", "access_user", "access_phone"] }] });
