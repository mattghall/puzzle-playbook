import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareFacts } from "./facts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIRECTORY = path.join(ROOT, ".world-map-verify-" + process.pid);
await mkdir(DIRECTORY);
try {
    for (const scope of ["facts", "cities"]) {
        const result = await prepareFacts({ root: ROOT, directory: DIRECTORY, scope, pinned: true });
        for (const file of result.files) {
            if (await readFile(path.join(ROOT, file.path), "utf8") !== file.content) throw new Error("Pinned-source replay differs: " + file.path);
        }
    }
    console.log("Pinned Wikipedia revisions reproduce the bundled facts and manifest exactly.");
} catch (error) {
    console.error("Wikipedia source verification failed: " + error.message);
    process.exitCode = 1;
} finally {
    await rm(DIRECTORY, { recursive: true, force: true });
}
