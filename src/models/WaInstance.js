export default (sequelize, DataTypes) => {
    const WaInstance = sequelize.define(
        "WaInstance",
        {
            id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
            id_instance: { type: DataTypes.BIGINT, allowNull: false, unique: true },
            api_token: { type: DataTypes.STRING(255), allowNull: false },
            name: { type: DataTypes.STRING(100), allowNull: true },
            is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
            meta: { type: DataTypes.JSONB, allowNull: true },
        },
        {
            tableName: "wa_instances",
            underscored: true,
            timestamps: true,
        }
    );

    return WaInstance;
};
