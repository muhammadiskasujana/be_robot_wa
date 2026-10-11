export default (sequelize, DataTypes) => sequelize.define("WaCommandEvent", {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    event_key: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    direction: { type: DataTypes.STRING(12), allowNull: false },
    provider: { type: DataTypes.STRING(16), allowNull: false },
    instance_key: { type: DataTypes.STRING(100), allowNull: false },
    chat_id: { type: DataTypes.STRING(100), allowNull: false },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "pending" },
    payload: { type: DataTypes.JSONB, allowNull: false },
    result: { type: DataTypes.JSONB, allowNull: true },
    error: { type: DataTypes.TEXT, allowNull: true },
}, { tableName: "wa_command_events", underscored: true, timestamps: true,
    indexes: [{ fields: ["status", "id"] }] });
