import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { geoArea } from "d3-geo";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = {
    topology: {
        url: "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json",
        version: "world-atlas 2.0.2 / Natural Earth 4.1.0",
        license: "Public domain",
    },
    identifiers: {
        url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/f1890d9f152c896d250a77557a5751a93d494776/geojson/ne_50m_admin_0_countries.geojson",
        version: "Natural Earth 5.1.2, f1890d9f152c896d250a77557a5751a93d494776",
        license: "Public domain",
        fields: ["NAME", "NAME_LONG", "ISO_A3_EH", "ISO_A2_EH", "ISO_N3_EH", "ADM0_A3"],
    },
    terrain: {
        url: "https://naturalearth.s3.amazonaws.com/50m_raster/NE1_50M_SR_W.zip?versionId=txy_QL3wFl2ICqkubOW5_xpzxhsZyfLu",
        version: "Natural Earth I 1:50m shaded relief with water, S3 version txy_QL3wFl2ICqkubOW5_xpzxhsZyfLu",
        license: "Public domain",
    },
    lakes: {
        url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/f1890d9f152c896d250a77557a5751a93d494776/geojson/ne_50m_lakes.geojson",
        version: "Natural Earth 5.1.2, f1890d9f152c896d250a77557a5751a93d494776",
        license: "Public domain",
    },
    urban: {
        url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/f1890d9f152c896d250a77557a5751a93d494776/geojson/ne_50m_urban_areas.geojson",
        version: "Natural Earth 5.1.2, f1890d9f152c896d250a77557a5751a93d494776",
        license: "Public domain",
    },
};

function digest(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}

async function download(source, target, pin) {
    execFileSync("curl", ["--fail", "--silent", "--show-error", "--location", "--retry", "3", "--max-time", "300", source.url, "--output", target]);
    const bytes = await readFile(target);
    const sha256 = digest(bytes);
    if (pin && sha256 !== pin) throw new Error("Source checksum changed: " + source.url);
    return { ...source, sha256 };
}

function prepareLayer(source, type) {
    return {
        type: "FeatureCollection",
        features: source.features.map(feature => {
            const geometry = feature.geometry;
            if (!["Polygon", "MultiPolygon"].includes(geometry.type)) throw new Error("Unexpected layer geometry: " + geometry.type);
            const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
            for (const coordinates of polygons) {
                if (geoArea({ type: "Polygon", coordinates }) > 2 * Math.PI) coordinates.forEach(ring => ring.reverse());
            }
            return {
                type: "Feature",
                properties: type === "lakes" ?
                    { id: String(feature.properties.ne_id), name: feature.properties.name, kind: feature.properties.featurecla } :
                    { kind: feature.properties.featurecla },
                geometry,
            };
        }),
    };
}

export async function prepareGeography({ root = ROOT } = {}) {
    const dataDir = path.join(root, "games/world-map/data");
    const imageDir = path.join(root, "games/world-map/img");
    const workDir = path.join(imageDir, ".geography-stage");
    await mkdir(dataDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    const previous = await readFile(path.join(dataDir, "geography-sources.json"), "utf8").then(JSON.parse).catch(error => {
        if (error.code !== "ENOENT") throw error;
        return null;
    });
    try {
        const sources = {};
        for (const [id, source] of Object.entries(SOURCES)) {
            sources[id] = await download(source, path.join(workDir, id), previous?.sources[id]?.sha256);
        }
        const world = JSON.parse(await readFile(path.join(workDir, "topology"), "utf8"));
        const metadata = JSON.parse(await readFile(path.join(workDir, "identifiers"), "utf8")).features.map(feature => feature.properties);
        const ids = new Set();
        for (const country of world.objects.countries.geometries) {
            const matches = metadata.filter(item => item.NAME === country.properties.name ||
                (country.id && item.ISO_N3_EH === country.id));
            const item = matches.find(item => item.NAME === country.properties.name) || matches[0];
            if (!item) throw new Error("Unmapped Natural Earth country: " + country.properties.name);
            const custom = {
                Somaliland: "X-SOMALILAND", Kosovo: "X-KOSOVO", "N. Cyprus": "X-NORTHERN-CYPRUS",
                "Siachen Glacier": "X-SIACHEN", "Indian Ocean Ter.": "X-AUSTRALIAN-INDIAN-OCEAN",
                "Ashmore and Cartier Is.": "X-ASHMORE-CARTIER",
            };
            const id = custom[item.NAME] || item.ISO_A3_EH;
            if (!id || id === "-99" || ids.has(id)) throw new Error("Invalid/duplicate country ID: " + id);
            ids.add(id);
            country.id = id;
            country.properties = {
                id,
                name: item.NAME_LONG,
                iso2: custom[item.NAME] || item.ISO_A2_EH === "-99" ? null : item.ISO_A2_EH,
            };
        }
        execFileSync("python3", ["-c", [
            "from PIL import Image",
            "import sys,zipfile",
            "with zipfile.ZipFile(sys.argv[1]) as archive:",
            "    member=next(name for name in archive.namelist() if name.lower().endswith('.tif'))",
            "    with archive.open(member) as source:",
            "        image=Image.open(source)",
            "        if image.width != 2*image.height: raise ValueError('Expected equirectangular 2:1 raster')",
            "        image.convert('RGB').resize((2048,1024),Image.Resampling.LANCZOS).save(sys.argv[2],quality=88,optimize=True)",
        ].join("\n"), path.join(workDir, "terrain"), path.join(workDir, "natural-earth.jpg")]);
        const terrain = await readFile(path.join(workDir, "natural-earth.jpg"));
        const layers = {};
        for (const type of ["lakes", "urban"]) {
            layers[type] = prepareLayer(JSON.parse(await readFile(path.join(workDir, type), "utf8")), type);
        }
        const layerBytes = JSON.stringify(layers) + "\n";
        const manifest = {
            version: 1,
            sources,
            licenseUrl: "https://www.naturalearthdata.com/about/terms-of-use/",
            boundaries: "Natural Earth 4.1.0 de facto country boundaries, distributed unchanged by world-atlas 2.0.2. Not an endorsement of territorial claims. Somaliland and Kosovo remain separate custom IDs; Western Sahara and Palestine retain ISO IDs. Overseas areas follow this snapshot's country grouping.",
            identifiers: "Only country names and ISO identifiers use Natural Earth 5.1.2 metadata. Population, borders as facts, flag colors, and city records do not come from Natural Earth.",
            customIds: {
                "X-SOMALILAND": "Somaliland (no ISO 3166-1 code)",
                "X-KOSOVO": "Kosovo (no officially assigned ISO 3166-1 code)",
                "X-NORTHERN-CYPRUS": "Northern Cyprus (no ISO 3166-1 code)",
                "X-AUSTRALIAN-INDIAN-OCEAN": "Natural Earth grouping of Christmas Island and Cocos (Keeling) Islands",
                "X-ASHMORE-CARTIER": "Ashmore and Cartier Islands (Australian territory)",
                "X-SIACHEN": "Siachen Glacier disputed area (no ISO 3166-1 code)",
            },
            coverage: {
                countries: ids.size,
                notes: "1:50m retains many small countries, including Vatican City, Monaco, San Marino, and island states. Areas absent from this source aren't invented as polygons. No province overlay is bundled.",
            },
            layers: {
                src: "data/layers.json",
                lakes: layers.lakes.features.length,
                urban: layers.urban.features.length,
                sha256: digest(layerBytes),
                processing: "Natural Earth's already-generalized 1:50m lake and urban polygons, with coordinates preserved and unused properties removed. Exterior rings use D3's clockwise spherical winding; holes remain opposite. No additional vertex simplification.",
                notes: "Lake polygons include reservoirs and seasonal lakes as classified by Natural Earth. Render lakes as inland water in all modes and urban polygons only as natural-mode land-cover shading. Urban extents are generalized historical built-up areas, not current administrative city boundaries or population facts.",
            },
            terrain: {
                src: "img/natural-earth.jpg",
                width: 2048,
                height: 1024,
                projection: "equirectangular",
                bounds: [-180, -90, 180, 90],
                sha256: digest(terrain),
                processing: "Pillow RGB conversion, Lanczos resize to 2048x1024, JPEG quality 88, optimize. Natural Earth I shaded relief with water; no hosted basemap.",
            },
        };
        await writeFile(path.join(dataDir, "world.json"), JSON.stringify(world) + "\n");
        await writeFile(path.join(imageDir, "natural-earth.jpg"), terrain);
        await writeFile(path.join(dataDir, "layers.json"), layerBytes);
        await writeFile(path.join(dataDir, "geography-sources.json"), JSON.stringify(manifest, null, 2) + "\n");
        return { countries: ids.size, terrainBytes: terrain.length };
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    console.log(await prepareGeography());
}
