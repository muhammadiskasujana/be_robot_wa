import { getTempFileMeta } from "../services/tempReportStore.js";
import { createTempReportsRouter } from "./tempDownloadRouter.js";

export default createTempReportsRouter(getTempFileMeta);
