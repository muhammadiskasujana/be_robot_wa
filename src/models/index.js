import Sequelize from "sequelize";
import sequelize from "../config/sequelize.js";

import WaInstanceDef from "./WaInstance.js";
import WaMessageLogDef from "./WaMessageLog.js";
import WaPrivateWhitelistDef from "./WaPrivateWhitelist.js";
import WaMasterDef from "./WaMaster.js";
import WaGroupModeDef from "./WaGroupMode.js";
import WaGroupDef from "./WaGroup.js";
import WaCommandDef from "./WaCommand.js";
import WaCommandModeDef from "./WaCommandMode.js";
import LeasingCompanyDef from "./LeasingCompany.js";
import LeasingBranchDef from "./LeasingBranch.js";
import WaGroupLeasingBranchDef from "./WaGroupLeasingBranch.js";
import AdminUserDef from "./AdminUser.js";
import AdminRefreshTokenDef from "./AdminRefreshToken.js";

// ✅ NEW: credit & policy models
import WaCommandPolicyDef from "./WaCommandPolicy.js";
import WaCreditWalletDef from "./WaCreditWallet.js";
import WaCreditTransactionDef from "./WaCreditTransaction.js";

import PtCompanyDef from "./PtCompany.js";
import WaGroupSubscriptionDef from "./WaGroupSubscription.js";

const { DataTypes } = Sequelize;

// define
export const AdminUser = AdminUserDef(sequelize, DataTypes);
export const AdminRefreshToken = AdminRefreshTokenDef(sequelize, DataTypes);

export const WaInstance = WaInstanceDef(sequelize, DataTypes);
export const WaMessageLog = WaMessageLogDef(sequelize, DataTypes);

export const WaPrivateWhitelist = WaPrivateWhitelistDef(sequelize, DataTypes);
export const WaMaster = WaMasterDef(sequelize, DataTypes);

export const WaGroupMode = WaGroupModeDef(sequelize, DataTypes);
export const WaGroup = WaGroupDef(sequelize, DataTypes);

export const WaCommand = WaCommandDef(sequelize, DataTypes);
export const WaCommandMode = WaCommandModeDef(sequelize, DataTypes);

export const LeasingCompany = LeasingCompanyDef(sequelize, DataTypes);
export const LeasingBranch = LeasingBranchDef(sequelize, DataTypes);

export const WaGroupLeasingBranch = WaGroupLeasingBranchDef(sequelize, DataTypes);

// ✅ NEW
export const WaCommandPolicy = WaCommandPolicyDef(sequelize, DataTypes);
export const WaCreditWallet = WaCreditWalletDef(sequelize, DataTypes);
export const WaCreditTransaction = WaCreditTransactionDef(sequelize, DataTypes);

export const PtCompany = PtCompanyDef(sequelize, DataTypes);
export const WaGroupSubscription = WaGroupSubscriptionDef(sequelize, DataTypes);

AdminUser.hasMany(AdminRefreshToken, { foreignKey: "user_id", as: "refreshTokens" });
AdminRefreshToken.belongsTo(AdminUser, { foreignKey: "user_id", as: "user" });

// associations (yang paling kepake)
LeasingCompany.hasMany(LeasingBranch, { foreignKey: "leasing_id", as: "branches" });
LeasingBranch.belongsTo(LeasingCompany, { foreignKey: "leasing_id", as: "leasing" });

WaGroup.belongsTo(WaGroupMode, { foreignKey: "mode_id", as: "mode" });
WaGroupMode.hasMany(WaGroup, { foreignKey: "mode_id", as: "groups" });

WaGroup.belongsTo(LeasingCompany, { foreignKey: "leasing_id", as: "leasing" });
WaGroup.belongsTo(LeasingBranch, { foreignKey: "leasing_branch_id", as: "leasingBranch" });

WaCommandMode.belongsTo(WaCommand, { foreignKey: "command_id", as: "command" });
WaCommandMode.belongsTo(WaGroupMode, { foreignKey: "mode_id", as: "mode" });

WaGroupLeasingBranch.belongsTo(WaGroup, { foreignKey: "group_id", as: "group" });
WaGroup.hasMany(WaGroupLeasingBranch, { foreignKey: "group_id", as: "leasingLinks" });

WaGroupLeasingBranch.belongsTo(LeasingBranch, { foreignKey: "leasing_branch_id", as: "branch" });
LeasingBranch.hasMany(WaGroupLeasingBranch, { foreignKey: "leasing_branch_id", as: "groupLinks" })

// =====================================================================
// ✅ NEW: CREDIT & POLICY RELATIONSHIPS (sesuai snippet kamu)
// =====================================================================

// 1) GROUP scope: WaGroup has many policies & wallets
WaGroup.hasMany(WaCommandPolicy, { foreignKey: "group_id", as: "command_policies" });
WaCommandPolicy.belongsTo(WaGroup, { foreignKey: "group_id", as: "group" });

WaGroup.hasMany(WaCreditWallet, { foreignKey: "group_id", as: "credit_wallets" });
WaCreditWallet.belongsTo(WaGroup, { foreignKey: "group_id", as: "group" });

// 2) LEASING scope: LeasingCompany has many policies & wallets
LeasingCompany.hasMany(WaCommandPolicy, { foreignKey: "leasing_id", as: "command_policies" });
WaCommandPolicy.belongsTo(LeasingCompany, { foreignKey: "leasing_id", as: "leasing" });

LeasingCompany.hasMany(WaCreditWallet, { foreignKey: "leasing_id", as: "credit_wallets" });
WaCreditWallet.belongsTo(LeasingCompany, { foreignKey: "leasing_id", as: "leasing" });

// 3) WaCommand relationships (policy + tx)
WaCommand.hasMany(WaCommandPolicy, { foreignKey: "command_id", as: "policies" });
WaCommandPolicy.belongsTo(WaCommand, { foreignKey: "command_id", as: "command" });

WaCommand.hasMany(WaCreditTransaction, { foreignKey: "command_id", as: "credit_transactions" });
WaCreditTransaction.belongsTo(WaCommand, { foreignKey: "command_id", as: "command" });

// 4) Wallet -> Transactions
WaCreditWallet.hasMany(WaCreditTransaction, { foreignKey: "wallet_id", as: "transactions" });
WaCreditTransaction.belongsTo(WaCreditWallet, { foreignKey: "wallet_id", as: "wallet" });

// PT
PtCompany.hasMany(WaGroup, { foreignKey: "pt_company_id", as: "groups" });
WaGroup.belongsTo(PtCompany, { foreignKey: "pt_company_id", as: "pt_company" });

// Subscriptions
WaCommand.hasMany(WaGroupSubscription, { foreignKey: "command_id", as: "subscriptions" });
WaGroupSubscription.belongsTo(WaCommand, { foreignKey: "command_id", as: "command" });

WaGroup.hasMany(WaGroupSubscription, { foreignKey: "group_id", as: "subscriptions" });
WaGroupSubscription.belongsTo(WaGroup, { foreignKey: "group_id", as: "group" });

LeasingCompany.hasMany(WaGroupSubscription, { foreignKey: "leasing_id", as: "subscriptions" });
WaGroupSubscription.belongsTo(LeasingCompany, { foreignKey: "leasing_id", as: "leasing" });

PtCompany.hasMany(WaGroupSubscription, { foreignKey: "pt_company_id", as: "subscriptions" });
WaGroupSubscription.belongsTo(PtCompany, { foreignKey: "pt_company_id", as: "pt_company" });

export { sequelize };
