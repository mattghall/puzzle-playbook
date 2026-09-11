import { matchNumericValue } from "../../games/world-map/js/numeric-ranges.mjs";

export const CITY_URL = "https://cdn-assets.teuteuf.fr/data/common/cities.json";
export const CAPITAL_IDS = ["capital_population_over_x", "captial_population_under_x", "capital_not_most_populated_city", "capital_starting_letter"];

function normalizeInitial(name) {
    return name.replace(/[^a-zA-Z\u00c0-\u017f]/g, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").charAt(0).toUpperCase();
}

export function readCapitalData(cities, countries) {
    if (!Array.isArray(cities) || !cities.length) throw new Error("Missing GeoGrid city data");
    const grouped = new Map(Object.keys(countries).map(code => [code, []]));
    const ids = new Set();
    for (const city of cities) {
        const code = typeof city?.countryCode === "string" ? city.countryCode.toLowerCase() : "";
        if (!grouped.has(code) || !Number.isSafeInteger(city.index) || ids.has(city.index) ||
            typeof city.capital !== "boolean" || typeof city.names?.en !== "string" || !normalizeInitial(city.names.en) ||
            city.population != null && (!Number.isSafeInteger(city.population) || city.population < 0) ||
            city.sourceLink != null && (typeof city.sourceLink !== "string" || !/^https?:\/\/\S+$/.test(city.sourceLink))) {
            throw new Error("Invalid GeoGrid city: " + (city?.index ?? "missing ID"));
        }
        ids.add(city.index);
        grouped.get(code).push({
            id: city.index, name: city.names.en.trim(), population: city.population ?? null,
            capital: city.capital, source: city.sourceLink ? { url: city.sourceLink } : null,
        });
    }
    return Object.fromEntries([...grouped].map(([code, records]) => {
        const capitals = records.filter(city => city.capital);
        const populated = records.filter(city => city.population !== null);
        const capitalPopulations = capitals.map(city => city.population);
        let notLargest = null;
        if (capitals.length && capitalPopulations.every(value => value !== null) && populated.length >= 2) {
            const largest = Math.max(...populated.map(city => city.population));
            const largestCapital = Math.max(...capitalPopulations);
            if (largest > largestCapital) notLargest = true;
            else if (records.every(city => city.population !== null)) notLargest = false;
        }
        return [code, {
            names: capitals.map(city => city.name),
            cities: capitals,
            notLargest,
            largestRecordedCities: populated.length ? populated.filter(city => city.population === Math.max(...populated.map(city => city.population))) : [],
            listedCityCount: records.length,
            populatedCityCount: populated.length,
        }];
    }));
}

export function applyCapitalData(snapshot, cities) {
    const data = readCapitalData(cities, snapshot.countries);
    if (!Object.values(data).some(capital => capital.names.length)) throw new Error("GeoGrid city data has no capital designations");
    for (const [code, country] of Object.entries(snapshot.countries)) {
        country.capital = data[code];
        country.numericValues.capital_population = data[code].cities.length ? data[code].cities.map(city => city.population) : null;
    }
    for (const choice of snapshot.choices) {
        if (!CAPITAL_IDS.includes(choice.id)) continue;
        choice.matches = [];
        choice.unknown = [];
        for (const [code, country] of Object.entries(snapshot.countries)) {
            const capital = country.capital;
            const result = choice.id === "capital_starting_letter" ?
                capital.names.length ? capital.names.some(name => normalizeInitial(name) === choice.value.toUpperCase()) : null :
                choice.id === "capital_not_most_populated_city" ? capital.notLargest :
                matchNumericValue(country.numericValues.capital_population, choice.id === "capital_population_over_x" ? "lower" : "upper", choice.value);
            if (result === null) choice.unknown.push(code);
            else if (result) choice.matches.push(code);
        }
        delete choice.unavailableReason;
        if (choice.unknown.length === Object.keys(snapshot.countries).length) {
            choice.unavailableReason = "GeoGrid's city dataset has no usable facts for this capital condition.";
        }
        choice.sources = [
            { name: "GeoGrid city data", url: CITY_URL },
            ...(choice.sources || []).filter(source => source.url !== CITY_URL),
        ];
    }
}
