import { getTempLink } from "../services/tempLink/tempLinkService.js";
import { createTempLinksRouter } from "./tempDownloadRouter.js";

export default createTempLinksRouter(getTempLink);
