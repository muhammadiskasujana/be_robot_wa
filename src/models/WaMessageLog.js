export default (sequelize, DataTypes) => {
    const WaMessageLog = sequelize.define(
        "WaMessageLog",
        {
            id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
            id_instance: { type: DataTypes.BIGINT, allowNull: false },
            id_message: { type: DataTypes.STRING(80), allowNull: false },
            chat_id: { type: DataTypes.STRING(64), allowNull: true },
            sender: { type: DataTypes.STRING(64), allowNull: true },
            type_webhook: { type: DataTypes.STRING(64), allowNull: true },
            type_message: { type: DataTypes.STRING(64), allowNull: true },
            body: { type: DataTypes.JSONB, allowNull: true },
        },
        {
            tableName: "wa_message_logs",
            underscored: true,
            timestamps: true,
            indexes: [
                { unique: true, fields: ["id_instance", "id_message"] }, // <- dedup
                { fields: ["chat_id"] },
                { fields: ["created_at"] },
            ],
        }
    );

    return WaMessageLog;
};
