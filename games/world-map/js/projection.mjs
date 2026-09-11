import { geoEqualEarth, geoOrthographic } from "d3-geo";

export function createProjection(view) {
    const { width, height, zoom, rotation, pan, projection } = view;
    const padding = Math.min(width, height) * 0.055;
    const result = projection === "globe" ? geoOrthographic() : geoEqualEarth();
    result.fitExtent([[padding, padding], [width - padding, height - padding]], { type: "Sphere" });
    result.scale(result.scale() * zoom);
    if (projection === "globe") {
        result.rotate(rotation);
    } else {
        result.translate([width / 2 + pan[0], height / 2 + pan[1]]);
    }
    return result.precision(0.25);
}

export function isVisible(point, view) {
    if (view.projection !== "globe") return true;
    const radians = Math.PI / 180;
    const longitude = (point[0] + view.rotation[0]) * radians;
    const latitude = point[1] * radians;
    const centerLatitude = -view.rotation[1] * radians;
    return Math.sin(latitude) * Math.sin(centerLatitude) +
        Math.cos(latitude) * Math.cos(centerLatitude) * Math.cos(longitude) > 0.001;
}
