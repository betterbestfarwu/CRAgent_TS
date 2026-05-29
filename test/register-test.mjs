import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
register(path.join(testDir, "resolve-alias.mjs"), pathToFileURL("./"));
