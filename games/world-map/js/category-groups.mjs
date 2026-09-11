const FLAG_FEATURES = {
    flag_has_star: "Star or sun",
    flag_has_coat_of_arms: "Coat of arms",
    flag_has_animal: "Animal",
    flag_has_plant: "Plant",
    flag_has_moon: "Moon",
    flag_has_horizontal_stripes: "Horizontal stripes",
    flag_has_vertical_stripes: "Vertical stripes",
};

export const SAME_SEX_OPTIONS = [
    { value: "legal", label: "Legal", id: "same_sex_marriage_legal" },
    { value: "off", label: "Off", id: null },
    { value: "illegal", label: "Illegal", id: "same_sex_activities_illegal" },
];

export function presentChoice(choice) {
    if (SAME_SEX_OPTIONS.some(option => option.id === choice.id)) {
        return { group: "Same-sex laws", label: choice.label, fullLabel: choice.label };
    }
    if (/^(top|bottom)_20_/.test(choice.id)) {
        return { section: "Rankings", group: "Top / bottom 20", label: choice.label, fullLabel: choice.label };
    }
    if (["roman_empire", "ottoman_empire", "mongol_empire"].includes(choice.id)) {
        return { group: "Empire", label: choice.label, fullLabel: choice.label };
    }
    if (Object.hasOwn(FLAG_FEATURES, choice.id)) {
        const label = FLAG_FEATURES[choice.id];
        return { group: "Flag features", label, fullLabel: label + " on flag" };
    }
    let label;
    if (choice.id === "color_on_flag" || choice.id === "color_not_on_flag") {
        const color = choice.value === "grey" ? "gray" : choice.value;
        label = (choice.id === "color_on_flag" ? "With " : "Without ") + color;
    }
    if (choice.id === "flag_rwb") label = "Only red, white, and blue";
    if (choice.id === "flag_without_rwb") label = "No red, white, or blue";
    if (choice.id === "flag_has_x_colors") label = "Exactly " + (choice.variantId + 2) + " colors";
    if (choice.id === "flag_has_x_or_more_colors") label = "5+ colors";
    if (label) return { group: "Flag colors", label, fullLabel: "Flag: " + label.charAt(0).toLowerCase() + label.slice(1) };
    return { group: choice.category, label: choice.label, fullLabel: choice.label };
}

export function groupChoices(choices) {
    const sections = new Map();
    for (const choice of choices) {
        const display = presentChoice(choice);
        const section = display.section || choice.section;
        if (!sections.has(section)) sections.set(section, new Map());
        const groups = sections.get(section);
        const name = display.group;
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(choice);
    }
    return [...sections].map(([section, groups]) => ({
        section,
        groups: [...groups].map(([name, choices]) => ({ name, choices })),
    }));
}
