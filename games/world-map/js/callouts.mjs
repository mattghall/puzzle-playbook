import { geoArea, geoCentroid } from "d3-geo";
import { getCountryId } from "./model.mjs";
import { isVisible } from "./projection.mjs";

const SMALL_AREA = 12;
const HEIGHT = 18;
const GAP = 3;
const MAX_COVERAGE = 0.04;

export function getCalloutAnchors(countries) {
    return countries.flatMap(country => {
        let geometry = country.geometry;
        if (geometry?.type === "MultiPolygon") {
            geometry = geometry.coordinates.map(coordinates => ({ type: "Polygon", coordinates }))
                .sort((a, b) => geoArea(b) - geoArea(a))[0];
        }
        const location = geometry ? geoCentroid(geometry) : country.properties.location;
        if (!location) return [];
        if (location.length !== 2 || !location.every(Number.isFinite) || Math.abs(location[0]) > 180 || Math.abs(location[1]) > 90) {
            throw new Error("Invalid callout location: " + getCountryId(country));
        }
        return [{ id: getCountryId(country), name: country.properties.name, location, area: geometry ? geoArea(geometry) : 0 }];
    });
}

export function boxesOverlap(a, b, gap = GAP) {
    return a[0] < b[2] + gap && a[2] + gap > b[0] && a[1] < b[3] + gap && a[3] + gap > b[1];
}

export function layoutCallouts(anchors, projection, view, measure, { mode, selected }) {
    if (!["criteria", "imagery", "timezones"].includes(mode)) return [];
    const candidates = anchors.filter(anchor => anchor.area * projection.scale() ** 2 < SMALL_AREA && isVisible(anchor.location, view))
        .map(anchor => ({ ...anchor, point: projection(anchor.location) }))
        .filter(({ point: [x, y] }) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= view.width && y <= view.height)
        .sort((a, b) => Number(b.id === selected) - Number(a.id === selected) || a.area - b.area || a.id.localeCompare(b.id));
    const occupied = [];
    return candidates.map(candidate => {
        const [x, y] = candidate.point;
        const width = mode === "imagery" ? 24 : 16;
        const labelWidth = Math.min(160, view.width - 8, Math.ceil(measure(candidate.name)) + 12);
        let box = null;
        for (const distance of [5, 14, 24, 36]) {
            if ((occupied.length + 1) * width * HEIGHT > view.width * view.height * MAX_COVERAGE) break;
            const positions = [
                [x + distance, y - HEIGHT / 2], [x - distance - width, y - HEIGHT / 2],
                [x - width / 2, y - distance - HEIGHT], [x - width / 2, y + distance],
                [x + distance, y - distance - HEIGHT], [x - distance - width, y - distance - HEIGHT],
                [x + distance, y + distance], [x - distance - width, y + distance],
            ];
            for (const [left, top] of positions) {
                const next = [left, top, left + width, top + HEIGHT];
                if (left < 4 || top < 4 || next[2] > view.width - 4 || next[3] > view.height - 4) continue;
                if (occupied.some(other => boxesOverlap(next, other))) continue;
                if (candidates.some(other => other.point[0] >= left - 4 && other.point[0] <= next[2] + 4 &&
                    other.point[1] >= top - 4 && other.point[1] <= next[3] + 4)) continue;
                box = next;
                break;
            }
            if (box) break;
        }
        if (box) occupied.push(box);
        const labelOffset = box ? [
            Math.max(4 - box[0], Math.min(0, view.width - box[0] - labelWidth - 4)),
            box[3] + 25 < view.height ? HEIGHT + 3 : -25,
        ] : null;
        return { ...candidate, box, labelWidth, labelOffset };
    });
}
