import { dropdownLabel } from "./dropdowns.mjs";

const PARAMETER_NAMES = {
    color_on_flag: "flag-color",
    color_not_on_flag: "flag-without-color",
    starting_letter: "starts-with",
    ending_letter: "ends-with",
    capital_starting_letter: "capital-starts-with",
    name_length: "name-length",
    name_x_plus_letters_long: "name-length-at-least",
    official_language: "official-language",
    not_official_language: "without-official-language",
    observes_x_time_zone: "observes-timezone",
    majority_religion: "religion",
    former_colony_of_x: "former-colony",
    borders_x: "borders-country",
};
const FILTER_PARAMS = new WeakMap();

function slug(value) {
    return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function getParameter(choice) {
    if (choice.id.startsWith("numeric:")) {
        const [, metric, side] = choice.id.split(":");
        return [slug(metric) + "-" + { lower: "min", upper: "max", exact: "exact" }[side], String(choice.value)];
    }
    const name = PARAMETER_NAMES[choice.id] || choice.id.replace(/(^|_)x(?=_|$)/g, "").replace(/_/g, "-").replace(/--+/g, "-").replace(/-$/, "");
    let value;
    if (["color_on_flag", "color_not_on_flag"].includes(choice.id)) value = choice.value === "grey" ? "gray" : choice.value;
    else if (["starting_letter", "ending_letter", "capital_starting_letter"].includes(choice.id)) value = choice.value.toLowerCase();
    else if (choice.id === "observes_x_time_zone") value = choice.value;
    else if (choice.id === "name_length") value = String(choice.variantId + 4);
    else if (choice.id === "name_x_plus_letters_long") value = "10";
    else if (typeof choice.value === "number") value = String(choice.value);
    else if (choice.variantId === null) value = "yes";
    else value = slug(dropdownLabel(choice));
    return [name, value + (choice.legacy ? "-legacy" : "")];
}

export function getFilterParams(atlas) {
    if (FILTER_PARAMS.has(atlas)) return FILTER_PARAMS.get(atlas);
    const byKey = new Map();
    const byParameter = new Map();
    for (const choice of [...atlas.choices.values(), ...atlas.rangeChoices.values()]) {
        const [name, value] = getParameter(choice);
        byKey.set(choice.key, { name, value });
        for (const exclude of [false, true]) {
            const parameter = (exclude ? "not-" : "") + name;
            if (!byParameter.has(parameter)) byParameter.set(parameter, new Map());
            const values = byParameter.get(parameter);
            if (values.has(value)) throw new Error("Duplicate filter parameter: " + parameter + "=" + value);
            values.set(value, { key: choice.key, exclude });
        }
    }
    const result = { byKey, byParameter };
    FILTER_PARAMS.set(atlas, result);
    return result;
}
