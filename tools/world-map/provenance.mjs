import { BORDER_PAGE, CAPITAL_PAGE, CAPITALS, POPULATION_PAGE } from "./mappings.mjs";

export function revisionKey(title, revision) {
    return title + "@" + revision;
}

function collectCitations(value, result = []) {
    if (!value || typeof value !== "object") return result;
    if (value.title && Number.isInteger(value.revision) && value.url) result.push(value);
    else for (const child of Object.values(value)) collectCitations(child, result);
    return result;
}

export function migrateSources(manifest, facts) {
    if (manifest.sourceSelections) return;
    const legacy = manifest.sources;
    const archive = {};
    for (const value of Object.values(legacy)) {
        const key = revisionKey(value.title, value.revision);
        if (archive[key] && JSON.stringify(archive[key]) !== JSON.stringify(value)) throw new Error("Conflicting legacy revision metadata: " + key);
        archive[key] = value;
    }
    const selections = {};
    for (const [code, entry] of Object.entries(facts.countries)) {
        const selected = { facts: {}, cities: {} };
        function select(scope, binding, value) {
            if (!value) throw new Error(code + ": missing legacy source for " + binding);
            const key = revisionKey(value.title, value.revision);
            if (!archive[key]) throw new Error("Missing archived citation; recover its original metadata before migration: " + key);
            if (selected[scope][binding] && selected[scope][binding] !== key) throw new Error(code + ": conflicting legacy source selection: " + binding);
            selected[scope][binding] = key;
        }
        for (const title of [POPULATION_PAGE, BORDER_PAGE]) {
            const value = (title === POPULATION_PAGE ? entry.population : entry.borders)?.source;
            select("facts", title, value || legacy[title]);
        }
        for (const value of collectCitations([entry.population, entry.borders, entry.flagColors])) select("facts", value.title, value);
        const capitalList = entry.cities.map(city => city.capitalSource).find(value => value?.title === CAPITAL_PAGE);
        select("cities", CAPITAL_PAGE, capitalList || legacy[CAPITAL_PAGE]);
        for (const value of collectCitations(entry.cityCoverage)) select("cities", value.title, value);
        for (const city of entry.cities) {
            for (const value of collectCitations([city.population, city.capitalSource])) select("cities", value.title, value);
            const value = city.coordinateSource;
            if (value) {
                const fixed = revisionKey(value.title, value.revision);
                const binding = legacy[fixed] && !(code === "CAN" && city.rank && city.name !== "Calgary") ? fixed : value.title;
                select("cities", binding, value);
            }
        }
        for (const capital of CAPITALS[code] || []) {
            if (capital.name !== "Bonn" && !selected.cities[capital.title]) select("cities", capital.title, legacy[capital.title]);
        }
        selections[code] = selected;
    }
    manifest.sources = archive;
    manifest.sourceSelections = selections;
    describeSelections(manifest);
    validateSources(manifest, facts);
}

export function describeSelections(manifest) {
    manifest.conventions.sourceRevisions = "Sources are an immutable article@revision archive. Each country's facts and cities scopes select their own source revisions, including shared tables that yielded null or unavailable results. Scoped refreshes retain other countries/scopes and every archived revision. Historical coordinate bindings include their fixed revision. Legacy null results inherit their original shared-table snapshot.";
}

export function selectedSource(manifest, code, scope, title, fixedRevision) {
    const binding = fixedRevision ? revisionKey(title, fixedRevision) : title;
    const key = manifest.sourceSelections[code]?.[scope]?.[binding];
    const value = manifest.sources[key];
    if (!value || value.title !== title || key !== revisionKey(title, value.revision) ||
        fixedRevision && value.revision !== fixedRevision) throw new Error(`${code}/${scope}: missing pinned source selection: ${binding}`);
    return value;
}

export function validateSources(manifest, facts) {
    for (const [key, value] of Object.entries(manifest.sources)) {
        if (key !== revisionKey(value.title, value.revision) || !Number.isInteger(value.revision) || value.revision <= 0 ||
            !/^[a-f0-9]{64}$/.test(value.sha256) || !value.pageId || !value.retrieved) throw new Error("Invalid archived source: " + key);
    }
    if (Object.keys(manifest.sourceSelections).length !== Object.keys(facts.countries).length) throw new Error("Source selection country coverage changed");
    for (const [code, entry] of Object.entries(facts.countries)) {
        for (const scope of ["facts", "cities"]) {
            const selected = manifest.sourceSelections[code]?.[scope];
            if (!selected || typeof selected !== "object" || Array.isArray(selected)) throw new Error("Missing source scope: " + code + "/" + scope);
            for (const [binding, key] of Object.entries(selected)) {
                const value = manifest.sources[key];
                if (!value || binding !== value.title && binding !== key) throw new Error("Invalid source binding: " + binding);
            }
            for (const title of scope === "facts" ? [POPULATION_PAGE, BORDER_PAGE] : [CAPITAL_PAGE]) selectedSource(manifest, code, scope, title);
            const values = scope === "facts" ? [entry.population, entry.flagColors, entry.borders] : [entry.cityCoverage, entry.cities];
            for (const value of collectCitations(values)) {
                const key = revisionKey(value.title, value.revision);
                if (!manifest.sources[key] || !Object.values(selected).includes(key)) throw new Error(code + "/" + scope + ": unbound citation: " + key);
            }
        }
    }
}
