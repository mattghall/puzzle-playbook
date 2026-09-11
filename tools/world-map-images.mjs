import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateImagePath } from "../games/world-map/js/model.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = "games/world-map/data/image-sets.json";
const CLIENT = "PuzzlePlaybookWorldMap/1.0 (local atlas preparation; https://github.com/mattghall/puzzle-playbook)";
const TITLES = {
    USA: "United States", GBR: "United Kingdom", COD: "Democratic Republic of the Congo", COG: "Republic of the Congo",
    CIV: "Côte d'Ivoire", VAT: "Vatican City", FSM: "Federated States of Micronesia", BHS: "Bahamas",
    GMB: "Gambia", MKD: "North Macedonia", SWZ: "Eswatini", TLS: "East Timor", CZE: "Czech Republic",
    TUR: "Turkey", CPV: "Cape Verde", VCT: "Saint Vincent and the Grenadines", KNA: "Saint Kitts and Nevis",
    STP: "São Tomé and Príncipe", ATF: "French Southern and Antarctic Lands", SGS: "South Georgia and the South Sandwich Islands",
    FLK: "Falkland Islands", MNP: "Northern Mariana Islands", VIR: "United States Virgin Islands",
    VGB: "British Virgin Islands", TCA: "Turks and Caicos Islands", WLF: "Wallis and Futuna",
    BLM: "Saint Barthélemy", MAF: "France", SPM: "Saint Pierre and Miquelon",
    PRK: "North Korea", LAO: "Laos", FRO: "Faroe Islands",
    OMN: "Oman (2-1)",
    SHN: "Saint Helena", PCN: "Pitcairn Islands", IOT: "British Indian Ocean Territory",
    "X-KOSOVO": "Kosovo", "X-SOMALILAND": "Somaliland", "X-NORTHERN-CYPRUS": "Northern Cyprus",
};
const MISSING = {
    ATA: "Antarctica has no national flag.",
    "X-AUSTRALIAN-INDIAN-OCEAN": "Grouped Christmas and Cocos (Keeling) Islands have no single territory flag.",
    "X-ASHMORE-CARTIER": "No separate territory flag bundled.",
    "X-SIACHEN": "Disputed glacier area has no national flag.",
    HMD: "No separate Heard Island and McDonald Islands flag bundled.",
};
const FORMATS = {
    "image/svg+xml": [".svg"],
    "image/png": [".png"],
    "image/jpeg": [".jpg", ".jpeg"],
    "image/webp": [".webp"],
};

function digest(bytes, algorithm = "sha256") {
    return createHash(algorithm).update(bytes).digest("hex");
}

function stripMarkup(value = "") {
    return value.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"")
        .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/\s+/g, " ").trim();
}

function download(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !["commons.wikimedia.org", "upload.wikimedia.org"].includes(parsed.hostname)) {
        throw new Error("Not a Wikimedia Commons source: " + url);
    }
    return execFileSync("curl", ["--fail", "--silent", "--show-error", "--location", "--retry", "3", "--retry-all-errors", "--retry-delay", "10",
        "--max-time", "90", "--user-agent", CLIENT, url], { maxBuffer: 20 * 1024 * 1024 });
}

function queryFiles(titles) {
    const query = new URLSearchParams({
        action: "query", format: "json", titles: titles.join("|"), redirects: "1",
        prop: "imageinfo|revisions", iiprop: "url|extmetadata|sha1|timestamp|mime", rvprop: "ids",
    });
    const result = JSON.parse(download("https://commons.wikimedia.org/w/api.php?" + query));
    if (result.error || !result.query?.pages) throw new Error("Commons API: " + JSON.stringify(result.error || result));
    const pages = Object.values(result.query.pages);
    const aliases = new Map(pages.map(page => [page.title, page]));
    for (const redirect of (result.query.redirects || []).reverse()) aliases.set(redirect.from, aliases.get(redirect.to));
    for (const normal of result.query.normalized || []) aliases.set(normal.from, aliases.get(normal.to));
    return aliases;
}

function getSource(page) {
    const info = page?.imageinfo?.[0];
    if (!info) return null;
    const metadata = info.extmetadata;
    const license = stripMarkup(metadata.LicenseShortName?.value);
    const creator = stripMarkup(metadata.Artist?.value);
    if ((!creator && !["Public domain", "CC0"].includes(license)) || !/^(Public domain|CC0|CC BY(?:-SA)? [\d.]+)$/.test(license)) {
        throw new Error("Unreviewed Commons attribution/license: " + page.title + " (" + license + ")");
    }
    if (license !== "Public domain" && !/^https?:\/\//.test(metadata.LicenseUrl?.value || "")) {
        throw new Error("Commons license URL missing: " + page.title);
    }
    if (!FORMATS[info.mime]) throw new Error("Unsupported Commons image format: " + page.title + " (" + info.mime + ")");
    return {
        url: info.descriptionurl,
        title: page.title,
        pageId: page.pageid,
        creator: creator || "Not specified on Commons",
        creatorHtml: metadata.Artist?.value || "",
        license,
        licenseUrl: metadata.LicenseUrl?.value || "https://commons.wikimedia.org/wiki/Commons:Public_domain",
        revision: String(page.revisions[0].revid),
        uploaded: info.timestamp,
        downloadUrl: info.url.split("?")[0],
        sha1: info.sha1,
        credit: stripMarkup(metadata.Credit?.value),
        restrictions: stripMarkup(metadata.Restrictions?.value),
        attributionRequired: metadata.AttributionRequired?.value === "true",
    };
}

function getAssetPath(src) {
    return "games/world-map/" + validateImagePath(src);
}

export function validateImageBytes(bytes, mime, src) {
    getAssetPath(src);
    if (!FORMATS[mime]?.includes(path.extname(src).toLowerCase())) throw new Error("Image MIME doesn't match destination: " + src);
    if (mime === "image/svg+xml") {
        const svg = bytes.toString("utf8");
        if (!/<svg[\s/>]/.test(svg) || /<script\b|\bon\w+\s*=|(?:href\s*=\s*["'](?!#|data:))|<foreignObject\b/i.test(svg)) {
            throw new Error("Unsafe or invalid Commons SVG: " + src);
        }
    } else if (mime === "image/png") {
        if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Invalid PNG signature: " + src);
    } else if (mime === "image/jpeg") {
        if (!bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) throw new Error("Invalid JPEG signature: " + src);
    } else if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") {
        throw new Error("Invalid WebP signature: " + src);
    }
}

export function getFlagPlacement(id) {
    const result = { fit: "stretch", focalPoint: [0.5, 0.5], scale: 1, offset: [0, 0], background: "#ffffff" };
    if (id === "NPL") {
        result.fit = "contain";
        result.rotation = -60;
        result.scale = 1.25;
        result.offset = [0, -0.28];
    }
    if (["USA", "FRA", "RUS", "FJI", "NZL"].includes(id)) {
        result.regions = { 1: { fit: "stretch", focalPoint: [0.5, 0.5] }, 2: { fit: "stretch", focalPoint: [0.5, 0.5] } };
    }
    return result;
}

export async function refreshImages({ root = ROOT, stagingDir, countryIds = [], bootstrap = false } = {}) {
    if (!stagingDir || path.resolve(stagingDir) === path.resolve(root)) throw new Error("A separate stagingDir is required.");
    const target = path.resolve(stagingDir);
    const world = JSON.parse(await readFile(path.join(root, "games/world-map/data/world.json"), "utf8"));
    const previousText = await readFile(path.join(root, MANIFEST), "utf8").catch(error => {
        if (error.code !== "ENOENT" || !bootstrap) throw error;
        return null;
    });
    const manifest = previousText ? JSON.parse(previousText) : {
        version: 1,
        sets: [{ id: "flags", title: "Flags", description: "National and territory flags from Wikimedia Commons.", images: {}, missing: {} }],
    };
    if (manifest.version !== 1 || !Array.isArray(manifest.sets) || !manifest.sets.length) throw new Error("Invalid image sets.");
    const knownIds = new Set(world.objects.countries.geometries.map(country => country.properties.id));
    const countries = world.objects.countries.geometries.filter(country => !countryIds.length || countryIds.includes(country.properties.id));
    if (countryIds.some(id => !countries.some(country => country.properties.id === id))) throw new Error("Unknown country selection.");
    const setIds = new Set();
    for (const set of manifest.sets) {
        if (!/^[a-z][a-z0-9-]*$/.test(set.id) || setIds.has(set.id) || !set.images || typeof set.images !== "object" || Array.isArray(set.images)) {
            throw new Error("Invalid image set: " + set.id);
        }
        setIds.add(set.id);
        for (const [id, image] of Object.entries(set.images)) {
            if (!knownIds.has(id)) throw new Error("Unknown image country: " + set.id + ":" + id);
            getAssetPath(image.src);
            if (typeof image.source?.title !== "string" || !/^File:[^|#\r\n]+$/.test(image.source.title)) {
                throw new Error("Commons File title required: " + set.id + ":" + id);
            }
        }
    }
    const files = new Map();
    const summary = { added: [], changed: [], removed: [], unresolved: [], licenseChanged: [] };
    for (const set of manifest.sets) {
        const flags = set.id === "flags";
        if (flags) set.missing ||= {};
        const selected = countries.filter(country => flags || Object.hasOwn(set.images, country.properties.id));
        for (let index = 0; index < selected.length; index += 15) {
            const batch = selected.slice(index, index + 15);
            const titles = new Map();
            for (const country of batch) {
                const { id, name } = country.properties;
                const old = set.images[id];
                if (flags && MISSING[id] && !old) continue;
                const label = TITLES[id] || name;
                titles.set(id, old ? [old.source.title] :
                    ["File:Flag of " + label + ".svg", "File:Flag of the " + label + ".svg"]);
            }
            const pages = titles.size ? queryFiles([...new Set([...titles.values()].flat())]) : new Map();
            for (const country of batch) {
                const { id, name } = country.properties;
                const key = flags ? id : set.id + ":" + id;
                const old = set.images[id];
                if (flags && MISSING[id] && !old) {
                    set.missing[id] = MISSING[id];
                    continue;
                }
                const page = titles.get(id).map(title => pages.get(title)).find(page => page?.imageinfo);
                if (!page) {
                    if (old) throw new Error("Previously bundled image disappeared: " + key);
                    set.missing[id] = "No verified Commons flag asset bundled.";
                    summary.unresolved.push(key);
                    continue;
                }
                let source;
                try {
                    source = getSource(page);
                } catch (error) {
                    if (old || (!bootstrap && !set.missing[id])) throw error;
                    set.missing[id] = error.message;
                    summary.unresolved.push(key);
                    continue;
                }
                const src = old?.src || "img/flags/" + id.toLowerCase() + ".svg";
                const assetPath = getAssetPath(src);
                const mime = page.imageinfo[0].mime;
                let bytes;
                if (old?.source.sha1 === source.sha1) {
                    bytes = await readFile(path.join(root, assetPath));
                    if (digest(bytes) !== old.source.sha256) throw new Error("Local image checksum mismatch: " + key);
                } else {
                    bytes = await readFile(path.join(target, assetPath)).catch(error => {
                        if (error.code !== "ENOENT") throw error;
                        return null;
                    });
                    if (!bytes || digest(bytes, "sha1") !== source.sha1) {
                        await new Promise(resolve => setTimeout(resolve, 1500));
                        bytes = download(source.downloadUrl);
                    }
                }
                if (digest(bytes, "sha1") !== source.sha1) throw new Error("Commons image changed during download: " + key);
                validateImageBytes(bytes, mime, src);
                source.sha256 = digest(bytes);
                if (old?.source.note) source.note = old.source.note;
                if (flags && id === "OMN" && !source.note) {
                    source.note = "Separate 2:1 rendition by FDRMRZUSA, marked PD-flag on Commons. Not the principal Flag of Oman.svg file licensed OGL-om 1.0. Insignia restrictions still apply.";
                }
                source.retrieved = old?.source.sha1 === source.sha1 && old?.source.revision === source.revision && old.source.retrieved ?
                    old.source.retrieved : new Date().toISOString().slice(0, 10);
                const image = old ? { ...old, source } : { src, label: "Flag of " + name, source, placement: getFlagPlacement(id) };
                set.images[id] = image;
                if (set.missing) delete set.missing[id];
                if (!old) summary.added.push(key);
                else if (JSON.stringify(old) !== JSON.stringify(image)) summary.changed.push(key);
                if (old?.source.license && old.source.license !== source.license) summary.licenseChanged.push(key);
                if (files.has(assetPath) && files.get(assetPath) !== source.sha256) throw new Error("Conflicting shared image destination: " + assetPath);
                await mkdir(path.dirname(path.join(target, assetPath)), { recursive: true });
                await writeFile(path.join(target, assetPath), bytes);
                files.set(assetPath, source.sha256);
            }
            console.log("Commons " + set.id + ": " + Math.min(index + 15, selected.length) + "/" + selected.length);
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        set.images = Object.fromEntries(Object.entries(set.images).sort(([a], [b]) => a.localeCompare(b)));
        if (set.missing) {
            set.missing = Object.fromEntries(Object.entries(set.missing).sort(([a], [b]) => a.localeCompare(b)));
        }
    }
    for (const set of manifest.sets) {
        for (const image of Object.values(set.images)) {
            const checksum = files.get(getAssetPath(image.src));
            if (checksum && checksum !== image.source.sha256) throw new Error("Shared image changed outside country selection: " + image.src);
        }
    }
    await mkdir(path.dirname(path.join(target, MANIFEST)), { recursive: true });
    await writeFile(path.join(target, MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
    return { files: [...files.keys(), MANIFEST], summary };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const stagingDir = process.argv[2];
    if (!stagingDir) throw new Error("Usage: node tools/world-map-images.mjs <staging-directory> [--bootstrap]");
    console.log(await refreshImages({ stagingDir, bootstrap: process.argv.includes("--bootstrap") }));
}
