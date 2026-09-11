import { compileAtlasQuery, filterChoices, getAtlasChoice } from "./atlas.mjs";
import { groupChoices, presentChoice, SAME_SEX_OPTIONS } from "./category-groups.mjs";
import { expandThresholdMatches, getThresholdRanges, rangeEndpointLabel, rangePosition, setRangePosition, thresholdLabel } from "./thresholds.mjs";
import { getColorPalette } from "./color-picker.mjs";
import { dropdownLabel, getDropdownGroups } from "./dropdowns.mjs";

function getChoiceLabel(choice, compact = false) {
    const display = presentChoice(choice);
    return (compact ? display.label : display.fullLabel) + (choice.legacy ? " (legacy)" : "");
}

export function createCriteriaControls(atlas, onChange) {
    const selected = new Map();
    const inputs = new Map();
    const sliders = new Map();
    const swatches = new Map();
    const dropdowns = new Map();
    const allChoices = [...atlas.choices.values()];
    const sameSexChoices = new Map(allChoices.filter(choice => SAME_SEX_OPTIONS.some(option => option.id === choice.id))
        .map(choice => [choice.id, choice]));
    let sameSexSwitch = null;
    const countryCount = Object.keys(atlas.snapshot.countries).length;
    const ranges = atlas.numericRanges?.length ? atlas.numericRanges : getThresholdRanges(allChoices);
    const thresholds = new Map(ranges.flatMap(range =>
        (range.sourceIds || [range.lower, range.upper].filter(Boolean).map(series => series.id)).map(id => [id, range])));
    const dropdownGroups = new Map(getDropdownGroups(allChoices).flatMap(group => group.ids.map(id => [id, group])));
    const palettes = new Map(["color_on_flag", "color_not_on_flag"].map(id => [
        id, getColorPalette(allChoices.filter(choice => choice.id === id), atlas.snapshot.colors),
    ]));
    const search = document.getElementById("category-search");
    const section = document.getElementById("category-section");
    const mode = document.getElementById("criteria-mode");
    const clear = document.getElementById("clear-criteria");
    const list = document.getElementById("selected-categories");
    const warnings = document.getElementById("filter-warnings");
    const choices = document.getElementById("category-choices");
    const count = document.getElementById("category-count");
    const groupSizes = new Map(groupChoices([...atlas.choices.values()]).map(entry => [
        entry.section, new Map(entry.groups.map(group => [group.name, group.choices.length])),
    ]));

    function focusFilters() {
        const next = list.querySelector('button[data-action="remove"]') ||
            (document.getElementById("active-filters").hidden ? document.getElementById("map") : mode);
        next.focus({ preventScroll: true });
        if (list.contains(next)) scrollChipIntoView(next);
    }

    function scrollChipIntoView(element) {
        const bounds = list.getBoundingClientRect();
        const chip = element.getBoundingClientRect();
        if (chip.left < bounds.left) list.scrollLeft += chip.left - bounds.left;
        else if (chip.right > bounds.right) list.scrollLeft += chip.right - bounds.right;
    }

    function update() {
        const focused = document.activeElement;
        const previousKeys = new Set([...list.children].map(item => item.dataset.key));
        let focusTarget = null;
        const fragment = document.createDocumentFragment();
        const notes = new Set();
        for (const [key, exclude] of selected) {
            const choice = getAtlasChoice(atlas, key);
            const item = document.createElement("li");
            item.dataset.key = key;
            item.className = "filter-chip" + (exclude ? " is-excluded" : "") + (choice.unavailableReason ? " is-unavailable" : "");
            if (choice.unavailableReason) item.title = choice.unavailableReason;
            if (choice.unavailableReason) notes.add(choice.unavailableReason);
            for (const action of ["exclude", "remove"]) {
                const button = document.createElement("button");
                button.type = "button";
                button.dataset.key = key;
                button.dataset.action = action;
                button.className = action === "exclude" ? "filter-chip-name" : "filter-chip-remove";
                if (action === "exclude") {
                    const label = document.createElement("span");
                    label.textContent = (exclude ? "Not: " : "") + getChoiceLabel(choice);
                    button.append(label);
                    if (choice.unavailableReason) {
                        const warning = document.createElement("span");
                        warning.className = "filter-chip-warning";
                        warning.textContent = " ?";
                        warning.setAttribute("aria-label", "Source facts unavailable");
                        button.append(warning);
                    }
                    button.setAttribute("aria-pressed", String(exclude));
                    button.title = (exclude ? "Include" : "Exclude") + ": " + getChoiceLabel(choice);
                } else {
                    button.textContent = "\u00d7";
                    button.title = "Remove: " + getChoiceLabel(choice);
                }
                button.setAttribute("aria-label", button.title);
                if (focused?.dataset.key === key && focused?.dataset.action === action) focusTarget = button;
                button.addEventListener("click", () => {
                    if (action === "exclude") selected.set(key, !selected.get(key));
                    else selected.delete(key);
                    update();
                    if (action === "remove") focusFilters();
                });
                item.append(button);
            }
            fragment.append(item);
        }
        list.replaceChildren(fragment);
        if ([...selected.keys()].some(key => !previousKeys.has(key))) list.scrollLeft = list.scrollWidth;
        warnings.replaceChildren(...[...notes].map(text => {
            const note = document.createElement("p");
            note.className = "data-note";
            note.textContent = text;
            return note;
        }));
        warnings.hidden = !notes.size;
        for (const [key, input] of inputs) input.checked = selected.has(key);
        for (const slider of sliders.values()) updateSlider(slider);
        for (const swatch of swatches.values()) updateSwatch(swatch);
        for (const dropdown of dropdowns.values()) updateDropdown(dropdown);
        if (sameSexSwitch) updateSameSexSwitch();
        clear.disabled = !selected.size;
        if (focusTarget) {
            focusTarget.focus({ preventScroll: true });
            scrollChipIntoView(focusTarget);
        }
        onChange([...selected].map(([key, exclude]) => ({ key, exclude })), mode.value);
    }

    function updateSameSexSwitch() {
        const active = [...sameSexChoices.values()].find(choice => selected.has(choice.key));
        for (const input of sameSexSwitch.querySelectorAll("input")) {
            const option = SAME_SEX_OPTIONS.find(option => option.value === input.value);
            const choice = sameSexChoices.get(option.id);
            const exclude = choice && selected.get(choice.key);
            input.checked = choice ? active === choice : !active;
            input.parentElement.classList.toggle("is-excluded", Boolean(exclude));
            input.setAttribute("aria-label", choice ? (exclude ? "Not: " : "") + getChoiceLabel(choice) : "Off, no same-sex law filter");
        }
    }

    function makeSameSexSwitch() {
        const container = document.createElement("fieldset");
        container.className = "category-switch";
        const legend = document.createElement("legend");
        legend.textContent = "Same-sex laws";
        const options = document.createElement("div");
        options.className = "switch-options";
        for (const option of SAME_SEX_OPTIONS) {
            const label = document.createElement("label");
            const input = document.createElement("input");
            input.type = "radio";
            input.name = "same-sex-laws";
            input.id = "same-sex-" + option.value;
            input.value = option.value;
            input.className = "sr-only";
            input.setAttribute("aria-describedby", "same-sex-note");
            input.addEventListener("change", () => {
                for (const choice of sameSexChoices.values()) selected.delete(choice.key);
                if (option.id) selected.set(sameSexChoices.get(option.id).key, false);
                update();
            });
            const text = document.createElement("span");
            text.textContent = option.label;
            label.append(input, text);
            options.append(label);
        }
        const note = document.createElement("p");
        note.id = "same-sex-note";
        note.className = "data-note";
        note.textContent = "Legal: marriage. Illegal: sexual activity.";
        container.append(legend, options, note);
        sameSexSwitch = container;
        updateSameSexSwitch();
        return container;
    }

    function updateDropdown({ input, group }) {
        const active = group.choices.filter(choice => selected.has(choice.key)).length;
        input.options[0].textContent = active ? active + " selected; add another" : "Choose...";
        for (const option of [...input.options].slice(1)) option.disabled = selected.has(option.value);
        input.value = "";
    }

    function makeDropdown(group) {
        const container = document.createElement("div");
        container.className = "category-dropdown";
        const label = document.createElement("label");
        label.textContent = group.label;
        const input = document.createElement("select");
        input.id = "category-" + group.key;
        label.htmlFor = input.id;
        const placeholder = document.createElement("option");
        placeholder.value = "";
        input.append(placeholder);
        for (const choice of group.choices) {
            const option = document.createElement("option");
            option.value = choice.key;
            option.textContent = dropdownLabel(choice) + " (" + (choice.unavailableReason ? "Unknown" : choice.matches.size) + ")";
            input.append(option);
        }
        input.addEventListener("change", () => {
            if (!input.value) return;
            selected.set(input.value, false);
            update();
        });
        const dropdown = { input, group };
        dropdowns.set(group.key, dropdown);
        updateDropdown(dropdown);
        container.append(label, input);
        return container;
    }

    function updateSwatch({ button, swatch }) {
        const active = swatch.keys.some(key => selected.has(key));
        const excluded = swatch.keys.some(key => selected.get(key) === true);
        button.setAttribute("aria-pressed", String(active));
        button.classList.toggle("is-negated", excluded);
        button.setAttribute("aria-label", (excluded ? "Not: " : "") + getChoiceLabel(swatch.choice));
        button.title = button.getAttribute("aria-label") + " (" + getMatchCount(swatch.choice, excluded) + " countries)";
    }

    function makeColorPicker(id, visibleChoices) {
        const container = document.createElement("fieldset");
        container.className = "flag-color-picker";
        const legend = document.createElement("legend");
        legend.textContent = id === "color_on_flag" ? "With colors" : "Without colors";
        const grid = document.createElement("div");
        grid.className = "color-swatches";
        const visible = new Set(visibleChoices.map(choice => choice.key));
        for (const swatch of palettes.get(id)) {
            if (!swatch.keys.some(key => visible.has(key))) continue;
            const button = document.createElement("button");
            button.type = "button";
            button.className = "flag-color-swatch";
            button.dataset.key = swatch.choice.key;
            button.dataset.color = swatch.color;
            button.style.setProperty("--swatch-fill", swatch.fill);
            button.style.setProperty("--swatch-ink", swatch.ink);
            button.addEventListener("click", () => {
                const active = swatch.keys.some(key => selected.has(key));
                for (const key of swatch.keys) selected.delete(key);
                if (!active) selected.set(swatch.choice.key, false);
                update();
            });
            const control = { button, swatch };
            swatches.set(swatch.choice.key, control);
            updateSwatch(control);
            grid.append(button);
        }
        container.append(legend, grid);
        return container;
    }

    function getMatchCount(choice, exclude) {
        return exclude ? countryCount - choice.matches.size - choice.unknown.size : choice.matches.size;
    }

    function updateSlider({ range, controls, track, summary, join }) {
        const conditions = [];
        const exact = range.exact?.choices.find(choice => selected.has(choice.key));
        join.hidden = Boolean(exact);
        controls.upper.output.parentElement.hidden = Boolean(exact);
        track.classList.toggle("is-exact", Boolean(exact));
        if (exact) conditions.push({ key: exact.key, exclude: selected.get(exact.key) });
        for (const side of ["lower", "upper"]) {
            const { input, output } = controls[side];
            const choice = exact || range[side]?.choices.find(choice => selected.has(choice.key));
            const exclude = choice && selected.get(choice.key);
            const endpoint = rangeEndpointLabel(range, side);
            const value = choice && (range.labels ? range.labels[range.values.indexOf(choice.value)] : thresholdLabel(choice));
            output.textContent = choice ? (exclude ? "Not " : "") + (exact ? "Exactly " : "") + value : endpoint;
            if (input) {
                input.value = String(rangePosition(selected, range, side));
                input.setAttribute("aria-valuetext", choice ? (exclude ? "Not: " : "") + getChoiceLabel(choice) :
                    side === "upper" ? "Infinity, no upper limit" : endpoint + ", no lower filter");
            }
            if (choice && !exact) conditions.push({ key: choice.key, exclude });
        }
        const max = range.values.length + 1;
        track.style.setProperty("--range-start", rangePosition(selected, range, "lower") / max * 100 + "%");
        track.style.setProperty("--range-end", rangePosition(selected, range, "upper") / max * 100 + "%");
        summary.hidden = !conditions.length;
        if (conditions.length) {
            const match = compileAtlasQuery(atlas, conditions, mode.value);
            const results = Object.keys(atlas.snapshot.countries).map(match);
            const unknown = results.filter(result => result === "unknown").length;
            summary.textContent = results.filter(result => result === "match").length + " matches" + (unknown ? ", " + unknown + " unknown" : "");
        }
    }

    function makeSlider(range) {
        const container = document.createElement("div");
        container.className = "threshold-slider";
        const values = document.createElement("div");
        values.className = "threshold-values";
        const track = document.createElement("div");
        track.className = "dual-range";
        if (range.exact) track.title = "Move the handles together for an exact match.";
        const rail = document.createElement("div");
        rail.className = "range-rail";
        rail.setAttribute("aria-hidden", "true");
        range.values.forEach((value, index) => {
            const tick = document.createElement("span");
            tick.className = "range-tick";
            tick.style.left = (index + 1) / (range.values.length + 1) * 100 + "%";
            rail.append(tick);
        });
        track.append(rail);
        const controls = {};
        const join = document.createElement("span");
        join.textContent = "to";
        for (const side of ["lower", "upper"]) {
            const series = range[side];
            const output = document.createElement("output");
            const label = document.createElement("label");
            label.append(output);
            let input = null;
            if (series) {
                input = document.createElement("input");
                input.type = "range";
                input.id = "threshold-" + series.id.replaceAll("_", "-");
                input.dataset.series = series.id;
                input.dataset.side = side;
                input.min = "0";
                input.max = String(range.values.length + 1);
                input.step = "1";
                input.setAttribute("aria-label", range.name + ": " + (side === "lower" ? "Lower bound" : "Upper bound"));
                label.htmlFor = input.id;
                output.setAttribute("for", input.id);
                input.addEventListener("input", () => {
                    setRangePosition(selected, range, side, Number(input.value));
                    update();
                });
                track.append(input);
            } else {
                label.title = "No " + side + "-bound category";
            }
            values.append(label);
            if (side === "lower") values.append(join);
            controls[side] = { input, output };
        }
        const summary = document.createElement("p");
        summary.className = "data-note";
        const slider = { range, controls, track, summary, join };
        sliders.set(range.key, slider);
        track.addEventListener("pointerdown", event => {
            if (event.target instanceof HTMLInputElement) return;
            const rect = track.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left - 9) / (rect.width - 18)));
            const position = Math.round(ratio * (range.values.length + 1));
            const sides = ["lower", "upper"].filter(side => range[side]);
            sides.sort((a, b) => Math.abs(rangePosition(selected, range, a) - position) - Math.abs(rangePosition(selected, range, b) - position));
            setRangePosition(selected, range, sides[0], position);
            update();
            controls[sides[0]].input.focus({ preventScroll: true });
        });
        updateSlider(slider);
        container.append(values, track, summary);
        return container;
    }

    function updateChoices() {
        const matches = expandThresholdMatches(allChoices, filterChoices(atlas, search.value, section.value));
        const keys = new Set(matches.map(choice => choice.key));
        const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        for (const range of ranges) {
            const matched = matches.some(choice => thresholds.get(choice.id) === range);
            const exactMatch = (!section.value || range.section === section.value) &&
                range.exact?.choices.some(choice => words.every(word => (range.name + " " + choice.label).toLowerCase().includes(word)));
            if (matched || exactMatch) {
                for (const choice of allChoices) if (thresholds.get(choice.id) === range) keys.add(choice.key);
            }
        }
        const filtered = allChoices.filter(choice => keys.has(choice.key));
        const fragment = document.createDocumentFragment();
        inputs.clear();
        sliders.clear();
        swatches.clear();
        dropdowns.clear();
        sameSexSwitch = null;
        const renderedPalettes = new Set();
        for (const entry of groupChoices(filtered)) {
            if (!section.value) {
                const title = document.createElement("h3");
                title.textContent = entry.section;
                fragment.append(title);
            }
            for (const group of entry.groups) {
                const dropdown = dropdownGroups.get(group.choices[0].id);
                const singleDropdown = dropdown && group.choices.every(choice => dropdownGroups.get(choice.id) === dropdown);
                if (!singleDropdown && group.name !== "Same-sex laws" && groupSizes.get(entry.section).get(group.name) > 1) {
                    const title = document.createElement(section.value ? "h3" : "h4");
                    title.textContent = group.name;
                    fragment.append(title);
                }
                for (const choice of group.choices) {
                    if (sameSexChoices.has(choice.id)) {
                        if (!sameSexSwitch) fragment.append(makeSameSexSwitch());
                        continue;
                    }
                    const dropdown = dropdownGroups.get(choice.id);
                    if (dropdown) {
                        if (!dropdowns.has(dropdown.key)) fragment.append(makeDropdown(dropdown));
                        continue;
                    }
                    if (palettes.has(choice.id)) {
                        if (!renderedPalettes.has(choice.id)) {
                            fragment.append(makeColorPicker(choice.id, group.choices));
                            renderedPalettes.add(choice.id);
                        }
                        continue;
                    }
                    const range = thresholds.get(choice.id);
                    if (range) {
                        if (!sliders.has(range.key)) {
                            if (range.name !== group.name) {
                                const title = document.createElement("h4");
                                title.textContent = range.name;
                                fragment.append(title);
                            }
                            fragment.append(makeSlider(range));
                        }
                        continue;
                    }
                    const label = document.createElement("label");
                    label.className = "category-choice";
                    const input = document.createElement("input");
                    input.type = "checkbox";
                    input.dataset.key = choice.key;
                    input.checked = selected.has(choice.key);
                    input.setAttribute("aria-label", getChoiceLabel(choice));
                    input.addEventListener("change", () => {
                        if (input.checked) selected.set(choice.key, false);
                        else selected.delete(choice.key);
                        update();
                    });
                    inputs.set(choice.key, input);
                    const text = document.createElement("span");
                    text.textContent = getChoiceLabel(choice, true);
                    const matches = document.createElement("small");
                    matches.textContent = choice.unavailableReason ? "Unknown" : String(choice.matches.size);
                    matches.title = choice.unavailableReason || choice.matches.size + " matches, " + choice.unknown.size + " unknown";
                    matches.setAttribute("aria-label", matches.title);
                    label.append(input, text, matches);
                    fragment.append(label);
                }
            }
        }
        choices.replaceChildren(fragment);
        count.textContent = filtered.length + "/" + atlas.choices.size + " source conditions";
    }

    for (const { section: name } of groupChoices(allChoices)) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        section.append(option);
    }
    const unavailable = [...atlas.choices.values()].filter(choice => choice.unavailableReason);
    if (unavailable.length) {
        const note = document.getElementById("atlas-limitations");
        note.textContent = unavailable.length + " capital conditions lack facts in combined.json and remain unknown.";
        note.hidden = false;
    }
    search.addEventListener("input", updateChoices);
    section.addEventListener("change", updateChoices);
    mode.addEventListener("change", update);
    clear.addEventListener("click", () => {
        selected.clear();
        update();
        focusFilters();
    });
    updateChoices();
}
