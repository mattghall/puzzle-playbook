import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parseArguments, applyTransaction, assertClean, captureImageTargets, captureTargets, update } from "./update.mjs";
import { coordinates, infobox, number, oneTemplate, splitFields } from "./wikipedia.mjs";
import { FACTS_PATH, SOURCES_PATH, parseBorders, parsePopulation, parseRanking, prepareFacts, summarize, validateFacts } from "./facts.mjs";
import { MUNICIPAL_TABLES, parseMunicipalTable, readExpandedMappings } from "./expanded.mjs";
import { BORDER_PAGE, CAPITAL_PAGE, CAPITALS, FLAGS, POPULATION_PAGE, RANKINGS } from "./mappings.mjs";
import { cells, cellText, rankingNote } from "./tables.mjs";
import { migrateSources, revisionKey, selectedSource, validateSources } from "./provenance.mjs";
import { GEOGRID_PATH, GEOGRID_SOURCES_PATH } from "../geogrid-atlas/prepare.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function commitFixture(root, targets) {
    assert.ok(root.startsWith(path.join(ROOT, ".world-map-test-")));
    execFileSync("git", ["-C", root, "add", "--", ...targets]);
    execFileSync("git", [
        "-C", root, "-c", "user.name=World map fixture", "-c", "user.email=fixture@example.invalid",
        "-c", "commit.gpgsign=false", "-c", "core.hooksPath=" + path.join(root, "hooks"),
        "commit", "--quiet", "-m", "Fixture baseline\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>",
    ]);
}

async function createFixture(name, files, tracked = true) {
    const root = path.join(ROOT, ".world-map-test-" + process.pid + "-" + name);
    const stage = path.join(root, "stage");
    await mkdir(stage, { recursive: true });
    await mkdir(path.join(root, "hooks"));
    execFileSync("git", ["init", "--quiet", root]);
    for (const [file, content] of Object.entries(files)) {
        await mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await writeFile(path.join(root, file), content);
    }
    if (tracked && Object.keys(files).length) commitFixture(root, Object.keys(files));
    return { root, stage };
}

function buildTableHeaders(config, year) {
    const current = new Set([config.populationHeading ?? config.populationColumn, ...(config.matchingYearColumns || [])]);
    const headers = config.headers.map((label, index) => "!" + label.replaceAll("{year}", current.has(index) ? year : String(2000 - index)));
    if (config.subheaders) headers.push("|- class=units", ...config.subheaders.map(label => "!" + label));
    return headers.join("\n");
}

async function createSourceFixture() {
    const world = { objects: { countries: { geometries: ["CAN", "TUV", "USA"].map(id => ({ id })) } } };
    const fixture = await createFixture("source-revisions", { "games/world-map/data/world.json": JSON.stringify(world) }, false);
    const expanded = await readExpandedMappings();
    const revisions = new Map();
    async function writePage(title, text, revision, fixed = false) {
        const data = { query: { pages: { 1: { pageid: 1, title, revisions: [{ revid: revision, slots: { main: { "*": text } } }] } } } };
        const filename = title.replaceAll(" ", "_").replaceAll("/", "_") + (fixed ? "@" + revision : "") + ".json";
        await writeFile(path.join(fixture.stage, filename), JSON.stringify(data));
    }
    async function seed(generation) {
        async function writeCurrentPage(title, text) {
            if (!revisions.has(title)) revisions.set(title, 100 + revisions.size);
            await writePage(title, text, revisions.get(title) + generation * 1000);
        }
        const populations = [["United States", 300000000 + generation], ["Canada", 40000000 + generation]];
        if (generation > 1) populations.push(["Tuvalu", 10000]);
        await writeCurrentPage(POPULATION_PAGE, "Sovereign states and dependencies by population\n! Location\n! Population\n! Date\n" +
            populations.map(([name, value]) => `|-\n| {{flagdeco|${name}}}\n| {{n+p|${value}|1}} || {{dts|2025}}\n| Official estimate\n`).join(""));
        const borders = [["United States", ["Canada"]], ["Canada", generation > 1 ? ["United States", "Tuvalu"] : ["United States"]]];
        if (generation > 1) borders.push(["Tuvalu", []]);
        await writeCurrentPage(BORDER_PAGE, 'No. of distinct land neighbours; borders along lakes, rivers; man-made structures\n{| class="wikitable sortable col4center col5center"\n' +
            borders.map(([name, neighbors]) => `|-\n|{{flag|${name}}}\n|100\n|${neighbors.length}\n|${neighbors.length}\n|${neighbors.map(other => "{{flag|" + other + "}}").join("<br>")}\n`).join("") + "|}");
        await writeCurrentPage(CAPITAL_PAGE, "[[Funafuti]]\n'''{{flaglist|Tuvalu}}'''\nSource generation " + generation);
        for (const code of ["CAN", "USA"]) {
            const config = RANKINGS[code];
            const marker = code === "USA" ? "{{anchor|Table}}" : '{|class="wikitable sortable mw-datatable"';
            const cityRows = Array.from({ length: 100 }, (_, i) => {
                const name = code === "CAN" && i < 2 ? ["Calgary", "Ottawa"][i] : "City " + i;
                return `|-\n|${code === "CAN" ? "{{center|" + (i + 1) + "}}\n|" : ""}[[${name}]]\n|{{change|invert=on|${generation * 1000000 - i}|800}}\n|{{coord|40|N|70|W}}\n`;
            }).join("");
            await writeCurrentPage(config.title, config.required.join("\n") + "\n" + marker + "\n" + buildTableHeaders(config, String(2024 + generation)) + "\n" + cityRows + "|}");
            const flag = FLAGS[code];
            await writeCurrentPage(flag.title, "{{Infobox flag|Design=" + flag.words.join(" ") + "}}\nSource generation " + generation);
        }
        await writeCurrentPage("United States", "{{Infobox country|capital=[[Washington, D.C.]] {{coord|38|N|77|W}}}}\nSource generation " + generation);
        await writeCurrentPage("Canada", "{{Infobox country|capital=Ottawa|coordinates={{coord|45|N|75|W}}}}\nSource generation " + generation);
        for (const title of ["Ottawa", ...Array.from({ length: 8 }, (_, i) => "City " + (i + 2))]) {
            await writeCurrentPage(title, "{{Infobox settlement|coordinates={{coord|" + (40 + generation) + "|N|75|W}}}}");
        }
        for (const title of ["Calgary", "Funafuti"]) {
            const config = expanded.coordinates[title];
            await writePage(config.title, config.evidence.join("\n"), config.revision, true);
            await writeCurrentPage(config.title, "{{coord|1|N|1|E}}");
        }
    }
    return { ...fixture, seed };
}

async function savePrepared(root, result) {
    for (const file of result.files) await writeFile(path.join(root, file.path), file.content);
    return { facts: JSON.parse(result.files[0].content), manifest: JSON.parse(result.files[1].content) };
}

async function assertPinnedReplay(root, directory) {
    for (const scope of ["facts", "cities"]) {
        const result = await prepareFacts({ root, directory, scope, cacheOnly: true, pinned: true });
        for (const file of result.files) assert.equal(file.content, await readFile(path.join(root, file.path), "utf8"), scope + ": " + file.path);
    }
}

function createLegacyManifest(manifest) {
    const legacy = structuredClone(manifest);
    legacy.sources = {};
    const used = new Set();
    for (const scopes of Object.values(manifest.sourceSelections)) {
        for (const selected of Object.values(scopes)) {
            for (const [binding, key] of Object.entries(selected)) {
                assert.ok(!legacy.sources[binding] || legacy.sources[binding].revision === manifest.sources[key].revision, "Legacy fixture requires a uniform baseline");
                legacy.sources[binding] = manifest.sources[key];
                used.add(key);
            }
        }
    }
    for (const [key, value] of Object.entries(manifest.sources)) {
        if (!used.has(key)) legacy.sources[key] = value;
    }
    delete legacy.sourceSelections;
    delete legacy.conventions.sourceRevisions;
    return legacy;
}

test("scoped facts and cities preserve mixed revisions, null results, and fixed coordinates on offline replay", async () => {
    const { root, stage, seed } = await createSourceFixture();
    try {
        await seed(1);
        const original = await savePrepared(root, await prepareFacts({ root, directory: stage, scope: "facts", bootstrap: true, cacheOnly: true }));
        for (const value of Object.values(original.manifest.sources)) value.retrieved = "2000-01-01";
        await writeFile(path.join(root, SOURCES_PATH), JSON.stringify(original.manifest, null, 2) + "\n");
        assert.equal(original.facts.countries.TUV.population, null);
        assert.equal(original.facts.countries.TUV.borders, null);
        await assertPinnedReplay(root, stage);
        await writeFile(path.join(root, SOURCES_PATH), JSON.stringify(createLegacyManifest(original.manifest), null, 2) + "\n");
        await seed(2);
        const refreshedFacts = await savePrepared(root, await prepareFacts({ root, directory: stage, scope: "facts", country: "USA", cacheOnly: true }));
        for (const code of ["CAN", "TUV"]) {
            assert.deepEqual(refreshedFacts.facts.countries[code], original.facts.countries[code]);
            assert.deepEqual(refreshedFacts.manifest.sourceSelections[code], original.manifest.sourceSelections[code]);
        }
        assert.notEqual(refreshedFacts.facts.countries.USA.population.value, original.facts.countries.USA.population.value);
        const oldPopulation = selectedSource(original.manifest, "CAN", "facts", POPULATION_PAGE);
        const newPopulation = selectedSource(refreshedFacts.manifest, "USA", "facts", POPULATION_PAGE);
        assert.notEqual(oldPopulation.revision, newPopulation.revision);
        for (const [key, value] of Object.entries(original.manifest.sources)) assert.deepEqual(refreshedFacts.manifest.sources[key], value);
        await assertPinnedReplay(root, stage);
        for (const code of ["USA", "CAN"]) {
            const refreshedCities = await savePrepared(root, await prepareFacts({ root, directory: stage, scope: "cities", country: code, cacheOnly: true }));
            assert.deepEqual(refreshedCities.facts.countries.CAN.population, original.facts.countries.CAN.population);
            assert.deepEqual(refreshedCities.manifest.sourceSelections.CAN.facts, original.manifest.sourceSelections.CAN.facts);
            assert.deepEqual(refreshedCities.facts.countries.TUV, original.facts.countries.TUV);
            assert.notEqual(selectedSource(refreshedCities.manifest, code, "cities", CAPITAL_PAGE).revision,
                selectedSource(refreshedCities.manifest, "TUV", "cities", CAPITAL_PAGE).revision);
            if (code === "USA") assert.deepEqual(refreshedCities.facts.countries.CAN, original.facts.countries.CAN);
            const calgary = refreshedCities.facts.countries.CAN.cities.find(city => city.name === "Calgary");
            assert.deepEqual(calgary.coordinateSource, original.facts.countries.CAN.cities.find(city => city.name === "Calgary").coordinateSource);
            assert.equal(calgary.coordinateSource.revision, 932920739);
            await assertPinnedReplay(root, stage);
        }
        const known = await savePrepared(root, await prepareFacts({ root, directory: stage, scope: "facts", country: "TUV", cacheOnly: true }));
        assert.equal(known.facts.countries.TUV.population.value, 10000);
        assert.deepEqual(known.facts.countries.TUV.borders.codes, []);
        assert.deepEqual(known.manifest.sourceSelections.TUV.cities, original.manifest.sourceSelections.TUV.cities);
        await assertPinnedReplay(root, stage);
        const corrupt = path.join(stage, POPULATION_PAGE.replaceAll(" ", "_") + "@" + oldPopulation.revision + ".json");
        await writeFile(corrupt, (await readFile(corrupt, "utf8")).replace("40000001", "99999999"));
        await assert.rejects(prepareFacts({ root, directory: stage, scope: "facts", country: "CAN", cacheOnly: true, pinned: true }), /checksum changed/);
        delete known.manifest.sourceSelections.CAN.facts[POPULATION_PAGE];
        assert.throws(() => selectedSource(known.manifest, "CAN", "facts", POPULATION_PAGE), /missing pinned source selection/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("legacy provenance migration preserves all metadata, citations, and historical bindings", async () => {
    const facts = JSON.parse(await readFile(path.join(ROOT, FACTS_PATH), "utf8"));
    let manifest = JSON.parse(await readFile(path.join(ROOT, SOURCES_PATH), "utf8"));
    const originalFacts = structuredClone(facts);
    const originalSources = structuredClone(manifest.sources);
    if (manifest.sourceSelections) manifest = createLegacyManifest(manifest);
    migrateSources(manifest, facts);
    validateSources(manifest, facts);
    assert.deepEqual(facts, originalFacts);
    for (const value of Object.values(originalSources)) assert.deepEqual(manifest.sources[revisionKey(value.title, value.revision)], value);
    assert.equal(selectedSource(manifest, "CAN", "cities", "Calgary", 932920739).revision, 932920739);
    assert.equal(selectedSource(manifest, "PHL", "cities", "Manila", 334939472).revision, 334939472);
    const expanded = await readExpandedMappings();
    for (const [code, entry] of Object.entries(facts.countries)) {
        if (!entry.population) assert.ok(selectedSource(manifest, code, "facts", POPULATION_PAGE));
        if (!entry.borders) assert.ok(selectedSource(manifest, code, "facts", BORDER_PAGE));
        assert.ok(selectedSource(manifest, code, "cities", CAPITAL_PAGE));
        if (FLAGS[code]) assert.ok(selectedSource(manifest, code, "facts", FLAGS[code].title));
        const ranking = RANKINGS[code] || MUNICIPAL_TABLES[code];
        if (ranking) assert.ok(selectedSource(manifest, code, "cities", ranking.title));
        for (const capital of CAPITALS[code] || []) {
            if (capital.name !== "Bonn") assert.ok(selectedSource(manifest, code, "cities", capital.title));
        }
        const ranked = entry.cities.filter(city => city.rank);
        const mapped = new Set([...ranked.map(city => city.name), ...(CAPITALS[code] || []).map(city => city.name)]);
        for (const city of ranked) {
            if (code === "CAN" && city.name !== "Calgary") assert.ok(selectedSource(manifest, code, "cities", city.coordinateSource.title));
            if (code === "CAN" && city.name === "Calgary" || MUNICIPAL_TABLES[code]) {
                const value = city.coordinateSource;
                assert.ok(selectedSource(manifest, code, "cities", value.title, value.revision));
            }
        }
        for (const capital of expanded.capitals.filter(item => item.code === code)) {
            if (capital.sourceTitle) assert.ok(selectedSource(manifest, code, "cities", capital.sourceTitle));
            if (!mapped.has(capital.name)) {
                const config = expanded.coordinates[capital.coordinateTitle || capital.title];
                assert.ok(selectedSource(manifest, code, "cities", config.title, config.revision));
                mapped.add(capital.name);
            }
        }
    }
    const bytes = JSON.stringify(manifest);
    migrateSources(manifest, facts);
    assert.equal(JSON.stringify(manifest), bytes);
    const broken = structuredClone(manifest);
    delete broken.sources[revisionKey(facts.countries.USA.population.source.title, facts.countries.USA.population.source.revision)];
    assert.throws(() => validateSources(broken, facts), /Invalid source binding/);
});

function createMunicipalFixture(code, year = "2025") {
    const config = MUNICIPAL_TABLES[code];
    const body = Array.from({ length: config.minRows }, (_, i) => {
        const city = `[[City ${i}]]`;
        let fields;
        if (code === "ITA") fields = [String(i + 1), city, `{{change|${1000000 - i}|${2000000 - i}}}`, "[[Region]]"];
        else if (code === "BRA") fields = [city, "[[State]]", `{{change|invert=on|${2000000 - i}|${1000000 - i}}}`];
        else {
            fields = config.headers.map(() => "0");
            fields[config.cityColumn] = city;
            fields[config.populationColumn] = String(2000000 - i);
        }
        return "|-\n| " + fields.join(" || ");
    }).join("\n");
    const declaration = config.yearDeclaration?.replaceAll("{year}", year) || "";
    let text = config.required.join("\n") + "\n" + (config.sectionMarker || "") + "\n" + declaration + "\n" + config.marker + "\n" + buildTableHeaders(config, year) + "\n" + body + "\n|}";
    if (code === "FRA") {
        text += '\n==Overseas and sui generis collectivities, and Mayotte==\n{| class="wikitable sortable"\n!Commune!!Collectivity!!Population!!Rank\n';
        text += Array.from({ length: 10 }, (_, i) => `|-\n| [[Overseas ${i}]] || [[Territory]] || 1000 || ${i + 1}\n`).join("") + "|}";
    }
    return { title: config.title, revision: 123, text };
}

test("arguments reject unsupported scopes, duplicates, and missing values", () => {
    assert.deepEqual(parseArguments(["--scope", "facts", "--country", "CAN"]), { scope: "facts", country: "CAN" });
    for (const args of [[], ["--scope", "all"], ["--scope", "facts", "--scope", "cities"], ["--country"], ["--scope", "cities", "--country", "../CAN"]]) {
        assert.throws(() => parseArguments(args));
    }
});

test("wikitext templates preserve nested fields and reject changed structure", () => {
    assert.deepEqual(splitFields("a|{{b|c}}|[[d|e]]"), ["a", "{{b|c}}", "[[d|e]]"]);
    assert.equal(infobox("{{Infobox country|capital=[[Ottawa]]|population={{formatnum:12}}}}", "Infobox country").capital, "[[Ottawa]]");
    assert.throws(() => splitFields("a|{{b|c}"));
    assert.throws(() => oneTemplate("{{coord|1|2}}{{coord|3|4}}", "coord"));
    assert.throws(() => number("12 million"));
    assert.equal(number("1,234"), 1234);
});

test("coordinates use explicit Wikipedia values, never implicit Wikidata", () => {
    assert.deepEqual(coordinates("{{Coord|45|25|N|75|42|W}}"), { latitude: 45.416667, longitude: -75.7 });
    assert.deepEqual(coordinates("{{coord|-33.5|18.4|display=title}}"), { latitude: -33.5, longitude: 18.4 });
    assert.throws(() => coordinates("{{coord|type:city|display=title}}"));
    assert.throws(() => coordinates("{{coord|95|N|20|E}}"));
    assert.deepEqual(coordinates("{{coordinates|45|N|75|W}}"), { latitude: 45, longitude: -75 });
});

test("municipal columns preserve nested links and reject changed layouts", () => {
    assert.deepEqual(cells("| [[Rome]] || style=\"text-align:right\" | {{change|1|2}}").map(cellText), ["Rome", "{{change|1|2}}"]);
    const page = createMunicipalFixture("ITA");
    assert.equal(parseMunicipalTable(page, "ITA")[0].population.value, 2000000);
    assert.equal(parseMunicipalTable(page, "ITA")[0].population.year, "2025");
    assert.throws(() => parseMunicipalTable({ ...page, text: page.text.replace("!2025 estimate", "!2025/2026 estimate") }, "ITA"), /layout/);
    assert.throws(() => parseMunicipalTable({ ...page, text: page.text.replace("{{change|1000000|2000000}}", "{{change|invert=on|1000000|2000000}}") }, "ITA"), /order/);
});

test("all municipal mappings accept year rollovers and update definition notes", () => {
    for (const code of Object.keys(MUNICIPAL_TABLES)) {
        const original = createMunicipalFixture(code);
        const next = { ...original, text: original.text.replaceAll("2025", "2026") };
        assert.equal(parseMunicipalTable(original, code)[0].population.year, "2025", code);
        const cities = parseMunicipalTable(next, code);
        assert.ok(cities.every(city => city.population.year === "2026"), code);
        assert.match(cities[0].definition, /2026/, code);
        assert.throws(() => parseMunicipalTable({ ...next, text: next.text.replaceAll(MUNICIPAL_TABLES[code].required[0], "Changed urban-area definition") }, code), /definition/, code);
    }
    const spain = createMunicipalFixture("ESP");
    assert.throws(() => parseMunicipalTable({ ...spain, text: spain.text.replace("as of 2025.", "as of 2025 or 2026.") }, "ESP"), /year declaration/);
    assert.throws(() => parseMunicipalTable({ ...spain, text: spain.text.replace("!Population", "!Population\n!Population") }, "ESP"), /layout/);
    const declaration = MUNICIPAL_TABLES.ESP.yearDeclaration.replaceAll("{year}", "2025");
    assert.throws(() => parseMunicipalTable({ ...spain, text: spain.text.replace(declaration, declaration + "\n" + declaration.replace("2025", "2026")) }, "ESP"), /year declaration/);
});

test("population extraction is field-based and fails changed dates/definitions", () => {
    const page = {
        title: "Fixture", revision: 123,
        text: "Sovereign states and dependencies by population\n! Location\n! Population\n! Date\n|-\n| {{Flagdeco|Canada}}\n| {{n+p|40000000|{{worldpop}}}} || {{dts|1 July 2024}}\n| Official estimate<ref>citation</ref>",
    };
    assert.equal(parsePopulation(page, "Canada").value, 40000000);
    assert.equal(parsePopulation(page, "Canada").year, "1 July 2024");
    assert.equal(parsePopulation(page, "France"), null);
    assert.throws(() => parsePopulation({ ...page, text: page.text.replace("1 July 2024", "recent") }, "Canada"));
    assert.throws(() => parsePopulation({ ...page, text: page.text.replace("Official estimate", "Unreviewed definition") }, "Canada"));
});

test("US rankings accept a new header year but reject ambiguous or changed schemas", () => {
    const header = RANKINGS.USA.required.join("\n") + "\nIntroduction last updated in 2025.\n{{anchor|Table}}\n" + buildTableHeaders(RANKINGS.USA, "2025") + "\n";
    const cityRows = Array.from({ length: 100 }, (_, i) => `|-\n| [[City ${i}]]\n| {{change|invert=on|${1000 - i}|800}}\n| {{coord|40|N|70|W}}\n`).join("");
    const page = { title: "Fixture", revision: 123, text: header + cityRows + "|}" };
    assert.equal(parseRanking(page, "USA")[9].population.value, 991);
    const next = parseRanking({ ...page, text: page.text.replace("!2025 estimate", "!2026 estimate") }, "USA");
    assert.ok(next.every(city => city.population.year === "2026"));
    assert.match(rankingNote(RANKINGS.USA, next[0].population.year), /2026 estimates/);
    for (const replacement of ["!2025/2026 estimate", "!estimate", "!2025 estimate\n!2026 estimate", "!2026 urban population"]) {
        assert.throws(() => parseRanking({ ...page, text: page.text.replace("!2025 estimate", replacement) }, "USA"), /layout/);
    }
    assert.throws(() => parseRanking({ ...page, text: page.text.replace("!Municipality", "!Urban agglomeration") }, "USA"), /layout/);
    assert.throws(() => parseRanking({ ...page, text: header + cityRows.slice(0, 1000) + "|}" }, "USA"));
    assert.throws(() => parseRanking({ ...page, text: page.text.replace("|999|800", "|1001|800") }, "USA"), /population order/);
});

test("Canadian and German census/estimate years follow their validated headers", () => {
    for (const [code, count, marker] of [
        ["CAN", 100, '{|class="wikitable sortable mw-datatable"'],
        ["DEU", 80, '{| class="wikitable sortable"'],
    ]) {
        const config = RANKINGS[code];
        const body = Array.from({ length: count }, (_, i) =>
            `|-\n|${code === "CAN" ? "{{center|" + (i + 1) + "}}" : i + 1}\n|${code === "CAN" ? "[[City " + i + "]]" : "{{flag|City " + i + "}}"}\n|{{change|invert=on|${10000 - i}|8000}}\n|{{coord|40|N|70|W}}\n`).join("");
        const page = { title: config.title, revision: 123, text: config.required.join("\n") + "\n" + marker + "\n|-\n" + buildTableHeaders(config, "2025") + "\n" + body + "|}" };
        assert.equal(parseRanking(page, code)[0].population.year, "2025");
        assert.equal(parseRanking({ ...page, text: page.text.replaceAll("2025", "2026") }, code)[0].population.year, "2026");
        const population = code === "CAN" ? "!Population (2025)" : "!2025 estimate";
        assert.throws(() => parseRanking({ ...page, text: page.text.replace(population, population.replace("2025", "2026")) }, code), /years disagree/);
        assert.throws(() => parseRanking({ ...page, text: page.text.replace(population, population.replace("2025", "2025/2026")) }, code), /layout/);
        const previousColumn = config.previousPopulationColumns[0];
        const previous = "!" + config.headers[previousColumn].replaceAll("{year}", String(2000 - previousColumn));
        assert.throws(() => parseRanking({ ...page, text: page.text.replace(previous, population) }, code), /ambiguous/);
    }
    assert.match(rankingNote(RANKINGS.CAN, "2026"), /^2026 census/);
    assert.match(rankingNote(RANKINGS.CAN, "2026"), /pinned 2019/);
});

test("refresh summaries report changed city observation years", () => {
    const previous = { countries: { USA: { population: null, cityCoverage: { status: "complete" }, cities: [{ id: "USA:city", name: "City", rank: 1, population: { value: 100, year: "2025" } }] } } };
    const facts = structuredClone(previous);
    facts.countries.USA.cities[0].population.year = "2026";
    const manifest = { sources: {}, coverage: { population: 0, borders: 0, flags: 0, completeRankings: ["USA"] } };
    assert.ok(summarize(previous, facts, manifest, manifest).some(line => line.includes("City population year 2025 → 2026")));
});

test("border facts retain territory distinctions and unknown rows", () => {
    const page = {
        title: "Fixture", revision: 123,
        text: 'No. of distinct land neighbours; borders along lakes, rivers; man-made structures\n{| class="wikitable sortable col4center col5center"\n|-\n|{{flag|Canada}}\n|{{convert|100|km}}\n|2\n|2\n|{{flag|United States}}<br>{{flag|Greenland}}\n|}',
    };
    assert.deepEqual(parseBorders(page, "Canada", new Set(["CAN", "USA", "GRL"])).codes, ["GRL", "USA"]);
    assert.equal(parseBorders(page, "Canada", new Set(["CAN", "USA"])), null);
    assert.equal(parseBorders(page, "Nepal", new Set(["NPL"])), null);
});

test("transaction rolls back partial writes and preserves unchanged bytes", async () => {
    const first = "games/world-map/data/first.json";
    const second = "games/world-map/data/second.json";
    const { root, stage } = await createFixture("rollback", { [first]: "old", [second]: "old" });
    try {
        const files = [{ path: first, content: "new" }, { path: second, content: "new" }];
        await assert.rejects(applyTransaction(root, stage, files, { beforeRename(file, index) {
            if (index === 1) throw new Error("Injected write failure");
        } }), /Injected write failure/);
        assert.equal(await readFile(path.join(root, first), "utf8"), "old");
        assert.equal(await readFile(path.join(root, second), "utf8"), "old");
        assert.deepEqual(await applyTransaction(root, stage, [{ path: first, content: "old" }]), []);
        const staged = () => "A  " + first + "\0";
        assert.throws(() => assertClean(root, [first], staged), /local edits/);
        await assert.rejects(applyTransaction(root, stage, [{ path: "../escape", content: "bad" }]), /Unsafe/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("CLI refresh rejects untracked and ignored snapshots before preparing", async () => {
    const first = "games/world-map/data/facts.json";
    const second = "games/world-map/data/source-facts.json";
    const { root } = await createFixture("untracked", { [first]: "local facts", [second]: "local provenance" }, false);
    try {
        await assert.rejects(update({ root, scope: "facts" }), /local edits/);
        await writeFile(path.join(root, ".gitignore"), "games/world-map/data/\n");
        await assert.rejects(update({ root, scope: "facts" }), /local edits/);
        assert.equal(await readFile(path.join(root, first), "utf8"), "local facts");
        assert.equal(await readFile(path.join(root, second), "utf8"), "local provenance");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

for (const scope of ["atlas", "capitals"]) test(scope + " refresh protects both snapshots before any downloads", async () => {
    const originals = { [GEOGRID_PATH]: "atlas fixture", [GEOGRID_SOURCES_PATH]: "source fixture" };
    const { root } = await createFixture(scope + "-protection", originals, false);
    try {
        assert.deepEqual(parseArguments(["--scope", scope]), { scope });
        assert.throws(() => parseArguments(["--scope", scope, "--country", "USA"]), /all countries/);
        await assert.rejects(update({ root, scope, country: "USA" }), /all countries/);
        await assert.rejects(update({ root, scope }), /local edits/);
        await writeFile(path.join(root, ".gitignore"), "games/world-map/data/\n");
        await assert.rejects(update({ root, scope }), /local edits/);
        await rm(path.join(root, ".gitignore"));
        commitFixture(root, Object.keys(originals));
        for (const [file, content] of Object.entries(originals)) {
            await writeFile(path.join(root, file), "local edit");
            await assert.rejects(update({ root, scope }), /local edits/);
            execFileSync("git", ["-C", root, "add", "--", file]);
            await assert.rejects(update({ root, scope }), /local edits/);
            assert.equal(await readFile(path.join(root, file), "utf8"), "local edit");
            await writeFile(path.join(root, file), content);
            execFileSync("git", ["-C", root, "add", "--", file]);
        }
        for (const [file, content] of Object.entries(originals)) assert.equal(await readFile(path.join(root, file), "utf8"), content);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("image refresh protects custom-set assets before preparation and application", async () => {
    const manifestPath = "games/world-map/data/image-sets.json";
    const asset = "games/world-map/img/custom/usa.png";
    const manifest = JSON.stringify({ version: 1, sets: [
        { id: "flags", images: {} },
        { id: "custom", images: { USA: { src: "img/custom/usa.png" } } },
    ] });
    const { root, stage } = await createFixture("custom-images", { [manifestPath]: manifest, [asset]: "original" });
    try {
        const baseline = await captureImageTargets(root);
        assert.ok(baseline.targets.includes(asset));
        assert.ok(baseline.targets.includes("games/world-map/img/flags"));
        assert.equal(baseline.files.get(asset).toString(), "original");
        await writeFile(path.join(root, asset), "local edit");
        await assert.rejects(update({ root, scope: "images", country: "USA" }), /local edits/);
        commitFixture(root, [asset]);
        await assert.rejects(applyTransaction(root, stage, [{ path: asset, content: "downloaded" }], { baseline }), /changed while preparing/);
        assert.equal(await readFile(path.join(root, asset), "utf8"), "local edit");
        execFileSync("git", ["-C", root, "rm", "--cached", "--quiet", "--", asset]);
        commitFixture(root, [manifestPath]);
        await assert.rejects(update({ root, scope: "images" }), /local edits/);
        await writeFile(path.join(root, ".gitignore"), "games/world-map/img/custom/\n");
        await assert.rejects(update({ root, scope: "images" }), /local edits/);
        assert.equal(await readFile(path.join(root, asset), "utf8"), "local edit");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("image target discovery rejects invalid manifest paths before reading assets", async () => {
    const manifestPath = "games/world-map/data/image-sets.json";
    const manifest = JSON.stringify({ version: 1, sets: [{ id: "custom", images: { USA: { src: "../outside.png" } } }] });
    const { root } = await createFixture("unsafe-images", { [manifestPath]: manifest });
    try {
        await assert.rejects(update({ root, scope: "images" }), /Invalid image path/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("rollback preserves concurrent edits and retains recovery backups", async () => {
    const first = "games/world-map/data/first.json";
    const second = "games/world-map/data/second.json";
    const { root, stage } = await createFixture("rollback-race", { [first]: "old", [second]: "old" });
    try {
        const files = [{ path: first, content: "new" }, { path: second, content: "new" }];
        await assert.rejects(applyTransaction(root, stage, files, { async beforeRename(file, index) {
            if (index === 1) {
                assert.equal(await readFile(path.join(root, first), "utf8"), "new");
                await writeFile(path.join(root, first), "concurrent edit");
                throw new Error("Injected failure");
            }
        } }), error => {
            assert.match(error.message, /Injected failure; rollback failed:/);
            assert.ok(error.message.includes(first));
            assert.match(error.message, /preserving the current file/);
            assert.ok(error.message.includes("Recovery files retained in " + stage));
            assert.equal(error.recoveryDirectory, stage);
            return true;
        });
        assert.equal(await readFile(path.join(root, first), "utf8"), "concurrent edit");
        assert.equal(await readFile(path.join(root, second), "utf8"), "old");
        assert.equal(await readFile(path.join(stage, "backup-0"), "utf8"), "old");
        assert.equal(await readFile(path.join(stage, "backup-1"), "utf8"), "old");
        const transaction = JSON.parse(await readFile(path.join(stage, "transaction.json"), "utf8"));
        assert.deepEqual(transaction, [{ path: first, backup: "backup-0" }, { path: second, backup: "backup-1" }]);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("preparation baseline detects edits even when committed before application", async () => {
    const first = "games/world-map/data/first.json";
    const second = "games/world-map/data/second.json";
    const { root, stage } = await createFixture("preparation-race", { [first]: "old", [second]: "old" });
    try {
        const baseline = await captureTargets(root, [first, second]);
        await writeFile(path.join(root, first), "edited while downloading");
        commitFixture(root, [first]);
        assertClean(root, [first, second]);
        const files = [{ path: first, content: "old" }, { path: second, content: "new" }];
        await assert.rejects(applyTransaction(root, stage, files, { baseline }), /changed while preparing/);
        assert.equal(await readFile(path.join(root, first), "utf8"), "edited while downloading");
        assert.equal(await readFile(path.join(root, second), "utf8"), "old");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("directory baseline detects new files committed during preparation", async () => {
    const first = "games/world-map/img/flags/usa.svg";
    const added = "games/world-map/img/flags/can.svg";
    const { root, stage } = await createFixture("new-target-race", { [first]: "old" });
    try {
        const baseline = await captureTargets(root, ["games/world-map/img/flags"]);
        await writeFile(path.join(root, added), "local new asset");
        commitFixture(root, [added]);
        assertClean(root, baseline.targets);
        await assert.rejects(applyTransaction(root, stage, [{ path: first, content: "new" }], { baseline }), /changed while preparing/);
        assert.equal(await readFile(path.join(root, first), "utf8"), "old");
        assert.equal(await readFile(path.join(root, added), "utf8"), "local new asset");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("bootstrap only creates absent snapshots and cannot bypass local edits", async () => {
    const file = "games/world-map/data/facts.json";
    const { root, stage } = await createFixture("bootstrap", {}, false);
    try {
        const baseline = await captureTargets(root, [file]);
        assert.deepEqual(await applyTransaction(root, stage, [{ path: file, content: "initial" }], { baseline, bootstrap: true }), [file]);
        await assert.rejects(update({ root, scope: "facts", bootstrap: true }), /requires absent/);
        await assert.rejects(applyTransaction(root, stage, [{ path: file, content: "replacement" }], { bootstrap: true }), /requires absent/);
        assert.equal(await readFile(path.join(root, file), "utf8"), "initial");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("bundled facts validate against the bundled geography", async () => {
    const world = JSON.parse(await readFile(path.join(ROOT, "games/world-map/data/world.json"), "utf8"));
    const facts = JSON.parse(await readFile(path.join(ROOT, "games/world-map/data/facts.json"), "utf8"));
    const codes = new Set(world.objects.countries.geometries.map(country => country.id));
    validateFacts(facts, codes);
    assert.equal(facts.countries.USA.cities.filter(city => city.rank).length, 10);
    assert.equal(facts.countries.DEU.cities.filter(city => city.rank).length, 10);
    assert.equal(facts.countries.ZAF.cities.filter(city => city.capitalRoles.length).length, 3);
    assert.equal(facts.countries.CAN.cityCoverage.status, "complete");
    const calgary = facts.countries.CAN.cities.find(city => city.name === "Calgary");
    assert.equal(calgary.rank, 3);
    assert.equal(calgary.coordinateSource.revision, 932920739);
    assert.equal(calgary.latitude, 51.05);
    assert.equal(facts.countries.PSE.cities.filter(city => city.capitalRoles.length).length, 2);
    for (const code of ["AUT", "BRA", "CAN", "DEU", "ESP", "FRA", "ITA", "POL", "ROU", "USA"]) {
        assert.equal(facts.countries[code].cityCoverage.status, "complete");
        assert.deepEqual(facts.countries[code].cities.filter(city => city.rank).map(city => city.rank).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        assert.ok(!facts.countries[code].cityCoverage.note.includes("{year}"));
        assert.ok(facts.countries[code].cities.every(city => !city.definition?.includes("{year}")));
    }
    assert.equal(facts.countries.JPN.cityCoverage.audit, "reviewed-not-imported");
    assert.equal(facts.countries.KOR.cityCoverage.audit, "not-yet-audited");
    const manifest = JSON.parse(await readFile(path.join(ROOT, "games/world-map/data/source-facts.json"), "utf8"));
    assert.equal(manifest.coverage.sovereignCapitals.mappable, 194);
    assert.equal(manifest.coverage.sovereignCapitals.mapped, 194);
    assert.deepEqual(manifest.coverage.sovereignCapitals.missing, []);
    assert.deepEqual(manifest.coverage.sovereignCapitals.absentFromGeography, ["TUV"]);
    const broken = structuredClone(facts);
    broken.countries.USA.cities[0].population.year = "recent";
    assert.throws(() => validateFacts(broken, codes), /population/);
});
