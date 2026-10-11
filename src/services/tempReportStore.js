import { redis } from "../queues/redis.js";
import { createTemporaryStore } from "./temporaryStore.js";

const store = createTemporaryStore(redis);
export const saveTempFile = store.saveTempFile;
export const getTempFileMeta = store.getTempFileMeta;
