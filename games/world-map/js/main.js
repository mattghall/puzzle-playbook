import "../style/style.css";
import { feature, neighbors } from "topojson-client";
import { colorNeighbors, getCountryId, listCities } from "./model.mjs";
import { compileAtlasQuery, createAtlas } from "./atlas.mjs";
import { createCriteriaControls } from "./criteria.mjs";
import { createCalloutLayer } from "./callout-layer.mjs";
import { createMap } from "./map.mjs";
import { buildImageAtlas, getAssetUrl, loadTerrain, validateImageSets } from "./imagery.mjs";
import { countryTimeZoneColor, countryTimeZoneLabel, listTimeZones, timeZoneColor } from "./timezones.mjs";

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");
const COUNTRY_COLORS = { match: "#8fbd78", nonmatch: "#e0e3e4", unknown: "#d9bc86", outside: "#b9b2c8" };
const RESULT_LABELS = { match: "Match", nonmatch: "No", unknown: "Unknown", outside: "Outside GeoGrid" };

function getElement(id) {
    return document.getElementById(id);
}

function makeElement(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
}

function showError(error) {
    getElement("map-error").textContent = error.message;
    getElement("map-error").hidden = false;
    getElement("map-status").textContent = "";
    console.error(error);
}

async function loadJson(file) {
    const response = await fetch("/category-map/data/" + file);
    if (!response.ok) throw new Error("Couldn't load " + file + " (" + response.status + ")");
    return response.json();
}

function appendSource(parent, source, label = "Source") {
    if (!source?.url) return;
    const url = new URL(source.url);
    if (url.protocol === "http:") url.protocol = "https:";
    if (url.protocol !== "https:") throw new Error("Invalid source URL");
    const link = makeElement("a", label);
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener";
    if (source.title) link.title = source.title;
    parent.append(link);
}

function addFact(list, label, value, source) {
    list.append(makeElement("dt", label));
    const description = makeElement("dd", value);
    if (source) {
        description.append(document.createTextNode(" "));
        appendSource(description, source);
    }
    list.append(description);
}

async function initialize() {
    const [world, facts, imageSets, layers, geogrid] = await Promise.all([
        loadJson("world.json"), loadJson("facts.json"), loadJson("image-sets.json"), loadJson("layers.json"),
        loadJson("geogrid.json"),
    ]);
    if (!world.objects?.countries || facts.version !== 1 || !facts.countries ||
        imageSets.version !== 1 || !imageSets.sets?.length) {
        throw new Error("Invalid map data");
    }
    const countries = feature(world, world.objects.countries).features;
    validateImageSets(imageSets, new Set(countries.map(getCountryId)));
    const atlas = createAtlas(geogrid, countries);
    const byId = new Map(atlas.records.map(country => [getCountryId(country), country]));
    const missingGeometry = atlas.records.filter(country => !country.geometry);
    if (missingGeometry.length) {
        getElement("geometry-note").textContent = "No map geometry: " + missingGeometry.map(country => country.properties.name).join(", ") + ". Sourced locations use callouts, not country outlines.";
        getElement("geometry-note").hidden = false;
    }
    const ordered = [...atlas.records].sort((a, b) => a.properties.name.localeCompare(b.properties.name));
    const palette = colorNeighbors(neighbors(world.objects.countries.geometries));
    const neighborColors = new Map(countries.map((country, index) => [getCountryId(country), palette[index]]));
    if (layers.lakes?.type !== "FeatureCollection" || layers.urban?.type !== "FeatureCollection") {
        throw new Error("Invalid map layers");
    }
    const loadedSets = new Set();
    const loadingSets = new Map();
    const state = {
        mode: "natural",
        imageSet: imageSets.sets[0].id,
        timeZone: "",
        selected: null,
        city: null,
        query: compileAtlasQuery(atlas, []),
        overlays: { capitals: false, largest: false, count: 1 },
    };
    const calloutLayer = createCalloutLayer(getElement("country-callouts"), getElement("map"), id => selectCountry(id, false), showError);
    const map = createMap(getElement("map"), countries, layers, {
        onCountry: id => selectCountry(id, false),
        onCity: city => selectCity(city, false),
        onError: showError,
        onCallouts: calloutLayer,
        onInspect: hit => {
            const tooltip = getElement("map-tooltip");
            tooltip.hidden = !hit;
            if (!hit) return;
            tooltip.textContent = hit.name + (state.mode === "timezones"
                ? ": " + countryTimeZoneLabel(geogrid.countries[atlas.mapping.get(hit.id)]) : "");
            const canvas = getElement("map");
            const left = Math.max(4, Math.min(hit.point[0] + 12, canvas.clientWidth - tooltip.offsetWidth - 4));
            const top = hit.point[1] + tooltip.offsetHeight + 16 < canvas.clientHeight
                ? hit.point[1] + 12 : Math.max(4, hit.point[1] - tooltip.offsetHeight - 12);
            tooltip.style.left = left + "px";
            tooltip.style.top = top + "px";
        },
    }, atlas.records);
    getElement("country-callouts").addEventListener("wheel", map.zoomFromWheel, { passive: false });

    function getImageSet() {
        return imageSets.sets.find(set => set.id === state.imageSet);
    }

    function getMatch(id) {
        return state.query(atlas.mapping.get(id));
    }

    function updateFilterPanel() {
        const count = getElement("selected-categories").children.length;
        getElement("active-filters-heading").textContent = state.mode !== "criteria" && count ? "Saved" : "Filters";
        getElement("filter-summary").textContent = !count ? "No active filters." : state.mode === "criteria"
            ? count + (count === 1 ? " active filter" : " active filters")
            : count + (count === 1 ? " saved filter. " : " saved filters. ") + "Switch to Criteria to apply.";
        getElement("active-filters").title = getElement("filter-summary").textContent;
    }

    function updateMap() {
        const colors = new Map();
        const statuses = new Map();
        for (const country of atlas.records) {
            const id = getCountryId(country);
            let color = "#ffffff";
            if (state.mode === "natural") color = "#c8cfb1";
            if (state.mode === "neighbors") color = neighborColors.get(id);
            if (state.mode === "imagery") color = "#dbdddf";
            if (state.mode === "criteria") color = COUNTRY_COLORS[getMatch(id)];
            const sourceCountry = geogrid.countries[atlas.mapping.get(id)];
            if (state.mode === "timezones") color = countryTimeZoneColor(sourceCountry, state.timeZone);
            colors.set(id, color);
            statuses.set(id, state.mode === "timezones" ? countryTimeZoneLabel(sourceCountry) : RESULT_LABELS[getMatch(id)]);
        }
        let cities = listCities(facts.countries, state.overlays);
        if (state.city && !cities.some(city => city.id === state.city.id)) {
            cities = [state.city, ...cities];
        }
        map.update({
            mode: state.mode,
            texture: state.mode === "natural" ? "natural" : state.mode === "imagery" ? "images:" + state.imageSet : null,
            colors,
            statuses,
            images: getImageSet().images,
            selected: state.selected,
            city: state.city?.id || null,
            cities,
        });
        let legend = "";
        if (state.mode === "criteria") legend = "Green: match. Gray: nonmatch. Tan: unknown. Purple: outside GeoGrid.";
        if (state.mode === "imagery") legend = getImageSet().title + ". Gray: image unavailable.";
        if (state.mode === "timezones") legend = state.timeZone
            ? state.timeZone + ": colored countries observe this offset. Gray: other offsets. Tan: unavailable."
            : "Colors: UTC offsets. Purple: multiple zones. Tan: unavailable. Hover or select for offsets.";
        if (["imagery", "criteria", "timezones"].includes(state.mode)) {
            legend += " Small countries use markers. Hover or select for names.";
        }
        if (state.overlays.capitals || state.overlays.largest) {
            legend += (legend ? " " : "") + "Diamond: capital or seat. Dot: city.";
        }
        getElement("map-legend").textContent = legend;
        getElement("timezone-legend").hidden = state.mode !== "timezones";
        for (const button of getElement("timezone-legend").children) {
            button.setAttribute("aria-pressed", String(state.timeZone === button.dataset.zone));
        }
        const coverage = [];
        const countryFacts = Object.values(facts.countries);
        if (state.overlays.capitals) {
            const count = countryFacts.filter(country => country.cities.some(city => city.capitalRoles.length)).length;
            coverage.push("Capitals/seats: " + count + "/" + countries.length + " areas.");
        }
        if (state.overlays.largest) {
            const complete = countryFacts.filter(country => country.cityCoverage.status === "complete").length;
            const partial = countryFacts.filter(country => country.cityCoverage.status === "incomplete").length;
            coverage.push("Rankings: " + complete + " complete, " + partial + " partial.");
        }
        getElement("city-coverage").textContent = coverage.join(" ");
        getElement("city-coverage").hidden = !coverage.length;
    }

    function updateCountryList() {
        const query = getElement("country-search").value.trim().toLowerCase();
        const filter = getElement("result-filter").value;
        const list = getElement("country-list");
        const focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.country : null;
        let focusTarget = null;
        const fragment = document.createDocumentFragment();
        let matches = 0;
        let unknown = 0;
        let outside = 0;
        let displayed = 0;
        for (const country of ordered) {
            const id = getCountryId(country);
            const result = getMatch(id);
            if (result === "match") matches++;
            if (result === "unknown") unknown++;
            if (result === "outside") outside++;
            const sourceCountry = geogrid.countries[atlas.mapping.get(id)];
            const searchText = [country.properties.name, id, sourceCountry?.name, sourceCountry?.code].join(" ").toLowerCase();
            if (!searchText.includes(query)) continue;
            if (state.mode === "criteria" && filter !== "all" && filter !== result) continue;
            const item = makeElement("li");
            const button = makeElement("button");
            button.type = "button";
            button.dataset.country = id;
            if (id === focusedId) focusTarget = button;
            button.setAttribute("aria-pressed", String(state.selected === id));
            button.append(makeElement("span", country.properties.name));
            if (state.mode === "criteria") button.append(makeElement("span", RESULT_LABELS[result], "result-state"));
            if (state.mode === "timezones") {
                button.append(makeElement("span", sourceCountry?.timeZones?.length > 1 ? "Multiple zones" :
                    countryTimeZoneLabel(sourceCountry), "result-state"));
                button.title = countryTimeZoneLabel(sourceCountry);
            }
            if (!country.geometry) button.title = "No map geometry";
            button.addEventListener("click", () => selectCountry(id, true));
            item.append(button);
            fragment.append(item);
            displayed++;
        }
        list.replaceChildren(fragment);
        if (focusTarget) focusTarget.focus({ preventScroll: true });
        getElement("result-count").textContent = state.mode === "criteria"
            ? matches + " match, " + unknown + " unknown, " + outside + " outside GeoGrid. " + displayed + " shown."
            : displayed + " countries";
    }

    function updateDetails() {
        const panel = getElement("country-details");
        const focusedCity = document.activeElement?.dataset.city;
        let focusTarget = null;
        panel.hidden = !state.selected;
        if (!state.selected) return;
        const country = byId.get(state.selected);
        const data = facts.countries[state.selected];
        const categoryData = geogrid.countries[atlas.mapping.get(state.selected)];
        panel.replaceChildren(makeElement("h2", country.properties.name));
        if (!country.geometry) panel.append(makeElement("p", country.properties.location
            ? "No map geometry. Callout at GeoGrid's country location." : "No map geometry. Included in category results.", "data-note"));
        if (state.mode === "criteria") panel.append(makeElement("p", RESULT_LABELS[getMatch(state.selected)], "data-note"));
        if (state.mode === "imagery") {
            const image = getImageSet().images[state.selected];
            if (image) {
                const element = makeElement("img");
                element.src = getAssetUrl(image.src);
                element.alt = image.label;
                element.addEventListener("error", () => showError(new Error("Couldn't load " + image.label)), { once: true });
                panel.append(element);
                const credit = makeElement("p", (image.source.creator || "") + " ", "data-note");
                if (image.source.licenseUrl) {
                    appendSource(credit, { url: image.source.licenseUrl }, image.source.license);
                    credit.append(document.createTextNode(" "));
                } else {
                    credit.append(document.createTextNode((image.source.license || "") + " "));
                }
                appendSource(credit, image.source, "Image source");
                panel.append(credit);
            } else {
                panel.append(makeElement("p", "Image unavailable", "data-note"));
            }
        }
        panel.append(makeElement("h3", "GeoGrid data"));
        const values = makeElement("dl");
        const unavailable = categoryData ? "Unavailable" : "Outside GeoGrid";
        addFact(values, "Population", categoryData?.population != null
            ? NUMBER_FORMAT.format(categoryData.population) : unavailable);
        addFact(values, "Category border count", categoryData?.borderCount != null
            ? String(categoryData.borderCount) : unavailable);
        addFact(values, categoryData?.borderMode === "nearby" ? "Nearby countries" : "Listed neighbors", categoryData?.borders
            ? categoryData.borders.map(code => geogrid.countries[code.toLowerCase()]?.name || code).join(", ") || "None"
            : unavailable);
        addFact(values, "Flag colors", categoryData?.flagColors
            ? categoryData.flagColors.map(color => atlas.colors.get(color)).join(", ") : unavailable);
        addFact(values, "Time zones", countryTimeZoneLabel(categoryData));
        panel.append(values);
        if (categoryData?.borders && categoryData.borders.length !== categoryData.borderCount) {
            panel.append(makeElement("p", "GeoGrid adjusts border counts; listed neighbors can include nearby countries.", "data-note"));
        }
        const categorySource = makeElement("p", undefined, "source-links");
        appendSource(categorySource, geogrid.source, "GeoGrid combined data");
        panel.append(categorySource);
        panel.append(makeElement("h3", "Cities (Wikipedia)"));
        if (data?.cityCoverage?.status !== "complete") {
            panel.append(makeElement("p", data?.cityCoverage?.status === "incomplete" ? "City ranking incomplete" : "City ranking unavailable", "data-note"));
        }
        if (data?.cityCoverage?.note) {
            const scope = makeElement("details");
            scope.append(makeElement("summary", "Ranking scope"), makeElement("p", data.cityCoverage.note, "data-note"));
            panel.append(scope);
        }
        if (data?.cityCoverage?.source) {
            const source = makeElement("p", undefined, "source-links");
            appendSource(source, data.cityCoverage.source, "City ranking source");
            panel.append(source);
        }
        const cities = (data?.cities || []).filter(city => city.capitalRoles.length ||
            (Number.isInteger(city.rank) && city.rank <= state.overlays.count));
        const list = makeElement("ul", undefined, "city-list");
        for (const city of cities) {
            const item = makeElement("li");
            const button = makeElement("button", city.name + (city.capitalRoles.length ? " (" + city.capitalRoles.join(", ") + ")" : " #" + city.rank));
            button.type = "button";
            button.dataset.city = city.id;
            if (city.id === focusedCity) focusTarget = button;
            button.setAttribute("aria-pressed", String(state.city?.id === city.id));
            button.addEventListener("click", () => selectCity({ ...city, country: state.selected, isCapitalOrSeat: city.capitalRoles.length > 0 }, true));
            item.append(button);
            list.append(item);
        }
        panel.append(list);
        if (state.city) {
            const city = state.city;
            panel.append(makeElement("h3", city.name));
            const cityValues = makeElement("dl");
            if (city.capitalRoles.length) addFact(cityValues, "Role", city.capitalRoles.join(", "), city.capitalSource);
            addFact(cityValues, "City-proper population", city.population
                ? NUMBER_FORMAT.format(city.population.value) + " (" + city.population.year + ")"
                : "Unavailable", city.population?.source);
            panel.append(cityValues);
            if (city.coordinateSource || city.source) {
                const source = makeElement("p", undefined, "source-links");
                appendSource(source, city.coordinateSource || city.source, "Location source");
                panel.append(source);
            }
        }
        if (focusTarget) focusTarget.focus({ preventScroll: true });
    }

    function selectCountry(id, focus) {
        if (id !== null && !byId.has(id)) throw new Error("Country unavailable: " + id);
        state.selected = id;
        state.city = null;
        updateMap();
        updateCountryList();
        updateDetails();
        if (focus && byId.get(id)?.geometry) map.focusCountry(id);
        else if (focus && byId.get(id)?.properties.location) map.focusLocation(byId.get(id).properties.location);
    }

    function selectCity(city, focus) {
        if (!byId.has(city.country)) throw new Error("City country unavailable: " + city.country);
        state.selected = city.country;
        state.city = city;
        updateMap();
        updateCountryList();
        updateDetails();
        if (focus) map.focusCity(city);
    }

    async function ensureImages() {
        const set = getImageSet();
        if (loadedSets.has(set.id)) return;
        if (loadingSets.has(set.id)) return loadingSets.get(set.id);
        const pending = (async () => {
            getElement("map-status").textContent = "Loading " + set.title.toLowerCase() + "...";
            const texture = await buildImageAtlas(countries, set, count => {
                getElement("map-status").textContent = "Loading images: " + count;
            });
            map.setTexture("images:" + set.id, texture);
            loadedSets.add(set.id);
            getElement("map-status").textContent = "";
        })();
        loadingSets.set(set.id, pending);
        try {
            await pending;
        } finally {
            loadingSets.delete(set.id);
        }
    }

    function updateMode() {
        state.mode = getElement("fill-mode").value;
        updateFilterPanel();
        getElement("image-controls").hidden = state.mode !== "imagery";
        getElement("criteria-controls").hidden = state.mode !== "criteria";
        getElement("timezone-controls").hidden = state.mode !== "timezones";
        getElement("result-filter").hidden = state.mode !== "criteria";
        updateMap();
        updateCountryList();
        updateDetails();
        if (state.mode === "imagery") ensureImages().catch(showError);
    }

    createCriteriaControls(atlas, (criteria, mode) => {
        state.query = compileAtlasQuery(atlas, criteria, mode);
        updateFilterPanel();
        updateMap();
        updateCountryList();
        updateDetails();
    });

    for (const set of imageSets.sets) {
        const option = makeElement("option", set.title);
        option.value = set.id;
        getElement("image-set").append(option);
    }
    getElement("image-set").addEventListener("change", () => {
        state.imageSet = getElement("image-set").value;
        updateMap();
        updateDetails();
        ensureImages().catch(showError);
    });
    for (const zone of listTimeZones(geogrid.countries)) {
        const option = makeElement("option", zone);
        option.value = zone;
        getElement("timezone-view").append(option);
        const button = makeElement("button", zone);
        button.type = "button";
        button.dataset.zone = zone;
        button.style.setProperty("--zone-color", timeZoneColor(zone));
        button.addEventListener("click", () => {
            getElement("timezone-view").value = state.timeZone === zone ? "" : zone;
            getElement("timezone-view").dispatchEvent(new Event("change"));
        });
        getElement("timezone-legend").append(button);
    }
    getElement("timezone-view").addEventListener("change", () => {
        state.timeZone = getElement("timezone-view").value;
        updateMap();
    });
    for (const type of ["globe", "flat"]) {
        getElement(type + "-view").addEventListener("click", () => {
            getElement("globe-view").setAttribute("aria-pressed", String(type === "globe"));
            getElement("flat-view").setAttribute("aria-pressed", String(type === "flat"));
            map.setProjection(type);
        });
    }
    getElement("zoom-in").addEventListener("click", () => map.zoomBy(1.3));
    getElement("zoom-out").addEventListener("click", () => map.zoomBy(1 / 1.3));
    getElement("reset-view").addEventListener("click", () => map.reset());
    getElement("fill-mode").addEventListener("change", updateMode);
    getElement("country-search").addEventListener("input", updateCountryList);
    getElement("result-filter").addEventListener("change", updateCountryList);
    for (const id of ["show-capitals", "show-largest", "city-count"]) {
        getElement(id).addEventListener("change", () => {
            state.overlays = {
                capitals: getElement("show-capitals").checked,
                largest: getElement("show-largest").checked,
                count: Number(getElement("city-count").value),
            };
            getElement("city-count").disabled = !state.overlays.largest;
            updateMap();
            updateDetails();
        });
    }
    if (window.matchMedia("(max-width: 520px)").matches) getElement("criteria-controls").closest("details").open = false;
    const footer = getElement("footer-row");
    new ResizeObserver(() => {
        document.documentElement.style.setProperty("--footer-height", footer.getBoundingClientRect().height + "px");
    }).observe(footer);
    updateMode();
    getElement("map-status").textContent = "Loading terrain...";
    const terrain = await loadTerrain("/category-map/img/natural-earth.jpg");
    map.setTexture("natural", terrain);
    getElement("map-status").textContent = "";
}

document.addEventListener("DOMContentLoaded", () => initialize().catch(showError));
