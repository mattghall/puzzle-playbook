import { readFile } from "node:fs/promises";
import path from "node:path";
import { BORDER_PAGE, CAPITAL_PAGE, CAPITALS, COUNTRY_NAMES, FLAGS, POPULATION_PAGE, RANKINGS } from "./mappings.mjs";
import { coordinates, downloadPage, infobox, number, oneTemplate, plain, requireText, rows, source, templates } from "./wikipedia.mjs";
import { MUNICIPAL_TABLES, parseMunicipalTable, RANKING_AUDITS, readExpandedMappings } from "./expanded.mjs";
import { rankingNote, rankingYear } from "./tables.mjs";
import { describeSelections, migrateSources, revisionKey, selectedSource, validateSources } from "./provenance.mjs";

export const FACTS_PATH = "games/world-map/data/facts.json";
export const SOURCES_PATH = "games/world-map/data/source-facts.json";

function createEmptyCountry() {
    return {
        population: null, flagColors: null, borders: null,
        cityCoverage: { status: "unavailable", note: "No comparable Wikipedia city-proper ranking has been audited for this country." },
        cities: [],
    };
}

function getCityId(code, name) {
    return code + ":" + name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "");
}

function getRow(text, name, templateName, allowAmbiguous = false) {
    const matches = rows(text).filter(row => templates(row.split("\n")[0], templateName)[0]?.fields[1] === name);
    if (matches.length > 1 && allowAmbiguous) return null;
    if (matches.length > 1) throw new Error("Duplicate Wikipedia table row: " + name);
    return matches[0];
}

export function parsePopulation(page, name) {
    requireText(page.text, ["! Location", "! Population", "! Date", "Sovereign states and dependencies by population"], page.title);
    const row = getRow(page.text, name, "flagdeco");
    if (!row) return null;
    const population = oneTemplate(row, "n+p");
    const date = oneTemplate(row, "dts");
    if (!/\b(19|20)\d{2}\b/.test(date[1])) throw new Error(name + ": population observation year missing");
    const status = row.match(/\n\| ([^<|{}\n]*(?:estimate|projection|census|survey|State migration service|Official figure)[^<|{}\n]*)/i)?.[1]?.trim();
    if (!status) throw new Error(name + ": population estimate/census definition changed");
    return {
        value: number(population[1]), year: date[1], status,
        source: source(page, "Sovereign states and dependencies by population — " + name),
    };
}

export function parseBorders(page, name, knownCodes) {
    requireText(page.text, ["No. of distinct land neighbours", "borders along lakes, rivers", "man-made structures"], page.title);
    const table = page.text.split('{| class="wikitable sortable col4center col5center"')[1]?.split("\n|}")[0];
    if (!table) throw new Error(page.title + ": land-border table layout changed");
    const row = getRow(table, name, "flag", true);
    if (!row) return null;
    let clean = row;
    for (const item of templates(row, "efn")) clean = clean.replace(item.raw, "");
    const names = templates(clean, "flag").map(item => item.fields[1]);
    const aliases = { ...COUNTRY_NAMES, GIB: "Gibraltar", SPM: "Saint Pierre and Miquelon", SXM: "Sint Maarten" };
    const ids = new Map(Object.entries(aliases).map(([code, title]) => [title, code]));
    const count = clean.match(/\n\|\s*(\d+)\s*\n\|\s*(\d+)\s*\n/);
    if (!count) return null;
    const codes = [...new Set(names.slice(1).map(title => ids.get(title)))];
    if (codes.some(code => !code || !knownCodes.has(code)) || codes.length !== Number(count[2])) return null;
    return {
        codes: codes.sort(),
        source: source(page, "Land borders — " + name),
        note: "Distinct land neighbors in Wikipedia's table, including rivers and lakes but excluding bridges and tunnels. Territory and disputed-border treatment follows this source, not map adjacency.",
    };
}

export function parseRanking(page, code) {
    const config = RANKINGS[code];
    requireText(page.text, config.required, page.title);
    let section = page.text;
    if (code === "USA") section = section.split("{{anchor|Table}}")[1]?.split("|}")[0];
    if (code === "DEU") section = section.split('{| class="wikitable sortable"')[1]?.split("|}")[0];
    if (code === "CAN") section = section.split('{|class="wikitable sortable mw-datatable"')[1]?.split("|}")[0];
    if (!section) throw new Error(page.title + ": ranking table missing");
    const year = rankingYear(section, config, section, page.title);
    const entries = rows(section).filter(row => templates(row, "change").length);
    const minimum = { USA: 100, DEU: 80, CAN: 100 }[code];
    if (entries.length < minimum) throw new Error(page.title + ": ranking table lost coverage");
    const cities = entries.map((row, index) => {
        const population = oneTemplate(row, "change").slice(1).filter(value => !value.includes("="));
        let name;
        let title;
        if (code === "DEU") {
            const flag = templates(row, "flag")[0]?.fields;
            const nameField = row.split("\n")[1];
            const link = nameField?.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
            title = link?.[1] || flag?.[1];
            name = link?.[2] || link?.[1] || flag?.[2] || title;
        } else {
            const link = row.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
            title = link?.[1];
            name = link?.[2] || title;
        }
        if (!name || population.length !== 2) throw new Error(page.title + ": city name/population layout changed");
        if (code === "CAN" && Number(oneTemplate(row, "center")[1]) !== index + 1) throw new Error("Canadian ranking order changed");
        return {
            id: getCityId(code, name), name, article: title, rank: index + 1,
            ...(code === "CAN" ? {} : coordinates(row)),
            capitalRoles: [],
            population: { value: number(population[0]), year, source: source(page, config.section) },
            coordinateSource: code === "CAN" ? null : source(page, config.section),
            definition: "Population within municipal boundaries; not urban or metropolitan area.",
        };
    });
    for (let i = 1; i < cities.length; i++) {
        if (cities[i].population.value > cities[i - 1].population.value) {
            throw new Error(page.title + ": population order changed; audit ranking before updating");
        }
    }
    return cities;
}

export function validateFacts(facts, countryCodes) {
    if (facts.version !== 1 || !facts.countries || Object.keys(facts.countries).length !== countryCodes.size) {
        throw new Error("Facts country coverage doesn't match geography");
    }
    const ids = new Set();
    function checkSource(value) {
        if (!value || !Number.isInteger(value.revision) || value.revision <= 0 || !value.title || !value.section ||
            value.url !== `https://en.wikipedia.org/w/index.php?oldid=${value.revision}`) throw new Error("Invalid Wikipedia provenance");
    }
    function checkPopulation(population) {
        if (population === null) return;
        if (!population || !Number.isSafeInteger(population.value) || population.value < 0 ||
            typeof population.year !== "string" || !/\b(19|20)\d{2}\b/.test(population.year)) throw new Error("Invalid population/year");
        checkSource(population.source);
    }
    for (const [code, country] of Object.entries(facts.countries)) {
        if (!countryCodes.has(code)) throw new Error("Unknown country: " + code);
        checkPopulation(country.population);
        if (country.flagColors !== null) {
            checkSource(country.flagColors.source);
            if (!Array.isArray(country.flagColors.values) || !country.flagColors.values.length ||
                country.flagColors.values.some(color => !["black", "blue", "gold", "green", "orange", "purple", "red", "white", "yellow"].includes(color))) {
                throw new Error("Invalid flag colors: " + code);
            }
        }
        if (country.borders !== null) {
            checkSource(country.borders.source);
            if (!Array.isArray(country.borders.codes) || new Set(country.borders.codes).size !== country.borders.codes.length ||
                country.borders.codes.some(other => !countryCodes.has(other) || other === code)) throw new Error("Invalid land borders: " + code);
        }
        if (!["complete", "incomplete", "unavailable"].includes(country.cityCoverage?.status) || !country.cityCoverage.note) {
            throw new Error("Invalid city coverage: " + code);
        }
        if (!Array.isArray(country.cities)) throw new Error("Invalid cities: " + code);
        const ranks = new Set();
        for (const city of country.cities) {
            if (!city.id?.startsWith(code + ":") || ids.has(city.id) || !city.name ||
                !Number.isFinite(city.longitude) || Math.abs(city.longitude) > 180 ||
                !Number.isFinite(city.latitude) || Math.abs(city.latitude) > 90 || !Array.isArray(city.capitalRoles)) {
                throw new Error("Invalid city: " + city.id);
            }
            ids.add(city.id);
            if (city.rank !== null) {
                if (!Number.isInteger(city.rank) || city.rank < 1 || city.rank > 10 || ranks.has(city.rank) || !city.population) {
                    throw new Error("Invalid city rank: " + city.id);
                }
                ranks.add(city.rank);
            }
            checkPopulation(city.population);
            checkSource(city.coordinateSource);
            if (city.capitalRoles.length) checkSource(city.capitalSource);
        }
        if (country.cityCoverage.status === "complete" && ranks.size !== 10) throw new Error("Incomplete top ten: " + code);
    }
}

export async function prepareFacts({ root, directory, scope, country, bootstrap = false, cacheOnly = false, pinned = false }) {
    const expanded = await readExpandedMappings();
    const world = JSON.parse(await readFile(path.join(root, "games/world-map/data/world.json"), "utf8"));
    const codes = new Set(world.objects.countries.geometries.map(item => item.id));
    if (country && !codes.has(country)) throw new Error("Unknown country ID: " + country);
    const previous = await readFile(path.join(root, FACTS_PATH), "utf8").then(JSON.parse).catch(error => {
        if (bootstrap && error.code === "ENOENT") return null;
        throw error;
    });
    const previousManifest = await readFile(path.join(root, SOURCES_PATH), "utf8").then(JSON.parse).catch(error => {
        if (bootstrap && error.code === "ENOENT") return null;
        throw error;
    });
    const facts = previous ? structuredClone(previous) : { version: 1, countries: Object.fromEntries([...codes].sort().map(code => [code, createEmptyCountry()])) };
    const manifest = previousManifest ? structuredClone(previousManifest) : {
        version: 1,
        license: { name: "Wikipedia text: CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/", attribution: "Wikipedia contributors. Article revision links identify contributors and source text; facts are extracted and normalized for this atlas." },
        conventions: {
            identifiers: "Explicit ISO 3166-1 alpha-3 article mappings; custom Natural Earth IDs remain separate. Geography determines which IDs are available, never their facts.",
            population: "Wikipedia's country population table; reference dates and estimate/census status vary. Country-specific territorial inclusions follow the cited row and can differ from the map.",
            colors: "Wikipedia's current national-flag infobox design. Crimson is grouped as red; gold stays distinct from yellow. No pixel sampling.",
            borders: "Wikipedia distinct land neighbors, including inland-water boundaries, excluding artificial connections. Unmapped, contradictory, and unreviewed rows stay null. The source marks its land-borders section unreferenced.",
            rankings: "Only complete comparable Wikipedia municipal tables can establish rank. Complete means audited top ten, not worldwide or all-city coverage.",
            capitals: "Country infoboxes and Wikipedia's capital list, preserving South Africa's three roles and Chile's legislative seat. Germany's Bonn hosts federal ministries; it isn't a second national capital.",
        },
        mappings: { countryArticles: COUNTRY_NAMES, flags: FLAGS, rankings: RANKINGS, capitals: CAPITALS },
        sources: {}, evidence: {}, coverage: {},
    };
    if (previousManifest) {
        migrateSources(manifest, facts);
        validateSources(manifest, facts);
    }
    else manifest.sourceSelections = Object.fromEntries([...codes].sort().map(code => [code, { facts: {}, cities: {} }]));
    const pages = new Map();
    const currentPages = new Map();
    function preserveEvidence(key, text, title) {
        if (manifest.evidence[key] && manifest.evidence[key] !== text) throw new Error(title + ": source definition changed; review the field mapping");
        manifest.evidence[key] = text;
    }
    function createPageReader(code, scope) {
        return async function readPage(title, fixedRevision) {
            const expected = pinned ? selectedSource(manifest, code, scope, title, fixedRevision) : null;
            const revision = expected?.revision || fixedRevision;
            let value = revision ? pages.get(revisionKey(title, revision)) : currentPages.get(title);
            if (!value) {
                value = await downloadPage(title, directory, { cacheOnly, pinned: revision });
                pages.set(revisionKey(title, value.revision), value);
                if (!revision) currentPages.set(title, value);
            }
            const key = revisionKey(title, value.revision);
            const old = manifest.sources[key];
            if (old && old.sha256 !== value.sha256) throw new Error(title + ": archived wikitext checksum changed");
            if (!old) {
                manifest.sources[key] = {
                    ...source(value, "Article wikitext"), pageId: value.pageId, sha256: value.sha256,
                    retrieved: new Date().toISOString().slice(0, 10),
                    history: `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&action=history`,
                };
            }
            const binding = fixedRevision ? revisionKey(title, fixedRevision) : title;
            manifest.sourceSelections[code][scope][binding] = key;
            return value;
        };
    }
    async function readCityCoordinates(title, page) {
        const config = expanded.coordinates[title];
        if (!config) throw new Error(title + ": no audited Wikipedia coordinate mapping");
        const article = await page(config.title, config.revision);
        requireText(article.text, config.evidence, config.title);
        let location;
        if (config.kind === "legacy") {
            const info = infobox(article.text, "Infobox settlement");
            location = coordinates(`{{coord|${info.latd}|${info.latm}|${info.latNS}|${info.longd}|${info.longm}|${info.longEW}}}`);
        } else location = coordinates(config.evidence[0]);
        return {
            ...location,
            coordinateSource: source(article, config.section || "Infobox — coordinates"),
            coordinateNote: config.historical ? "Pinned explicit Wikipedia coordinates; current templates can defer to Wikidata, which isn't imported." : "Coordinates from a pinned Wikipedia article revision.",
        };
    }
    const targets = country ? [country] : [...codes].sort();
    if (scope === "facts" || bootstrap) {
        for (const code of targets) {
            const page = createPageReader(code, "facts");
            const populations = await page(POPULATION_PAGE);
            const borders = await page(BORDER_PAGE);
            const entry = facts.countries[code];
            const name = COUNTRY_NAMES[code];
            const population = name ? parsePopulation(populations, name) : null;
            const border = name ? parseBorders(borders, name, codes) : null;
            if (entry.population && !population) throw new Error(code + ": population disappeared; update the explicit source mapping");
            if (entry.borders && !border) throw new Error(code + ": border coverage lost; inspect Wikipedia definitions");
            entry.population = population;
            entry.borders = border;
            if (FLAGS[code]) {
                const config = FLAGS[code];
                const flag = await page(config.title);
                const first = templates(flag.text, config.template || "Infobox flag")[0];
                if (!first) throw new Error(config.title + ": flag infobox missing");
                const designField = first.fields.find(field => field.split("=")[0].trim() === (config.field || "Design"));
                const design = plain(designField?.slice(designField.indexOf("=") + 1) || "");
                requireText(design, config.words, config.title);
                requireText(flag.text, config.extraEvidence || [], config.title);
                preserveEvidence(code + ":flag-design", design, config.title);
                entry.flagColors = {
                    values: config.colors, source: source(flag, config.section || "Infobox — " + (config.field || "Design")),
                    ...(config.note ? { note: config.note } : {}),
                };
            }
        }
    }
    if (scope === "cities" || bootstrap) {
        for (const code of targets) {
            const page = createPageReader(code, "cities");
            const capitalList = await page(CAPITAL_PAGE);
            const entry = facts.countries[code];
            const cities = [];
            let rankingPage;
            let rankingCities = [];
            if (RANKINGS[code]) {
                rankingPage = await page(RANKINGS[code].title);
                rankingCities = parseRanking(rankingPage, code);
                for (const city of rankingCities.slice(0, 10)) {
                    if (code === "CAN") {
                        if (city.name === "Calgary") Object.assign(city, await readCityCoordinates("Calgary", page));
                        else {
                            const cityPage = await page(city.article);
                            const info = infobox(cityPage.text, "Infobox settlement");
                            Object.assign(city, coordinates(info.coordinates), { coordinateSource: source(cityPage, "Infobox — coordinates") });
                        }
                    }
                    delete city.article;
                    cities.push(city);
                }
                entry.cityCoverage = {
                    status: "complete", audit: "complete",
                    note: rankingNote(RANKINGS[code], rankingCities[0].population.year),
                    source: source(rankingPage, RANKINGS[code].section),
                };
            } else if (MUNICIPAL_TABLES[code]) {
                const config = MUNICIPAL_TABLES[code];
                rankingPage = await page(config.title);
                rankingCities = parseMunicipalTable(rankingPage, code);
                for (const ranked of rankingCities.slice(0, 10)) {
                    cities.push({
                        id: getCityId(code, ranked.name), name: ranked.name,
                        ...await readCityCoordinates(ranked.title, page),
                        rank: ranked.rank, population: ranked.population, definition: ranked.definition, capitalRoles: [],
                    });
                }
                entry.cityCoverage = { status: "complete", audit: "complete", note: rankingCities[0].definition, source: source(rankingPage, config.section) };
            } else {
                entry.cityCoverage = {
                    status: "unavailable", audit: RANKING_AUDITS[code] ? "reviewed-not-imported" : "not-yet-audited",
                    note: RANKING_AUDITS[code] || "Not yet audited: no Wikipedia city-proper table has been mapped for this country.",
                };
            }
            for (const capital of CAPITALS[code] || []) {
                let location;
                let coordinateSource;
                let capitalSource;
                if (capital.name === "Bonn") {
                    const bonn = rankingCities.find(city => city.name === "Bonn");
                    if (!bonn) throw new Error("Germany: Bonn coordinate row disappeared");
                    location = { longitude: bonn.longitude, latitude: bonn.latitude };
                    coordinateSource = bonn.coordinateSource;
                    requireText(capitalList.text, ["[[Bonn]]", "still the primary seat of six"], CAPITAL_PAGE);
                    preserveEvidence("DEU:Bonn:capital-role", capitalList.text.split("\n").find(line => line.includes("[[Bonn]]")), CAPITAL_PAGE);
                    capitalSource = source(capitalList, "List — Germany");
                } else {
                    const article = await page(capital.title);
                    const info = infobox(article.text, capital.country ? "Infobox settlement" : "Infobox country");
                    location = coordinates(info[capital.field || "coordinates"]);
                    coordinateSource = source(article, "Infobox — " + (capital.field || "coordinates"));
                    if (capital.country) {
                        requireText(capitalList.text, [capital.name, capital.country], CAPITAL_PAGE);
                        const lines = capitalList.text.split("\n").filter(line => line.includes("[[" + capital.name + "]]"));
                        if (lines.length !== 1) throw new Error(capital.name + ": capital role row changed");
                        preserveEvidence(code + ":" + capital.name + ":capital-role", lines[0], CAPITAL_PAGE);
                        capitalSource = source(capitalList, "List — " + capital.country);
                    } else {
                        requireText(info.capital, [capital.name], capital.title);
                        preserveEvidence(code + ":" + capital.name + ":capital-role", info.capital, capital.title);
                        capitalSource = source(article, "Infobox — capital");
                    }
                }
                let city = cities.find(item => item.name === capital.name);
                if (!city) {
                    const listed = rankingCities.find(item => item.name === capital.name || item.article === capital.name);
                    city = {
                        id: getCityId(code, capital.name), name: capital.name, ...location, coordinateSource, capitalRoles: [],
                        population: listed?.population || null, rank: null,
                        ...(listed ? { definition: listed.definition } : {}),
                    };
                    cities.push(city);
                }
                city.capitalRoles = capital.roles;
                city.capitalSource = capitalSource;
            }
            for (const capital of expanded.capitals.filter(item => item.code === code)) {
                const article = capital.sourceTitle ? await page(capital.sourceTitle) : capitalList;
                requireText(article.text, capital.evidence, article.title);
                let city = cities.find(item => item.name === capital.name);
                if (!city) {
                    city = {
                        id: getCityId(code, capital.name), name: capital.name, ...await readCityCoordinates(capital.coordinateTitle || capital.title, page),
                        rank: null, population: null, capitalRoles: [],
                    };
                    cities.push(city);
                }
                city.capitalRoles = capital.roles;
                city.capitalSource = source(article, capital.section || "List — " + (COUNTRY_NAMES[code] || code));
                if (capital.note) city.capitalNote = capital.note;
            }
            const nextIds = new Set(cities.map(city => city.id));
            const removed = entry.cities.filter(city => !nextIds.has(city.id));
            if (removed.length) throw new Error(code + ": cities disappeared: " + removed.map(city => city.name).join(", "));
            entry.cities = cities;
        }
    }
    validateFacts(facts, codes);
    describeSelections(manifest);
    validateSources(manifest, facts);
    manifest.mappings = { countryArticles: COUNTRY_NAMES, flags: FLAGS, rankings: { ...RANKINGS, ...MUNICIPAL_TABLES }, capitals: CAPITALS, expanded };
    manifest.conventions.coordinates = "City coordinates are read from explicitly pinned Wikipedia wikitext. Historical revisions are used where current coordinate templates defer to Wikidata. Those coordinate pins require an explicit reviewed mapping change; factual/role tables refresh normally.";
    manifest.conventions.rankingYears = "Population years come from validated table headings, or Spain's explicit table-introduction year because its population heading is undated. Clean year rollovers refresh automatically; ambiguous years, changed column layouts, and changed municipal definitions require review.";
    manifest.conventions.colors = "Wikipedia's national-flag descriptions, including emblems. Civil/national designs aren't combined with separate government/state variants. Crimson and vermilion are grouped as red, saffron as orange, and navy/cobalt/light blue as blue. Gold stays distinct from yellow. No pixel sampling.";
    manifest.conventions.capitals = "Wikipedia's national-capital list, country infoboxes, and explicit supplemental seat designations. Multiple seats, de facto/de jure roles, city-states, and disputed claims are retained. Proposed Nusantara isn't imported as Indonesia's current capital; Jakarta follows its country article.";
    const nonSovereignCodes = new Set(["GRL", "HKG", "MAC", "PRI", "ESH", "TWN", "X-KOSOVO", "X-SOMALILAND", "X-NORTHERN-CYPRUS"]);
    const sovereignCodes = Object.keys(COUNTRY_NAMES).filter(code => !nonSovereignCodes.has(code));
    const capitalCodes = Object.entries(facts.countries).filter(([, item]) => item.cities.some(city => city.capitalRoles.length)).map(([code]) => code);
    manifest.coverage = {
        countries: codes.size,
        population: Object.values(facts.countries).filter(item => item.population).length,
        borders: Object.values(facts.countries).filter(item => item.borders).length,
        flags: Object.values(facts.countries).filter(item => item.flagColors).length,
        completeRankings: Object.entries(facts.countries).filter(([, item]) => item.cityCoverage.status === "complete").map(([code]) => code),
        incompleteRankings: Object.entries(facts.countries).filter(([, item]) => item.cityCoverage.status === "incomplete").map(([code]) => code),
        cities: Object.values(facts.countries).reduce((total, item) => total + item.cities.length, 0),
        capitalsMapped: capitalCodes,
        capitalCities: Object.values(facts.countries).reduce((total, item) => total + item.cities.filter(city => city.capitalRoles.length).length, 0),
        sovereignCapitals: {
            definition: "193 UN members plus the two observer states; coverage is limited to bundled geography.",
            mappable: sovereignCodes.filter(code => codes.has(code)).length,
            mapped: sovereignCodes.filter(code => capitalCodes.includes(code)).length,
            missing: sovereignCodes.filter(code => codes.has(code) && !capitalCodes.includes(code)),
            absentFromGeography: sovereignCodes.filter(code => !codes.has(code)),
        },
        rankingsReviewedNotImported: RANKING_AUDITS,
        rankingsNotYetAudited: Object.entries(facts.countries).filter(([, item]) => item.cityCoverage.audit === "not-yet-audited").map(([code]) => code),
    };
    const formatJson = value => JSON.stringify(value, null, 2) + "\n";
    return {
        files: [{ path: FACTS_PATH, content: formatJson(facts) }, { path: SOURCES_PATH, content: formatJson(manifest) }],
        summary: summarize(previous, facts, previousManifest, manifest),
    };
}

export function summarize(previous, facts, oldManifest, manifest) {
    const changes = [];
    for (const [code, country] of Object.entries(facts.countries)) {
        const old = previous?.countries[code];
        if (JSON.stringify(old) === JSON.stringify(country)) continue;
        const details = [];
        if (old?.population?.year !== country.population?.year) details.push(`population year ${old?.population?.year || "unknown"} → ${country.population?.year || "unknown"}`);
        if (JSON.stringify(old?.cities) !== JSON.stringify(country.cities)) {
            details.push("cities " + country.cities.map(city => `${city.name} ${city.rank ?? "capital"}`).join(", "));
            for (const city of country.cities) {
                const before = old?.cities.find(item => item.id === city.id);
                if (before && before.population?.year !== city.population?.year) {
                    details.push(`${city.name} population year ${before.population?.year || "unknown"} → ${city.population?.year || "unknown"}`);
                }
            }
        }
        changes.push(`${old ? "Changed" : "Added"} ${code}${details.length ? ": " + details.join("; ") : ""}`);
    }
    const oldRevisions = new Set(Object.values(oldManifest?.sources || {}).map(value => revisionKey(value.title, value.revision)));
    const revisions = Object.values(manifest.sources).filter(value => !oldRevisions.has(revisionKey(value.title, value.revision)))
        .map(value => `${value.title}: archived revision ${value.revision}`);
    const unknown = Object.values(facts.countries).filter(item => item.cityCoverage.status !== "complete").length;
    return [...changes, ...revisions, `Coverage: ${manifest.coverage.population} populations; ${manifest.coverage.borders} border lists; ${manifest.coverage.flags} flag descriptions; ${manifest.coverage.completeRankings.length} complete top-ten rankings; ${unknown} unresolved rankings.`];
}
