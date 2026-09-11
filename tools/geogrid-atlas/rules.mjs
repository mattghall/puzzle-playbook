export const COLORS = ["black", "white", "grey", "pink", "red", "orange", "yellow", "green", "blue", "purple", "brown"];

export const RULES = {};

const BOOLEAN_FIELDS = {
    flagInfo: {
        flag_has_star: "hasStar", flag_has_coat_of_arms: "hasCoatOfArms", flag_has_animal: "hasAnimal",
        flag_has_horizontal_stripes: "hasHorizontalStripes", flag_has_vertical_stripes: "hasVerticalStripes",
        flag_has_plant: "hasPlant", flag_has_moon: "hasMoon",
    },
    geographyInfo: {
        island_nation: "islandNation", landlocked: "landlocked", touches_sahara: "touchesSahara",
        touches_eurasian_steppe: "touchesEurasionSteppe", touches_equator: "touchesEquator",
        top_10_lakes: "top10Lakes", river_border: "riverBorder", touches_tropics: "touchesTropics",
        touches_ring_of_fire: "touchesRingOfFire", has_desert: "hasDesert", has_rainforest: "hasRainforest", has_volcano: "hasVolcano",
    },
    economicInfo: {
        nuclear_power: "producesNuclearPower", top_20_wheat_production: "top20WheatProduction",
        top_20_oil_production: "top20OilProduction", top_20_renewable_electricity_production: "top20RenewableElectricityProduction",
    },
    politicalInfo: {
        is_monarchy: "isMonarchy", in_eu: "inEU", has_nuclear_weapons: "hasNuclearWeapons", was_ussr: "wasUSSR",
        commonwealth_member: "inCommonwealth", observes_dst: "observesDST", same_sex_marriage_legal: "sameSexMarriageLegal",
        same_sex_activities_illegal: "sameSexActivitiesIllegal", is_territory: "isTerritory", roman_empire: "romanEmpire",
        ottoman_empire: "ottomanEmpire", arab_league: "arabLeague", apec: "apec", nato: "nato",
        mandatory_military_service: "mandatoryMilitary", no_standing_army: "noStandingArmy", female_leader: "femaleLeader",
        antarctic_treaty: "antarcticTreaty", space_agency: "spaceAgency", mongol_empire: "mongolEmpire",
    },
    sportsInfo: {
        hosted_olympics: "hostedOlympics", hosted_f1: "hostedF1", hosted_world_cup: "hostedMensWorldCup",
        played_world_cup: "playedMensWorldCup", won_world_cup: "wonMensWorldCup",
    },
    factsInfo: {
        drives_left: "drivesLeft", alcohol_ban: "hasAlcoholBan", "50_plus_skyscrapers": "has50Skyscrapers",
        top_20_obesity_rate: "top20ObesityRate", top_20_chocolate_consumption: "top20ChocolateConsumption",
        top_20_alcohol_consumption: "top20AlcoholConsumption", top_20_population_density: "top20PopulationDensity",
        bottom_20_population_density: "bottom20PopulationDensity", top_20_tourism: "top20TourismRate",
        top_20_rail_size: "top20RailSize", top_20_world_hertitage_sites: "top20WorldHeritageSites",
        unesco: "hasUnescoSite", metro: "hasMetro", google_street_view: "hasGoogleStreetView",
        citizen_traveled_to_space: "citizenSpace", eurovision: "eurovision",
    },
};

for (const [group, fields] of Object.entries(BOOLEAN_FIELDS)) {
    for (const [id, field] of Object.entries(fields)) RULES[id] = { operation: "boolean", path: `geogrid.${group}.${field}` };
}
RULES.doesnt_touch_tropics = { ...RULES.touches_tropics, negate: true };

const NUMERIC_FIELDS = {
    coastline_length: "geogrid.geographyInfo.coastlineLength",
    elevation: "geogrid.geographyInfo.averageElevation",
    temp: "geogrid.geographyInfo.averageTemperature",
    rainfall: "geogrid.geographyInfo.annualRainfall",
    land_border_length: "geogrid.geographyInfo.landBorderLength",
    hdi: "geogrid.economicInfo.HDI",
    gdp_per_capita: "geogrid.economicInfo.GDPPerCapita",
    cpi: "geogrid.politicalInfo.CPI",
    olympic_medals: "geogrid.sportsInfo.olympicMedals",
    air_pollution: "geogrid.factsInfo.airPollution",
    co2_emissions_per_capita: "geogrid.factsInfo.co2Emissions",
    population: "common.population",
    size: "common.size",
};
for (const [prefix, field] of Object.entries(NUMERIC_FIELDS)) {
    for (const operation of ["over", "under"]) RULES[`${prefix}_${operation}_x`] = { operation, path: field, coastal: prefix === "coastline_length" };
}
for (const [id, path, operation] of [
    ["forest_cover_over_x", "geogrid.geographyInfo.forestCover", "over"],
    ["arable_land_under_x", "geogrid.geographyInfo.arableLand", "under"],
    ["protected_waters_under_x", "geogrid.geographyInfo.protectedWaters", "under"],
    ["over_x_living_langs", "geogrid.politicalInfo.livingLanguages", "over"],
    ["urban_pop_over_x", "geogrid.politicalInfo.urbanPopulation", "over"],
    ["largest_city_x_urban_pop", "geogrid.politicalInfo.largestCityUrbanPopulation", "over"],
    ["no_olympic_medals", "geogrid.sportsInfo.olympicMedals", "zero"],
]) RULES[id] = { operation, path };

for (const [id, path, insensitive = false, negate = false] of [
    ["color_on_flag", "geogrid.flagInfo.colorsOnFlag"],
    ["color_not_on_flag", "geogrid.flagInfo.colorsOnFlag", false, true],
    ["coastline_on_x", "geogrid.geographyInfo.coastline", true],
    ["continent", "common.continent"],
    ["river_x_runs_through", "geogrid.geographyInfo.rivers", true],
    ["hemisphere", "geogrid.geographyInfo.hemisphere"],
    ["official_language", "geogrid.politicalInfo.officialLanguageCodes"],
    ["not_official_language", "geogrid.politicalInfo.officialLanguageCodes", false, true],
    ["observes_x_time_zone", "geogrid.politicalInfo.timeZones"],
    ["former_colony_of_x", "geogrid.politicalInfo.formerColonyOf"],
]) RULES[id] = { operation: "includes", path, insensitive, negate };

for (const id of ["flag_rwb", "flag_without_rwb", "flag_has_x_colors", "flag_has_x_or_more_colors"]) {
    RULES[id] = { operation: "flag", path: "geogrid.flagInfo.colorsOnFlag" };
}
for (const id of ["starting_letter", "ending_letter", "name_length", "name_x_plus_letters_long", "name_multiple_words", "name_start_end_same_letter"]) {
    RULES[id] = { operation: "name", path: "common.name" };
}
for (const id of ["borders_x_to_y", "borders_x_or_more", "borders_x"]) RULES[id] = { operation: "borders" };
for (const id of ["capital_population_over_x", "captial_population_under_x", "capital_not_most_populated_city", "capital_starting_letter"]) {
    RULES[id] = { operation: "capital" };
}
RULES.multiple_time_zones = { operation: "multiple", path: "geogrid.politicalInfo.timeZones" };
RULES.majority_religion = { operation: "equals", path: "geogrid.politicalInfo.majorityReligion" };

function readPath(record, path) {
    return path?.split(".").reduce((value, key) => value?.[key], record);
}

function validateType(value, type, description) {
    if (value === undefined || value === null) return null;
    const valid = type === "array" ? Array.isArray(value) && value.every(item => typeof item === "string") : typeof value === type && (type !== "number" || Number.isFinite(value));
    if (!valid) throw new Error("Invalid source field: " + description);
    return value;
}

export function flagColors(record) {
    const colors = validateType(record.geogrid?.flagInfo?.colorsOnFlag, "array", "colorsOnFlag");
    if (colors === null) return null;
    const normalized = colors.map(color => color.toLowerCase().replace(/^gray$/, "grey"));
    if (!normalized.length || normalized.some(color => !COLORS.includes(color)) || new Set(normalized).size !== normalized.length) {
        throw new Error("Unrecognized or duplicate flag colors: " + colors.join(", "));
    }
    return normalized;
}

function normalizeLetters(name) {
    return name.replace(/[^a-zA-Z\u00c0-\u017f]/g, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

export function borderCount(record, countries) {
    const override = validateType(record.geogrid?.geographyInfo?.borderCountOverride, "number", "borderCountOverride");
    if (override !== null) return override;
    const mode = record.common?.borderMode;
    if (mode === "nearby") return 0;
    if (mode !== "bordering") return null;
    const borders = validateType(record.common?.borders, "array", "borders");
    if (borders === null) return null;
    if (borders.some(code => !countries[code]?.common?.borderMode)) return null;
    return borders.filter(code => countries[code].common.borderMode !== "nearby").length;
}

export function evaluate(record, choice, countries) {
    const rule = RULES[choice.id];
    if (!rule) throw new Error("Unsupported world atlas category: " + choice.id);
    if (!record || typeof record !== "object") throw new Error("Invalid source country");
    let value = readPath(record, rule.path);
    if (rule.path === "geogrid.flagInfo.colorsOnFlag") value = flagColors(record);
    // Combined.json has no capital names or capital-city populations.
    if (rule.operation === "capital") return null;
    if (rule.operation === "borders") {
        if (choice.id === "borders_x") {
            if (!record.common?.borderMode) return null;
            if (record.common.borderMode !== "bordering") return false;
            const borders = validateType(record.common.borders, "array", "borders");
            return borders === null ? null : borders.includes(choice.parameter.toLowerCase());
        }
        const count = borderCount(record, countries);
        if (count === null) return null;
        return choice.id === "borders_x_or_more" ? count >= 5 : count >= choice.variantId + 1 && count <= choice.variantId + 2;
    }
    const type = ["includes", "flag", "multiple"].includes(rule.operation) ? "array" : rule.operation === "boolean" ? "boolean" : ["name", "equals"].includes(rule.operation) ? "string" : "number";
    value = validateType(value, type, rule.path);
    if (rule.coastal) {
        const landlocked = validateType(record.geogrid?.geographyInfo?.landlocked, "boolean", "landlocked");
        if (landlocked === true) return false;
        if (landlocked === null) return null;
    }
    if (value === null) return null;
    let result;
    switch (rule.operation) {
        case "boolean": result = value; break;
        case "over": result = value > choice.parameter; break;
        case "under": result = value < choice.parameter; break;
        case "zero": result = value === 0; break;
        case "multiple": result = value.length > 1; break;
        case "equals": result = value === choice.parameter; break;
        case "includes": result = rule.insensitive ? value.some(item => item.toLowerCase() === choice.parameter.toLowerCase()) : value.includes(choice.parameter); break;
        case "flag": {
            if (choice.id === "flag_rwb") result = value.length === 3 && ["red", "white", "blue"].every(color => value.includes(color));
            if (choice.id === "flag_without_rwb") result = ["red", "white", "blue"].every(color => !value.includes(color));
            if (choice.id === "flag_has_x_colors") result = value.length === choice.variantId + 2;
            if (choice.id === "flag_has_x_or_more_colors") result = value.length >= 5;
            break;
        }
        case "name": {
            if (!value) return null;
            const length = value.replace(/[- '(),.]/g, "").length;
            if (choice.id === "starting_letter") result = normalizeLetters(value).startsWith(choice.parameter);
            if (choice.id === "ending_letter") result = normalizeLetters(value).endsWith(choice.parameter);
            if (choice.id === "name_length") result = length === choice.variantId + 4;
            if (choice.id === "name_x_plus_letters_long") result = length >= 10;
            if (choice.id === "name_multiple_words") result = value.split(/[- ]/g).length > 1;
            if (choice.id === "name_start_end_same_letter") result = value.charAt(0).toUpperCase() === value.at(-1).toUpperCase();
            break;
        }
        default: throw new Error("Unsupported atlas operation: " + rule.operation);
    }
    if (typeof result !== "boolean") throw new Error("Unevaluated atlas choice: " + choice.key);
    return rule.negate ? !result : result;
}
