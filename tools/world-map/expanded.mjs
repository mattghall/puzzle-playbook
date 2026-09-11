import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { oneTemplate, requireText, rows, source } from "./wikipedia.mjs";
import { articleLink, cellNumber, cells, rankingNote, rankingYear, tableBody } from "./tables.mjs";

export const MUNICIPAL_TABLES = {
    FRA: {
        title: "List of communes in France with over 20,000 inhabitants", section: "List",
        marker: '{| class="wikitable sortable sticky-header"', cityColumn: 0, populationColumn: 5, minRows: 482,
        matchingYearColumns: [6], previousPopulationColumns: [3, 4],
        headers: ["Commune", "Department", "Region", "Population, {year}", "Population, {year}", "Population, {year}", "Rank, {year}"],
        required: ["All figures reflect the municipal population", "usual residence in the commune"],
        note: "{year} municipal populations, not urban areas. The full main table is audited. Mayotte and overseas collectivities use separate observation dates, all below this top-ten cutoff; their dates aren't mixed into the ranked records.",
    },
    ITA: {
        title: "List of cities in Italy", section: "List of cities",
        marker: '{| class="wikitable sortable defaultright col1center col2left col6left"', cityColumn: 1, changeIndex: 1, minRows: 136,
        populationHeading: 3, previousPopulationColumns: [2],
        headers: ["Rank", "City", "{year} census", "{year} estimate", "Change", "Region"],
        required: ["Italian municipalities", "population over 50,000"],
        note: "Municipalities (comuni) over 50,000, {year} estimates. Not metropolitan populations.",
    },
    ESP: {
        title: "Ranked lists of Spanish municipalities", section: "By population",
        sectionMarker: "==By population==",
        yearDeclaration: "This list ranks the 100 most populous municipalities as of {year}.",
        marker: '{| class="static-row-numbers plainrowheaders vertical-align-top sticky-header-multi sort-under sortable wikitable"', cityColumn: 0, populationColumn: 2, minRows: 100,
        headers: ["Municipality", "Province", "Population"],
        required: ["100 most populous municipalities"],
        note: "The 100 most populous municipalities, {year}. Includes each whole municipality, not its metropolitan area.",
    },
    BRA: {
        title: "List of municipalities in Brazil by population", section: "Most populous cities in Brazil",
        marker: '{| class="wikitable sortable mw-datatable static-row-numbers"', cityColumn: 0, changeIndex: 0, minRows: 338,
        populationHeading: 2, previousPopulationColumns: [3],
        headers: ["Municipality", "State", "{year} estimate", "{year} census", "Change"],
        required: ["rather than its metropolitan area", "entire Federal District synonymous to Brasília"],
        note: "Municipal populations, {year} estimates, not metropolitan areas. Wikipedia/IBGE treat the whole Federal District as Brasília; that administrative exception is retained.",
    },
    POL: {
        title: "List of cities and towns in Poland", section: "Most populated cities and towns",
        marker: '{| class="wikitable sortable"  style="margin:auto;"', cityColumn: 0, populationColumn: 2, minRows: 83,
        previousPopulationColumns: [3, 4, 5, 6, 7, 8, 9, 10],
        headers: ["Name", "Voivodeship", "30 Jun {year}", "1 Jan {year}", "30 June {year}", "Dec. {year}", "{year}", "{year}", "{year}", "{year}", "{year}", "Change {year} – {year}"],
        required: ["standalone as an urban gmina", "|+Population at various dates"],
        note: "City administrative populations, {year}, from Wikipedia's full most-populated-cities table. Not the article's separate metropolitan-area estimates.",
    },
    ROU: {
        title: "List of cities and towns in Romania", section: "Complete list",
        marker: '{|class="sortable wikitable"', cityColumn: 0, populationColumn: 2, minRows: 319,
        previousPopulationColumns: [3, 4],
        headers: ["City", "County", "Population ({year})", "Population ({year})", "Population ({year})", "Elevation (m)", "Year status granted (a) or first attested (b)", "Image"],
        required: ["status of ''[[municipiu]]''", "== Complete list =="],
        note: "{year} census populations for administrative cities/towns (municipiu and oraș). The complete list is audited; no metropolitan counts.",
    },
    AUT: {
        title: "List of cities and towns in Austria", section: "List of largest cities by population",
        marker: '{|class="wikitable sortable sticky-header" style="text-align:right"', cityColumn: 0, populationColumn: 2, minRows: 20,
        headers: ["Name", "Federal state", "Population ({year})"],
        required: ["independent [[municipality (Austria)|municipality]]", "==List of largest cities by population=="],
        note: "{year} administrative-city populations from the article's largest-cities table. Other state-level tables with different years aren't combined with it.",
    },
};

export const RANKING_AUDITS = {
    AUS: "Audited: prominent tables use significant urban areas, urban centers, or local-government areas that aren't comparable city-proper units. No ranking imported.",
    CHN: "Audited: city definitions include extensive prefecture-level administrative areas and urban-area measures. No comparable city-proper ranking approved.",
    GBR: "Audited: legal city status is not a comparable municipal population definition; London and other city boundaries differ. No ranking imported.",
    JPN: "Audited: the city list mixes Tokyo's combined special wards with individual wards and omits common population observation dates. No ranking imported.",
    CHE: "Audited: town-proper populations are transcluded from canton population templates; those revisions haven't been audited. No ranking imported.",
    PRT: "Audited: legal cities and municipality boundaries don't consistently coincide. No comparable dated city-proper ranking approved.",
    IND: "Audited source availability; administrative-city census table exists, but boundary exceptions and all required city coordinates haven't been reviewed. Not imported.",
};

export function parseMunicipalTable(page, code) {
    const config = MUNICIPAL_TABLES[code];
    requireText(page.text, config.required, page.title);
    const text = config.sectionMarker ? page.text.split(config.sectionMarker)[1]?.split("\n==")[0] : page.text;
    if (!text) throw new Error(page.title + ": source section missing");
    const table = tableBody(text, config.marker);
    const year = rankingYear(table, config, text, page.title);
    const records = rows(table).filter(row => row.trim().startsWith("|") && !row.trim().startsWith("|+")).map(row => {
        const fields = cells(row.trim());
        const link = articleLink(fields[config.cityColumn] || "");
        if (!link) throw new Error(page.title + ": unrecognized municipality row");
        let population;
        if (config.changeIndex !== undefined) {
            const fields = oneTemplate(row, "change").slice(1);
            if (fields.includes("invert=on") !== (code === "BRA")) throw new Error(page.title + ": population template order changed");
            const values = fields.filter(value => !value.includes("="));
            if (values.length !== 2) throw new Error(page.title + ": changed population template");
            population = cellNumber(values[config.changeIndex]);
        } else population = cellNumber(fields[config.populationColumn] || "");
        return { ...link, population, row };
    });
    if (records.length < config.minRows) throw new Error(page.title + ": source table lost coverage");
    if (new Set(records.map(city => city.title)).size !== records.length) throw new Error(page.title + ": duplicate municipality");
    records.sort((a, b) => b.population - a.population || a.title.localeCompare(b.title));
    if (code === "FRA") {
        const overseas = page.text.split("==Overseas and sui generis collectivities, and Mayotte==")[1];
        if (!overseas) throw new Error("France: overseas coverage section missing");
        const body = tableBody(overseas, '{| class="wikitable sortable"');
        const other = rows(body).filter(row => row.trim().startsWith("|")).map(row => cellNumber(cells(row.trim())[2]));
        if (other.length < 10 || Math.max(...other) >= records[9].population) throw new Error("France: overseas top-ten eligibility needs review");
    }
    return records.map((city, index) => ({
        title: city.title, name: city.name, rank: index + 1,
        population: { value: city.population, year, source: source(page, config.section) },
        definition: rankingNote(config, year),
    }));
}

export async function readExpandedMappings() {
    return JSON.parse(await readFile(fileURLToPath(new URL("./expanded-sources.json", import.meta.url)), "utf8"));
}
