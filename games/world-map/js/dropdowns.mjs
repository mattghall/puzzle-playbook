const DROPDOWNS = [
    { key: "starting-letter", label: "Starts with", ids: ["starting_letter"] },
    { key: "ending-letter", label: "Ends with", ids: ["ending_letter"] },
    { key: "name-length", label: "Name length", ids: ["name_length", "name_x_plus_letters_long"] },
    { key: "capital-letter", label: "Capital starts with", ids: ["capital_starting_letter"] },
    { key: "official-language", label: "Official language", ids: ["official_language"] },
    { key: "not-official-language", label: "Not an official language", ids: ["not_official_language"] },
    { key: "timezone", label: "Time zone", ids: ["observes_x_time_zone"] },
    { key: "religion", label: "Majority religion", ids: ["majority_religion"] },
    { key: "former-colony", label: "Former colony of", ids: ["former_colony_of_x"] },
    { key: "empire", label: "Empire", ids: ["roman_empire", "ottoman_empire", "mongol_empire"] },
    { key: "border-country", label: "Borders country", ids: ["borders_x"] },
];

export function getDropdownGroups(choices) {
    return DROPDOWNS.map(group => ({
        ...group,
        choices: choices.filter(choice => group.ids.includes(choice.id)),
    })).filter(group => group.choices.length);
}

export function dropdownLabel(choice) {
    if (["starting_letter", "ending_letter", "capital_starting_letter", "observes_x_time_zone"].includes(choice.id)) return choice.value;
    return choice.label.replace(/^Name (?:is )?/, "").replace(/ is (?:not )?official$/, "")
        .replace(/^Former colony of /, "").replace(/^Borders /, "");
}
