const PALETTE = ["#ebbf70", "#97b8ce", "#b5cb92", "#d7a2ba", "#c0acd5", "#93cbbb"];
export const IMAGE_ATLAS_WIDTH = 4096;

export function validateImagePath(src) {
    if (typeof src !== "string" || !/^img\/[a-zA-Z0-9_./-]+$/.test(src) ||
        src.includes("..") || src.split("/").some(part => !part || part === ".") ||
        !/\.(svg|png|jpe?g|webp)$/i.test(src)) {
        throw new Error("Invalid image path: " + src);
    }
    return src;
}

export function colorNeighbors(adjacency) {
    const colors = new Array(adjacency.length).fill(-1);
    const remaining = new Set(adjacency.map((_, index) => index));
    while (remaining.size) {
        let next = -1;
        let saturation = -1;
        for (const index of remaining) {
            const used = new Set(adjacency[index].map(neighbor => colors[neighbor]).filter(color => color >= 0));
            if (used.size > saturation || (used.size === saturation && adjacency[index].length > adjacency[next].length)) {
                next = index;
                saturation = used.size;
            }
        }
        const used = new Set(adjacency[next].map(neighbor => colors[neighbor]));
        let color = 0;
        while (used.has(color)) color++;
        colors[next] = color;
        remaining.delete(next);
    }
    return colors.map(color => PALETTE[color] || `hsl(${color * 137.508 % 360} 45% 72%)`);
}

export function listCities(countries, overlays) {
    const cities = [];
    for (const [code, country] of Object.entries(countries)) {
        for (const city of country.cities || []) {
            const isCapitalOrSeat = city.capitalRoles.length > 0;
            const isRanked = Number.isInteger(city.rank) && city.rank > 0 && city.rank <= overlays.count;
            if ((overlays.capitals && isCapitalOrSeat) || (overlays.largest && isRanked)) {
                cities.push({ ...city, country: code, isCapitalOrSeat });
            }
        }
    }
    return cities.sort((a, b) => Number(b.isCapitalOrSeat) - Number(a.isCapitalOrSeat) ||
        (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.id.localeCompare(b.id));
}

export function getCountryId(country) {
    return String(country.properties.id ?? country.id);
}

export function fitImage(imageWidth, imageHeight, bounds, placement = {}) {
    const [left, top, width, height] = bounds;
    const ratios = [width / imageWidth, height / imageHeight];
    const scale = (placement.fit === "contain" ? Math.min(...ratios) : Math.max(...ratios)) * (placement.scale ?? 1);
    const drawnWidth = placement.fit === "stretch" ? width * (placement.scale ?? 1) : imageWidth * scale;
    const drawnHeight = placement.fit === "stretch" ? height * (placement.scale ?? 1) : imageHeight * scale;
    const [focusX, focusY] = placement.focalPoint || [0.5, 0.5];
    const [offsetX, offsetY] = placement.offset || [0, 0];
    return [
        left + (width - drawnWidth) * focusX + width * offsetX,
        top + (height - drawnHeight) * focusY + height * offsetY,
        drawnWidth,
        drawnHeight,
    ];
}
