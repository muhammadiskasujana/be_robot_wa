
export default function (sequelize, DataTypes) {
  const WaGroupFeature = sequelize.define(
    'WaGroupFeature',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      group_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'wa_groups', key: 'id' },
        onDelete: 'CASCADE',
      },
      feature_key: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: 'cek_nopol, delete_nopol, input_data, history, dll',
      },
      is_enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false,
        comment: 'true=aktif, false=nonaktif',
      },
      message_mode: {
        type: DataTypes.ENUM('SILENT', 'DEFAULT', 'CUSTOM'),
        defaultValue: 'DEFAULT',
        allowNull: false,
        comment: 'SILENT=diam, DEFAULT=pesan default sistem, CUSTOM=pesan custom',
      },
      disabled_message: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Pesan custom ketika fitur nonaktif (jika message_mode=CUSTOM)',
      },
      meta: {
        type: DataTypes.JSONB,
        defaultValue: {},
        allowNull: true,
        comment: 'Field fleksibel untuk data tambahan',
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
      tableName: 'wa_group_features',
      timestamps: false,
      underscored: true,
      indexes: [
        { fields: ['group_id', 'feature_key'], unique: true },
        { fields: ['group_id', 'is_enabled'] },
      ],
    }
  );

  return WaGroupFeature;
}