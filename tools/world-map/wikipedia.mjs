import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export function hash(value) {
    return createHash("sha256").update(value).digest("hex");
}

export function splitFields(text) {
    const fields = [];
    let start = 0;
    let templates = 0;
    let links = 0;
    for (let i = 0; i < text.length; i++) {
        const pair = text.slice(i, i + 2);
        if (pair === "{{") { templates++; i++; }
        else if (pair === "}}") { templates--; i++; }
        else if (pair === "[[") { links++; i++; }
        else if (pair === "]]") { links--; i++; }
        else if (text[i] === "|" && !templates && !links) {
            fields.push(text.slice(start, i).trim());
            start = i + 1;
        }
        if (templates < 0 || links < 0) throw new Error("Unbalanced Wikipedia markup");
    }
    if (templates || links) throw new Error("Unbalanced Wikipedia markup");
    fields.push(text.slice(start).trim());
    return fields;
}

export function templates(text, name) {
    const result = [];
    const pattern = /\{\{([^{}|]+)/g;
    let match;
    while ((match = pattern.exec(text))) {
        if (name && match[1].trim().toLowerCase() !== name.toLowerCase()) continue;
        let depth = 1;
        let end = match.index + 2;
        for (; end < text.length && depth; end++) {
            const pair = text.slice(end, end + 2);
            if (pair === "{{") { depth++; end++; }
            else if (pair === "}}") { depth--; end++; }
        }
        if (depth) throw new Error("Unclosed Wikipedia template: " + match[1]);
        const raw = text.slice(match.index, end);
        result.push({ raw, fields: splitFields(raw.slice(2, -2)) });
    }
    return result;
}

export function oneTemplate(text, name) {
    const found = templates(text, name);
    if (found.length !== 1) throw new Error(`Expected one ${name} template, found ${found.length}`);
    return found[0].fields;
}

export function infobox(text, name) {
    const fields = oneTemplate(text.replace(/<!--[\s\S]*?-->/g, ""), name);
    return Object.fromEntries(fields.slice(1).filter(Boolean).map(field => {
        const index = field.indexOf("=");
        if (index < 0) throw new Error("Unexpected infobox field");
        return [field.slice(0, index).trim(), field.slice(index + 1).trim()];
    }));
}

export function plain(text) {
    return text.replace(/<ref\b[^>]*>[\s\S]*?<\/ref>|<ref\b[^>]*\/>/gi, "")
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]]+)\]\]/g, "$1")
        .replace(/<[^>]*>/g, " ").replace(/'{2,}/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

export function number(text) {
    const value = text.trim();
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value)) throw new Error("Unexpected numeric value: " + value);
    const result = Number(value.replaceAll(",", ""));
    if (!Number.isSafeInteger(result) || result < 0) throw new Error("Invalid population: " + value);
    return result;
}

export function coordinates(text) {
    const matches = [...templates(text, "coord"), ...templates(text, "coordinates")];
    if (matches.length !== 1) throw new Error("Expected one explicit coordinate template");
    const fields = matches[0].fields.slice(1).filter(field => !field.includes("="));
    const north = fields.findIndex(field => /^[NS]$/.test(field));
    const east = fields.findIndex(field => /^[EW]$/.test(field));
    function parseDegrees(parts) {
        if (parts.length < 1 || parts.length > 3 || parts.some(part => !/^\d+(\.\d+)?$/.test(part))) {
            throw new Error("Unexpected coordinate definition");
        }
        return parts.reduce((value, part, index) => value + Number(part) / 60 ** index, 0);
    }
    let latitude;
    let longitude;
    if (north >= 0 && east > north) {
        latitude = parseDegrees(fields.slice(0, north)) * (fields[north] === "S" ? -1 : 1);
        longitude = parseDegrees(fields.slice(north + 1, east)) * (fields[east] === "W" ? -1 : 1);
    } else if (/^-?\d+(\.\d+)?$/.test(fields[0]) && /^-?\d+(\.\d+)?$/.test(fields[1])) {
        latitude = Number(fields[0]);
        longitude = Number(fields[1]);
    } else throw new Error("Unsupported coordinates");
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error("Coordinates out of range");
    return { latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6)) };
}

export function requireText(text, values, title) {
    for (const value of values) {
        if (!text.includes(value)) throw new Error(`${title}: source definition/layout changed; missing ${value}`);
    }
}

export function rows(text) {
    return text.split(/\n\|-[^\n]*\n/);
}

export function source(page, section) {
    return { title: page.title, url: `https://en.wikipedia.org/w/index.php?oldid=${page.revision}`, revision: page.revision, section };
}

export async function downloadPage(title, directory, { pinned, cacheOnly = false } = {}) {
    const file = path.join(directory, title.replaceAll(" ", "_").replaceAll("/", "_") + (pinned ? "@" + pinned : "") + ".json");
    let data;
    try {
        data = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
        if (error.code !== "ENOENT" || cacheOnly) throw error;
        const query = new URLSearchParams({
            action: "query", prop: "revisions", rvprop: "ids|content", rvslots: "main", format: "json",
            ...(pinned ? { revids: String(pinned) } : { titles: title }),
        });
        const bytes = execFileSync("curl", [
            "--fail", "--silent", "--show-error", "--retry", "2", "--max-time", "60",
            "--user-agent", "PuzzlePlaybook/1.0 (local Wikipedia snapshot preparation; https://github.com/mattghall/puzzle-playbook)",
            "https://en.wikipedia.org/w/api.php?" + query,
        ], { maxBuffer: 20 * 1024 * 1024 });
        data = JSON.parse(bytes);
        await writeFile(file, bytes);
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    const pages = Object.values(data.query?.pages || {});
    const page = pages[0];
    const revision = page?.revisions?.[0];
    const text = revision?.slots?.main?.["*"];
    if (pages.length !== 1 || page.title !== title || !Number.isInteger(revision?.revid) || !text || /^\s*#redirect/i.test(text)) {
        throw new Error(title + ": missing page, redirect, or invalid revision");
    }
    if (pinned && pinned !== revision.revid) throw new Error(title + ": revision mismatch");
    if (!pinned) {
        const archived = path.join(directory, title.replaceAll(" ", "_").replaceAll("/", "_") + "@" + revision.revid + ".json");
        await writeFile(archived, JSON.stringify(data));
    }
    return { title, pageId: page.pageid, revision: revision.revid, text, sha256: hash(text) };
}
