const PAIRED_METRICS = [
    ["coastline_length", "geogrid.geographyInfo.coastlineLength", "km"],
    ["elevation", "geogrid.geographyInfo.averageElevation", "m"],
    ["temp", "geogrid.geographyInfo.averageTemperature", "°C"],
    ["rainfall", "geogrid.geographyInfo.annualRainfall", "mm"],
    ["land_border_length", "geogrid.geographyInfo.landBorderLength", "km"],
    ["hdi", "geogrid.economicInfo.HDI", "HDI"],
    ["gdp_per_capita", "geogrid.economicInfo.GDPPerCapita", "USD per capita"],
    ["cpi", "geogrid.politicalInfo.CPI", "CPI points"],
    ["olympic_medals", "geogrid.sportsInfo.olympicMedals", "Olympic medals"],
    ["air_pollution", "geogrid.factsInfo.airPollution", "μg/m³"],
    ["co2_emissions_per_capita", "geogrid.factsInfo.co2Emissions", "t per capita"],
    ["population", "common.population", "people"],
    ["size", "common.size", "km²"],
];

export const NUMERIC_METRICS = [
    ...PAIRED_METRICS.map(([key, path, unit]) => ({ key, path, unit, sourceIds: [key + "_over_x", key + "_under_x", ...(key === "olympic_medals" ? ["no_olympic_medals"] : [])] })),
    ...[
        ["forest_cover", "geogrid.geographyInfo.forestCover", "%", "forest_cover_over_x"],
        ["arable_land", "geogrid.geographyInfo.arableLand", "%", "arable_land_under_x"],
        ["protected_waters", "geogrid.geographyInfo.protectedWaters", "%", "protected_waters_under_x"],
        ["living_languages", "geogrid.politicalInfo.livingLanguages", "languages", "over_x_living_langs"],
        ["urban_population", "geogrid.politicalInfo.urbanPopulation", "%", "urban_pop_over_x"],
        ["largest_city_urban_population", "geogrid.politicalInfo.largestCityUrbanPopulation", "%", "largest_city_x_urban_pop"],
    ].map(([key, path, unit, id]) => ({ key, path, unit, sourceIds: [id] })),
    { key: "capital_population", path: null, unit: "people", sourceIds: ["capital_population_over_x", "captial_population_under_x"] },
    { key: "border_count", path: "common.borders / common.borderMode / geogrid.geographyInfo.borderCountOverride", unit: "borders", sourceIds: ["borders_x_to_y", "borders_x_or_more"] },
    { key: "flag_color_count", path: "geogrid.flagInfo.colorsOnFlag", unit: "flag colors", sourceIds: ["flag_has_x_colors", "flag_has_x_or_more_colors"] },
];

export function validateNumericValue(metric, value) {
    if (value === null) return;
    if (!Number.isFinite(value) ||
        !["temp", "elevation"].includes(metric.key) && value < 0 ||
        metric.unit === "%" && value > 100 ||
        metric.key === "hdi" && value > 1 ||
        ["border_count", "flag_color_count", "living_languages", "olympic_medals", "population", "capital_population"].includes(metric.key) && !Number.isInteger(value) ||
        metric.key === "capital_population") {
        throw new Error("Invalid GeoGrid numeric value: " + metric.key);
    }
}

export function validateTimeZones(value) {
    if (value === null) return;
    if (!Array.isArray(value) || value.some(zone => typeof zone !== "string" || !zone.trim()) || new Set(value).size !== value.length) {
        throw new Error("Invalid GeoGrid time zones");
    }
}

export function validateNumericCountry(country) {
    if (Object.hasOwn(country, "timeZones")) validateTimeZones(country.timeZones);
    if (!Object.hasOwn(country, "numericValues")) return;
    if (!country.numericValues || typeof country.numericValues !== "object" || Array.isArray(country.numericValues) ||
        Object.keys(country.numericValues).length !== NUMERIC_METRICS.length ||
        country.landlocked !== null && typeof country.landlocked !== "boolean") {
        throw new Error("Invalid GeoGrid numeric country: " + country.code);
    }
    for (const metric of NUMERIC_METRICS) validateNumericValue(metric, country.numericValues[metric.key]);
}

function formatValue(value, unit) {
    const magnitude = Math.abs(value);
    const scale = magnitude >= 1e9 ? 1e9 : magnitude >= 1e6 ? 1e6 : magnitude >= 1e3 ? 1e3 : 1;
    const suffix = scale === 1e9 ? "B" : scale === 1e6 ? "M" : scale === 1e3 ? "K" : "";
    const number = String(value / scale) + suffix;
    return number + (unit === "%" ? "" : " ") + unit;
}

function getStops(metric, originals, countries) {
    const stops = new Set([0, ...originals.map(choice => choice.value).filter(Number.isFinite)]);
    const known = countries.map(country => country.numericValues[metric.key]).filter(value => value !== null);
    if (metric.key === "border_count") {
        const max = Math.max(0, ...known);
        for (let value = 0; value <= max; value++) stops.add(value);
    }
    if (metric.key === "flag_color_count") {
        for (const choice of originals) stops.add(choice.id === "flag_has_x_colors" ? choice.variantId + 2 : 5);
    }
    const minimum = Math.min(0, ...known);
    if (minimum < 0) stops.add(minimum);
    return [...stops].sort((left, right) => left - right);
}

export function createNumericRanges(snapshot, choices) {
    const countries = Object.entries(snapshot.countries);
    const rangeChoices = new Map();
    if (!countries.some(([, country]) => Object.hasOwn(country, "numericValues"))) return { numericRanges: [], rangeChoices };
    if (countries.some(([, country]) => !Object.hasOwn(country, "numericValues"))) throw new Error("Incomplete GeoGrid numeric extension");
    const numericRanges = [];
    for (const metric of NUMERIC_METRICS) {
        const originals = [...choices.values()].filter(choice => metric.sourceIds.includes(choice.id));
        if (!originals.length) continue;
        const { section, category } = originals[0];
        const name = metric.key === "flag_color_count" ? "Flag color count" : category;
        const values = getStops(metric, originals, countries.map(([, country]) => country));
        const labels = values.map(value => formatValue(value, metric.unit));
        const range = { key: section + ":" + category, name, section, values, labels, sourceIds: [...metric.sourceIds] };
        for (const [side, direction, operation] of [["lower", "Over", ">"], ["upper", "Under", "<"], ["exact", "Exactly", "="]]) {
            const id = "numeric:" + metric.key + ":" + side;
            const generated = values.map((value, variantId) => {
                const matches = new Set();
                const unknown = new Set();
                for (const [code, country] of countries) {
                    const actual = country.numericValues[metric.key];
                    if (metric.key === "coastline_length" && country.landlocked === true) continue;
                    if (actual === null || metric.key === "coastline_length" && country.landlocked === null) unknown.add(code);
                    else if (side === "lower" ? actual > value : side === "upper" ? actual < value : actual === value) matches.add(code);
                }
                const unavailableReason = metric.key === "capital_population" ?
                    "GeoGrid combined.json doesn't contain capital-city populations; the separate cities dataset isn't used." : null;
                const source = {
                    name: "Derived " + operation + " condition from GeoGrid combined.json",
                    url: snapshot.source?.url || "https://cdn-assets.teuteuf.fr/data/geogrid/combined.json",
                    derived: true, field: metric.path, operation,
                    ...(metric.key === "coastline_length" ? { guard: "geogrid.geographyInfo.landlocked must be false" } : {}),
                };
                const sources = [source, ...new Map(originals.flatMap(choice => choice.sources || []).map(item => [item.url, item])).values()];
                const choice = {
                    key: id + ":" + value, id, variantId, value, label: name + " " + operation + " " + labels[variantId],
                    section, category, matches, unknown, sources, ...(unavailableReason ? { unavailableReason } : {}),
                };
                if (choices.has(choice.key) || rangeChoices.has(choice.key)) throw new Error("Duplicate numeric choice: " + choice.key);
                rangeChoices.set(choice.key, choice);
                return choice;
            });
            range[side] = { id, direction, choices: generated };
        }
        numericRanges.push(range);
    }
    return { numericRanges, rangeChoices };
}
