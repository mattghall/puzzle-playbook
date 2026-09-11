import { getAtlasChoice } from "./atlas.mjs";
import { getFilterParams } from "./filter-params.mjs";

const DISPLAY_MODES = {
    natural: "natural", white: "blank", neighbors: "neighbors",
    images: "imagery", criteria: "criteria", timezones: "timezones",
};
const SETTINGS_KEYS = ["display", "view", "images", "timezone", "capitals", "largest", "cities", "match", "filter", "exclude"];

export function readSettings(url, atlas, imageSets, timeZones) {
    const params = new URL(url).searchParams;
    const warnings = [];
    const filters = getFilterParams(atlas);
    function readOption(key, values, fallback) {
        if (!params.has(key)) return fallback;
        const value = params.get(key);
        if (params.getAll(key).length === 1 && values.includes(value)) return value;
        warnings.push("Ignored invalid " + key + " setting.");
        return fallback;
    }
    const conditions = new Map();
    for (const [parameter, key] of params) {
        if (filters.byParameter.has(parameter)) {
            const condition = filters.byParameter.get(parameter).get(key);
            if (condition) conditions.set(condition.key, condition.exclude);
            else warnings.push("Ignored an unavailable filter: " + parameter + "=" + key);
            continue;
        }
        if (!["filter", "exclude"].includes(parameter)) continue;
        if (!getAtlasChoice(atlas, key)) {
            warnings.push("Ignored an unavailable filter: " + key);
            continue;
        }
        conditions.set(key, parameter === "exclude");
    }
    return {
        mode: DISPLAY_MODES[readOption("display", Object.keys(DISPLAY_MODES), "natural")],
        projection: readOption("view", ["globe", "map"], "globe") === "map" ? "flat" : "globe",
        imageSet: readOption("images", imageSets.map(set => set.id), imageSets[0].id),
        timeZone: readOption("timezone", timeZones, ""),
        overlays: {
            capitals: readOption("capitals", ["0", "1"], "0") === "1",
            largest: readOption("largest", ["0", "1"], "0") === "1",
            count: Number(readOption("cities", Array.from({ length: 10 }, (_, index) => String(index + 1)), "1")),
        },
        matchMode: readOption("match", ["all", "any"], "all"),
        conditions: [...conditions].map(([key, exclude]) => ({ key, exclude })),
        warnings,
    };
}

export function writeSettings(url, settings, defaultImageSet, atlas) {
    const result = new URL(url);
    const filters = getFilterParams(atlas);
    for (const key of [...SETTINGS_KEYS, ...filters.byParameter.keys()]) result.searchParams.delete(key);
    const params = result.searchParams;
    if (settings.mode !== "natural") params.set("display", Object.keys(DISPLAY_MODES).find(key => DISPLAY_MODES[key] === settings.mode));
    if (settings.projection !== "globe") params.set("view", "map");
    if (settings.imageSet !== defaultImageSet) params.set("images", settings.imageSet);
    if (settings.timeZone) params.set("timezone", settings.timeZone);
    if (settings.overlays.capitals) params.set("capitals", "1");
    if (settings.overlays.largest) params.set("largest", "1");
    if (settings.overlays.count !== 1) params.set("cities", String(settings.overlays.count));
    if (settings.matchMode !== "all") params.set("match", settings.matchMode);
    for (const condition of settings.conditions) {
        const parameter = filters.byKey.get(condition.key);
        if (!parameter) throw new Error("Unavailable filter: " + condition.key);
        params.append((condition.exclude ? "not-" : "") + parameter.name, parameter.value);
    }
    return result.href;
}
