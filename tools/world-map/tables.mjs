import { number, plain, rows, splitFields } from "./wikipedia.mjs";

export function cells(row) {
    const values = [];
    let start = row.startsWith("|") || row.startsWith("!") ? 1 : 0;
    let braces = 0;
    let links = 0;
    for (let i = start; i < row.length; i++) {
        const pair = row.slice(i, i + 2);
        if (pair === "{{") { braces++; i++; }
        else if (pair === "}}") { braces--; i++; }
        else if (pair === "[[") { links++; i++; }
        else if (pair === "]]") { links--; i++; }
        else if (!braces && !links && (pair === "||" || pair === "!!" || pair === "\n|" || pair === "\n!")) {
            values.push(row.slice(start, i).trim());
            start = i + 2;
            i++;
        }
    }
    if (braces || links) throw new Error("Unbalanced table cell");
    values.push(row.slice(start).trim());
    return values;
}

export function cellText(cell) {
    const fields = splitFields(cell);
    return plain(fields.length > 1 && /=/.test(fields[0]) ? fields.slice(1).join("|") : cell);
}

export function cellNumber(cell) {
    const text = cellText(cell).replace(/\{\{formatnum:([\d,]+)\}\}/g, "$1");
    return number(text);
}

export function articleLink(cell) {
    for (const match of cell.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) {
        if (/^(?:File|Image|Category):/i.test(match[1])) continue;
        return { title: match[1], name: plain(match[2] || match[1]) };
    }
    return null;
}

export function tableBody(text, marker) {
    const parts = text.split(marker);
    if (parts.length !== 2) throw new Error("Expected one table marker: " + marker);
    const end = parts[1].indexOf("\n|}");
    if (end < 0) throw new Error("Table closing delimiter missing");
    return parts[1].slice(0, end);
}

function buildYearPattern(text) {
    return text.split("{year}").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("((?:19|20)\\d{2})");
}

function parseSingleYear(text, title) {
    const years = text.match(/\b(?:19|20)\d{2}\b/g) || [];
    if (years.length !== 1) throw new Error(title + ": missing or ambiguous population year");
    return years[0];
}

export function rankingYear(table, config, context, title) {
    const groups = rows(table).filter(row => row.trim().startsWith("!")).map(row => cells(row.trim()).map(cellText));
    const expectedGroups = [config.headers, ...(config.subheaders ? [config.subheaders] : [])];
    if (groups.length !== expectedGroups.length || groups.some((headers, group) =>
        headers.length !== expectedGroups[group].length || headers.some((header, index) =>
            !new RegExp("^" + buildYearPattern(expectedGroups[group][index]) + "$").test(header)))) {
        throw new Error(title + ": population column layout changed or ambiguous");
    }
    const headers = groups[0];
    const populationColumn = config.populationHeading ?? config.populationColumn;
    let year;
    if (config.yearDeclaration) {
        const declarations = [...context.matchAll(new RegExp(buildYearPattern(config.yearDeclaration), "g"))];
        if (declarations.length !== 1) throw new Error(title + ": missing or ambiguous population year declaration");
        year = parseSingleYear(declarations[0][0], title);
    } else {
        if (headers.filter(header => header === headers[populationColumn]).length !== 1) {
            throw new Error(title + ": ambiguous population heading");
        }
        year = parseSingleYear(headers[populationColumn], title);
    }
    for (const column of config.matchingYearColumns || []) {
        if (parseSingleYear(headers[column], title) !== year) throw new Error(title + ": ranking and population years disagree");
    }
    for (const column of config.previousPopulationColumns || []) {
        if (Number(parseSingleYear(headers[column], title)) > Number(year)) throw new Error(title + ": population column order changed");
    }
    return year;
}

export function rankingNote(config, year) {
    return config.note.replaceAll("{year}", year);
}
