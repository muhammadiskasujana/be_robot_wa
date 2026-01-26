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

export { sequelize };
