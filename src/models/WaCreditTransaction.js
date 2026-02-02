export default (sequelize, DataTypes) =>
    sequelize.define(
        "WaCreditTransaction",
        {
            id: { type: DataTypes.UUID, primaryKey: true, defaultValue: sequelize.literal("gen_random_uuid()") },

            wallet_id: { type: DataTypes.UUID, allowNull: false },

            tx_type: { type: DataTypes.STRING(10), allowNull: false }, // DEBIT | CREDIT
            amount: { type: DataTypes.INTEGER, allowNull: false },

            balance_before: { type: DataTypes.INTEGER, allowNull: false },
            balance_after: { type: DataTypes.INTEGER, allowNull: false },

            command_id: { type: DataTypes.UUID, allowNull: true },

            group_id: { type: DataTypes.UUID, allowNull: true },
            leasing_id: { type: DataTypes.UUID, allowNull: true },

            ref_type: { type: DataTypes.STRING(32), allowNull: true },
            ref_id: { type: DataTypes.STRING(120), allowNull: true },
            notes: { type: DataTypes.STRING(255), allowNull: true },
        },
        {
            tableName: "wa_credit_transactions",
            underscored: true,
            timestamps: true,
            indexes: [
                { fields: ["wallet_id", "created_at"], name: "ix_wa_tx_wallet_time" },
                { fields: ["command_id"], name: "ix_wa_tx_command" },
                { fields: ["group_id"], name: "ix_wa_tx_group" },
                { fields: ["leasing_id"], name: "ix_wa_tx_leasing" },
                { fields: ["ref_type", "ref_id"], name: "ix_wa_tx_ref" },
            ],
            hooks: {
                beforeValidate: (row) => {
                    if (row.tx_type) row.tx_type = String(row.tx_type).trim().toUpperCase();
                    if (row.amount !== undefined && row.amount !== null) row.amount = Math.max(1, Number(row.amount || 1));
                    if (row.balance_before !== undefined && row.balance_before !== null)
                        row.balance_before = Math.max(0, Number(row.balance_before || 0));
                    if (row.balance_after !== undefined && row.balance_after !== null)
                        row.balance_after = Math.max(0, Number(row.balance_after || 0));
                },
            },
        }
    );
