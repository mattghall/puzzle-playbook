export function timeZoneOffset(zone) {
    const match = /^UTC([+-])(\d{2}):(\d{2})$/.exec(zone);
    if (!match || Number(match[2]) > 14 || Number(match[3]) >= 60) throw new Error("Invalid time zone: " + zone);
    return (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "-" ? -1 : 1);
}

export function timeZoneColor(zone) {
    const hue = (timeZoneOffset(zone) + 720) / 1560 * 300;
    return "hsl(" + Math.round(hue) + " 55% 65%)";
}

export function countryTimeZoneColor(country, selected = "") {
    if (!country) return "#b9b2c8";
    if (!country.timeZones?.length) return "#d9bc86";
    if (selected) return country.timeZones.includes(selected) ? timeZoneColor(selected) : "#e0e3e4";
    return country.timeZones.length === 1 ? timeZoneColor(country.timeZones[0]) : "#956cac";
}

export function countryTimeZoneLabel(country) {
    if (!country) return "Outside GeoGrid";
    return country.timeZones?.length ? country.timeZones.join(", ") : "Time zones unavailable";
}

export function listTimeZones(countries) {
    return [...new Set(Object.values(countries).flatMap(country => country.timeZones || []))]
        .sort((a, b) => timeZoneOffset(a) - timeZoneOffset(b));
}
