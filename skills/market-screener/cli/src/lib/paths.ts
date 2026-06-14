import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const DEFAULT_FIXTURES_DIR = path.join(CLI_ROOT, "test", "fixtures");
export const DEFAULT_CACHE_DIR = path.join(CLI_ROOT, "data", "cache");
export const DEFAULT_SPEC_DIR = path.join(CLI_ROOT, "..", "spec");
