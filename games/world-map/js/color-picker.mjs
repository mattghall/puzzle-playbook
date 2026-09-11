const SWATCHES = {
    black: ["#202428", "#ffffff"],
    white: ["#ffffff", "#202428"],
    grey: ["#92979d", "#202428"],
    pink: ["#ee9cba", "#202428"],
    red: ["#d52b35", "#ffffff"],
    orange: ["#f28c28", "#202428"],
    yellow: ["#f4d03f", "#202428"],
    green: ["#287d3b", "#ffffff"],
    blue: ["#2864b4", "#ffffff"],
    purple: ["#8045a5", "#ffffff"],
    brown: ["#89552e", "#ffffff"],
};

export function getColorPalette(choices, colors) {
    return colors.flatMap(color => {
        const matches = choices.filter(choice => choice.value === color.value);
        if (!matches.length) return [];
        if (!Object.hasOwn(SWATCHES, color.value)) throw new Error("Unsupported flag swatch: " + color.value);
        const [fill, ink] = SWATCHES[color.value];
        const choice = matches.find(choice => choice.variantId === color.variantId) || matches[0];
        return [{ choice, keys: matches.map(choice => choice.key), color: color.value, fill, ink }];
    });
}
