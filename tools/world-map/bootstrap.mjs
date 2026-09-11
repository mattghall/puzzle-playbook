import { update } from "./update.mjs";

try {
    if (process.argv.length > 2) throw new Error("Usage: node tools/world-map/bootstrap.mjs");
    await update({ scope: "facts", bootstrap: true });
} catch (error) {
    console.error("World map bootstrap failed: " + error.message);
    process.exitCode = 1;
}
