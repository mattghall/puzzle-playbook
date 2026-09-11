export function getThresholdSeries(choices) {
    const series = new Map();
    for (const choice of choices) {
        if (typeof choice.value !== "number") continue;
        const direction = /(^|_)under_/.test(choice.id) ? "Under" :
            /(^|_)over_/.test(choice.id) || choice.id === "largest_city_x_urban_pop" ? "Over" : null;
        if (!direction || !Number.isFinite(choice.value)) throw new Error("Unsupported numeric category: " + choice.key);
        if (!series.has(choice.id)) series.set(choice.id, { id: choice.id, direction, choices: [] });
        series.get(choice.id).choices.push(choice);
    }
    for (const entry of series.values()) {
        entry.choices.sort((a, b) => a.value - b.value);
        if (new Set(entry.choices.map(choice => choice.value)).size !== entry.choices.length) {
            throw new Error("Duplicate category thresholds: " + entry.id);
        }
    }
    return series;
}

export function thresholdLabel(choice) {
    const label = choice.label.match(/(?:[<>]|\bover\b|\bunder\b)\s*(.+)$/i)?.[1];
    if (!label) throw new Error("Missing threshold label: " + choice.key);
    return label;
}

export function rangeEndpointLabel(range, side) {
    if (side === "upper") return "\u221e";
    if (range.labels) return range.labels[0];
    const choice = (range.lower || range.upper).choices[0];
    return thresholdLabel(choice).replace(/-?[\d,.]+(?:[KMB](?=\s|$))?/, "0");
}

export function thresholdPosition(selected, series) {
    return series.choices.findIndex(choice => selected.has(choice.key)) + 1;
}

export function setThreshold(selected, series, position) {
    if (!Number.isInteger(position) || position < 0 || position > series.choices.length) {
        throw new Error("Invalid threshold position: " + series.id);
    }
    const previous = series.choices.find(choice => selected.has(choice.key));
    const exclude = previous ? selected.get(previous.key) : false;
    for (const choice of series.choices) selected.delete(choice.key);
    if (position) selected.set(series.choices[position - 1].key, exclude);
}

export function expandThresholdMatches(choices, matches) {
    const keys = new Set(matches.map(choice => choice.key));
    const groups = new Set(matches.filter(choice => typeof choice.value === "number").map(choice => choice.section + ":" + choice.category));
    return choices.filter(choice => keys.has(choice.key) || typeof choice.value === "number" && groups.has(choice.section + ":" + choice.category));
}

export function getThresholdRanges(choices) {
    const ranges = new Map();
    for (const series of getThresholdSeries(choices).values()) {
        const choice = series.choices[0];
        const key = choice.section + ":" + choice.category;
        if (!ranges.has(key)) ranges.set(key, { key, name: choice.category, lower: null, upper: null });
        const range = ranges.get(key);
        const side = series.direction === "Over" ? "lower" : "upper";
        if (range[side]) throw new Error("Duplicate threshold bound: " + key);
        range[side] = series;
    }
    return [...ranges.values()].map(range => ({
        ...range,
        values: [...new Set([range.lower, range.upper].filter(Boolean).flatMap(series => series.choices.map(choice => choice.value)))].sort((a, b) => a - b),
    }));
}

export function rangePosition(selected, range, side) {
    const choice = range.exact?.choices.find(choice => selected.has(choice.key)) ||
        range[side]?.choices.find(choice => selected.has(choice.key));
    return choice ? range.values.indexOf(choice.value) + 1 : side === "lower" ? 0 : range.values.length + 1;
}

export function setRangePosition(selected, range, side, position) {
    if (!["lower", "upper"].includes(side) || !range[side] || !Number.isInteger(position) || position < 0 || position > range.values.length + 1) {
        throw new Error("Invalid range position: " + range.key);
    }
    if (range.exact) {
        setNumericRangePosition(selected, range, side, position);
        return;
    }
    const series = range[side];
    const other = rangePosition(selected, range, side === "lower" ? "upper" : "lower");
    const off = side === "lower" ? 0 : range.values.length + 1;
    const allowed = [off, ...series.choices.map(choice => range.values.indexOf(choice.value) + 1)]
        .filter(value => side === "lower" ? value < other : value > other);
    allowed.sort((a, b) => Math.abs(a - position) - Math.abs(b - position) || a - b);
    const next = allowed[0];
    const index = next === off ? 0 : series.choices.findIndex(choice => choice.value === range.values[next - 1]) + 1;
    setThreshold(selected, series, index);
}

function setNumericRangePosition(selected, range, side, position) {
    const max = range.values.length + 1;
    const positions = { lower: rangePosition(selected, range, "lower"), upper: rangePosition(selected, range, "upper") };
    positions[side] = side === "lower" ? Math.max(0, Math.min(position, positions.upper, max - 1)) :
        Math.min(max, Math.max(position, positions.lower, 1));
    if (positions.lower === 0 && positions.upper === 1) positions.lower = 1;
    const previousExact = range.exact.choices.find(choice => selected.has(choice.key));
    const exclusions = {};
    for (const bound of ["lower", "upper"]) {
        const previous = previousExact || range[bound].choices.find(choice => selected.has(choice.key));
        exclusions[bound] = previous ? selected.get(previous.key) : false;
    }
    for (const series of [range.lower, range.upper, range.exact]) {
        for (const choice of series.choices) selected.delete(choice.key);
    }
    if (positions.lower === positions.upper) {
        selected.set(range.exact.choices[positions.lower - 1].key, exclusions.lower || exclusions.upper);
    } else {
        if (positions.lower) selected.set(range.lower.choices[positions.lower - 1].key, exclusions.lower);
        if (positions.upper !== max) selected.set(range.upper.choices[positions.upper - 1].key, exclusions.upper);
    }
}
