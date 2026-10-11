import { redis } from "../../queues/redis.js";
import { createTemporaryStore } from "../temporaryStore.js";

const store = createTemporaryStore(redis);
export const createTempLink = store.createTempLink;
export const getTempLink = store.getTempLink;
