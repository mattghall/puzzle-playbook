import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateImagePath } from "../../games/world-map/js/model.mjs";
import { FACTS_PATH, prepareFacts, SOURCES_PATH } from "./facts.mjs";
import { GEOGRID_PATH, GEOGRID_SOURCES_PATH, prepareAtlas, prepareCapitals } from "../geogrid-atlas/prepare.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCOPES = ["facts", "cities", "images", "atlas", "capitals"];

export function parseArguments(args) {
    const result = {};
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i];
        const value = args[i + 1];
        if (!["--scope", "--country"].includes(key) || !value || value.startsWith("--") || result[key.slice(2)]) {
            throw new Error("Usage: node tools/world-map/update.mjs --scope facts|cities|images|atlas|capitals [--country ISO_A3]");
        }
        result[key.slice(2)] = value;
    }
    if (!SCOPES.includes(result.scope)) throw new Error("--scope must be " + SCOPES.join(", "));
    if (result.country && !/^(?:[A-Z]{3}|X-[A-Z-]+)$/.test(result.country)) throw new Error("Invalid country ID");
    if (["atlas", "capitals"].includes(result.scope) && result.country) throw new Error("Atlas and capital refreshes update all countries together");
    return result;
}

export function assertClean(root, targets, execute = execFileSync) {
    const changes = execute("git", ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching", "--", ...targets], { cwd: root, encoding: "utf8" });
    if (changes) throw new Error("Target snapshots have local edits. Review and commit or restore them before refreshing:\n" + changes.replaceAll("\0", "\n").trim());
}

function validateTarget(file) {
    if (!file.startsWith("games/world-map/") || path.isAbsolute(file) || file.split("/").includes("..")) {
        throw new Error("Unsafe update path: " + file);
    }
}

export async function captureTargets(root, targets) {
    const files = new Map();
    async function capture(file) {
        validateTarget(file);
        const location = path.join(root, file);
        const stat = await lstat(location).catch(error => {
            if (error.code !== "ENOENT") throw error;
            return null;
        });
        if (!stat) return;
        if (stat.isDirectory()) {
            for (const child of (await readdir(location)).sort()) await capture(file + "/" + child);
        } else if (stat.isFile()) files.set(file, await readFile(location));
        else throw new Error("Unsupported snapshot file type: " + file);
    }
    for (const target of targets) await capture(target);
    return { targets: [...targets], files };
}

export async function assertUnchanged(root, baseline) {
    const current = await captureTargets(root, baseline.targets);
    for (const file of new Set([...baseline.files.keys(), ...current.files.keys()])) {
        const before = baseline.files.get(file);
        const after = current.files.get(file);
        if (!before || !after || !before.equals(after)) throw new Error("Target changed while preparing: " + file);
    }
}

export async function captureImageTargets(root) {
    const manifestPath = "games/world-map/data/image-sets.json";
    const initial = await captureTargets(root, [manifestPath]);
    assertClean(root, initial.targets);
    const bytes = initial.files.get(manifestPath);
    if (!bytes) throw new Error("Missing image-set manifest");
    const manifest = JSON.parse(bytes.toString("utf8"));
    if (manifest.version !== 1 || !Array.isArray(manifest.sets) || !manifest.sets.length) throw new Error("Invalid image sets");
    const targets = new Set([manifestPath, "games/world-map/img/flags"]);
    for (const set of manifest.sets) {
        if (!set?.images || typeof set.images !== "object" || Array.isArray(set.images)) throw new Error("Invalid image set");
        for (const image of Object.values(set.images)) targets.add("games/world-map/" + validateImagePath(image?.src));
    }
    const baseline = await captureTargets(root, [...targets]);
    await assertUnchanged(root, initial);
    assertClean(root, baseline.targets);
    await assertUnchanged(root, baseline);
    return baseline;
}

export async function applyTransaction(root, directory, files, { baseline, beforeRename, bootstrap = false } = {}) {
    if (!files.length || new Set(files.map(file => file.path)).size !== files.length) throw new Error("Empty or duplicate update targets");
    for (const file of files) validateTarget(file.path);
    baseline ||= await captureTargets(root, files.map(file => file.path));
    for (const file of files) {
        if (!baseline.targets.some(target => file.path === target || file.path.startsWith(target + "/"))) {
            throw new Error("Update target wasn't captured before preparation: " + file.path);
        }
    }
    if (bootstrap && baseline.files.size) throw new Error("Bootstrap requires absent target snapshots; existing files won't be overwritten");
    assertClean(root, baseline.targets);
    await assertUnchanged(root, baseline);
    const originals = baseline.files;
    const backups = new Map();
    const changed = [];
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const destination = path.join(root, file.path);
        const old = originals.get(file.path) || null;
        const bytes = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content);
        if (old?.equals(bytes)) continue;
        const staged = path.join(directory, "output-" + i);
        await writeFile(staged, bytes);
        if (old) {
            const backup = path.join(directory, "backup-" + i);
            await writeFile(backup, old);
            backups.set(file.path, backup);
        }
        changed.push({ ...file, staged, destination, bytes });
    }
    await writeFile(path.join(directory, "transaction.json"), JSON.stringify(changed.map(file => ({
        path: file.path, backup: backups.has(file.path) ? path.basename(backups.get(file.path)) : null,
    })), null, 2) + "\n");
    assertClean(root, baseline.targets);
    await assertUnchanged(root, baseline);
    const applied = [];
    try {
        for (const file of changed) {
            await mkdir(path.dirname(file.destination), { recursive: true });
            if (beforeRename) await beforeRename(file, applied.length);
            const current = await readFile(file.destination).catch(error => {
                if (error.code !== "ENOENT") throw error;
                return null;
            });
            const old = originals.get(file.path) || null;
            if (Boolean(current) !== Boolean(old) || current && !current.equals(old)) throw new Error("Target changed while preparing: " + file.path);
            await rename(file.staged, file.destination);
            applied.push(file);
        }
    } catch (error) {
        const failures = [];
        for (const file of applied.reverse()) {
            try {
                const current = await readFile(file.destination).catch(error => {
                    if (error.code !== "ENOENT") throw error;
                    return null;
                });
                if (!current?.equals(file.bytes)) throw new Error("Edited after application; preserving the current file");
                const old = originals.get(file.path);
                if (old) await rename(backups.get(file.path), file.destination);
                else await rm(file.destination);
            } catch (rollbackError) {
                failures.push(file.path + ": " + rollbackError.message);
            }
        }
        if (failures.length) {
            const failure = new Error(error.message + "; rollback failed: " + failures.join("; ") + ". Recovery files retained in " + directory);
            failure.recoveryDirectory = directory;
            throw failure;
        }
        throw error;
    }
    return changed.map(file => file.path);
}

export async function update({ root = ROOT, scope, country, bootstrap = false }) {
    if (!SCOPES.includes(scope)) throw new Error("Invalid update scope");
    if (["atlas", "capitals"].includes(scope) && country) throw new Error("Atlas and capital refreshes update all countries together");
    if (bootstrap && (scope !== "facts" || country)) throw new Error("Bootstrap prepares all facts and cities together");
    const directory = path.join(root, ".world-map-stage-" + process.pid);
    await mkdir(directory);
    let preserveStage = false;
    try {
        const targets = ["atlas", "capitals"].includes(scope) ? [GEOGRID_PATH, GEOGRID_SOURCES_PATH] : [FACTS_PATH, SOURCES_PATH];
        const baseline = scope === "images" ? await captureImageTargets(root) : await captureTargets(root, targets);
        if (bootstrap && baseline.files.size) throw new Error("Bootstrap requires absent target snapshots; existing files won't be overwritten");
        assertClean(root, baseline.targets);
        let result;
        if (scope === "atlas") {
            result = await prepareAtlas({ root, directory });
        } else if (scope === "capitals") {
            result = await prepareCapitals({ root, directory });
        } else if (scope === "images") {
            const { refreshImages } = await import("../world-map-images.mjs");
            const images = await refreshImages({ root, stagingDir: directory, countryIds: country ? [country] : [] });
            result = {
                files: await Promise.all(images.files.map(async file => ({ path: file, content: await readFile(path.join(directory, file)) }))),
                summary: Object.entries(images.summary).map(([kind, codes]) => `${kind}: ${codes.length}${codes.length ? " (" + codes.join(", ") + ")" : ""}`),
            };
        } else {
            result = await prepareFacts({ root, directory, scope, country, bootstrap });
        }
        const changed = await applyTransaction(root, directory, result.files, { baseline, bootstrap });
        for (const message of result.summary || []) console.log(message);
        console.log(changed.length ? `Updated ${changed.length} files. Review the diff; nothing was published.` : "No changes.");
        return changed;
    } catch (error) {
        preserveStage = Boolean(error.recoveryDirectory);
        throw error;
    } finally {
        if (!preserveStage) await rm(directory, { recursive: true, force: true });
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        await update(parseArguments(process.argv.slice(2)));
    } catch (error) {
        console.error("World map update failed: " + error.message);
        process.exitCode = 1;
    }
}
