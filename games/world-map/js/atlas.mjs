import { getCountryId } from "./model.mjs";
import { presentChoice } from "./category-groups.mjs";
import { createNumericRanges, validateNumericCountry } from "./numeric-ranges.mjs";

export function createAtlas(snapshot, countries) {
    if (snapshot?.version !== 1 || !snapshot.countries || !snapshot.mapping ||
        !Array.isArray(snapshot.choices) || !snapshot.choices.length || !Array.isArray(snapshot.colors)) {
        throw new Error("Invalid GeoGrid atlas");
    }
    const sourceCodes = new Set(Object.keys(snapshot.countries));
    const colors = new Map();
    const variants = new Set();
    for (const color of snapshot.colors) {
        if (typeof color.value !== "string" || typeof color.label !== "string" ||
            !Number.isInteger(color.variantId) || colors.has(color.value) || variants.has(color.variantId)) {
            throw new Error("Invalid GeoGrid color variants");
        }
        colors.set(color.value, color.label);
        variants.add(color.variantId);
    }
    for (const [code, country] of Object.entries(snapshot.countries)) {
        validateNumericCountry(country);
        if (!country.name || country.code?.toLowerCase() !== code ||
            country.flagColors !== null && (!Array.isArray(country.flagColors) || country.flagColors.some(color => !colors.has(color)))) {
            throw new Error("Invalid GeoGrid country: " + code);
        }
    }
    const choices = new Map();
    const identities = new Set();
    for (const choice of snapshot.choices) {
        const identity = choice.id + ":" + choice.variantId;
        if (!choice.key || !choice.label || !choice.section || !choice.category ||
            choices.has(choice.key) || identities.has(identity) ||
            !(choice.variantId === null || Number.isInteger(choice.variantId)) ||
            !Array.isArray(choice.matches) || !Array.isArray(choice.unknown)) {
            throw new Error("Invalid GeoGrid category: " + choice.key);
        }
        const matches = new Set(choice.matches);
        const unknown = new Set(choice.unknown);
        if (matches.size !== choice.matches.length || unknown.size !== choice.unknown.length ||
            [...matches, ...unknown].some(code => !sourceCodes.has(code)) || [...unknown].some(code => matches.has(code))) {
            throw new Error("Invalid GeoGrid membership: " + choice.key);
        }
        choices.set(choice.key, { ...choice, matches, unknown });
        identities.add(identity);
    }
    const mapping = new Map();
    const mapped = new Set();
    for (const country of countries) {
        const id = getCountryId(country);
        if (!Object.hasOwn(snapshot.mapping, id)) throw new Error("Missing GeoGrid mapping: " + id);
        const code = snapshot.mapping[id];
        if (code !== null && !sourceCodes.has(code)) throw new Error("Invalid GeoGrid mapping: " + id);
        mapping.set(id, code);
        if (code) mapped.add(code);
    }
    const records = [...countries];
    for (const [code, country] of Object.entries(snapshot.countries)) {
        if (mapped.has(code)) continue;
        const id = "geogrid:" + code;
        mapping.set(id, code);
        records.push({ type: "Feature", id, properties: { id, name: country.name, location: country.location ?? null }, geometry: null });
    }
    return { snapshot, choices, mapping, records, colors, ...createNumericRanges(snapshot, choices) };
}

export function getAtlasChoice(atlas, key) {
    return atlas.choices.get(key) || atlas.rangeChoices?.get(key);
}

export function compileAtlasQuery(atlas, conditions, mode = "all") {
    if (!["all", "any"].includes(mode)) throw new Error("Invalid category combination");
    const selected = conditions.map(condition => {
        const choice = getAtlasChoice(atlas, condition.key);
        if (!choice || typeof condition.exclude !== "boolean") throw new Error("Invalid selected category: " + condition.key);
        return { choice, exclude: condition.exclude };
    });
    return code => {
        if (!code || !Object.hasOwn(atlas.snapshot.countries, code)) return "outside";
        if (!selected.length) return "match";
        let unknown = false;
        for (const { choice, exclude } of selected) {
            if (choice.unknown.has(code)) {
                unknown = true;
                continue;
            }
            const matches = choice.matches.has(code) !== exclude;
            if (mode === "all" && !matches) return "nonmatch";
            if (mode === "any" && matches) return "match";
        }
        if (unknown) return "unknown";
        return mode === "all" ? "match" : "nonmatch";
    };
}

export function matchAtlasCountry(atlas, id, conditions, mode = "all") {
    if (!atlas.mapping.has(id)) throw new Error("Unknown map country: " + id);
    return compileAtlasQuery(atlas, conditions, mode)(atlas.mapping.get(id));
}

export function filterChoices(atlas, query, section = "") {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return [...atlas.choices.values()].filter(choice => {
        const display = presentChoice(choice);
        const text = [choice.label, choice.category, choice.section, choice.id, display.section, display.group, display.label, display.fullLabel].join(" ").toLowerCase();
        return (!section || (display.section || choice.section) === section) && words.every(word => text.includes(word));
    });
}
