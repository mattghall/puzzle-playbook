import fs from 'node:fs/promises';
import path from 'node:path';

// Geozee builds its board in the browser, so there's no endpoint to ask. Its own modules are
// downloaded and run here instead, which keeps the board identical to the one the site deals.
const SITE = 'https://geozee.earth';
const COUNTRY_DATA = 'https://cdn-assets.teuteuf.fr/data/geogrid/combined.json';
const ASSET_DIR = '/tmp/geozee-assets';

// Warm invocations reuse the loaded modules and the 1.6MB country file.
let gamePromise = null;
const boardCache = {};

function pacificDate() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

async function getText(url) {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error('HTTP ' + res.status + ' for ' + url);
    }
    return res.text();
}

// Pulls a module and everything it imports into /tmp so node can import it from disk.
async function downloadGraph(entry) {
    await fs.mkdir(ASSET_DIR, { recursive: true });
    // Their assets are .js holding ESM, which node reads as CommonJS unless the folder says otherwise.
    await fs.writeFile(path.join(ASSET_DIR, 'package.json'), '{"type":"module"}');
    const fetched = new Set();
    const queue = [entry];
    while (queue.length) {
        const name = queue.shift();
        if (fetched.has(name)) continue;
        fetched.add(name);
        const code = await getText(SITE + '/assets/' + name);
        await fs.writeFile(path.join(ASSET_DIR, name), code);
        for (const m of code.matchAll(/from\s*"\.\/([^"]+)"|import\s*\(\s*"\.\/([^"]+)"\s*\)|import\s*"\.\/([^"]+)"/g)) {
            queue.push(m[1] || m[2] || m[3]);
        }
    }
    return [...fetched];
}

function importLocal(name) {
    return import('file://' + path.join(ASSET_DIR, name));
}

const REACT_INTERNALS = '__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE';

// Their category list is behind a react hook, so hooks are answered with the simplest thing that
// satisfies them. Nothing renders, the hook just needs somewhere to call.
function installHooks(react, getI18n) {
    react[REACT_INTERNALS].H = {
        useMemo: (fn) => fn(),
        useCallback: (fn) => fn,
        useRef: (val) => ({ current: val }),
        useState: (val) => [typeof val == 'function' ? val() : val, () => { }],
        useEffect: () => { },
        useLayoutEffect: () => { },
        useContext: (ctx) => (ctx._currentValue === null ? getI18n() : ctx._currentValue),
        useDebugValue: () => { },
        useId: () => 'geozee',
        useSyncExternalStore: (_sub, get) => get()
    };
}

// Every export below is found by what it does rather than by name, because the bundle is minified
// and both the file hashes and the single-letter export names change on every deploy.
function findExport(mod, test) {
    for (const value of Object.values(mod)) {
        try {
            if (test(value)) return value;
        } catch (err) { }
    }
    return null;
}

// React is reached through an interop getter rather than exported directly.
function findReact(mod) {
    const getter = findExport(mod, (v) => typeof v == 'function' && v() && v()[REACT_INTERNALS] && v().useState);
    return getter ? getter() : null;
}

// The provider returns an element holding the value the translation hook would have read.
function findI18nValue(mod) {
    const provider = findExport(mod, (v) => {
        if (typeof v != 'function') return false;
        const el = v({ children: null });
        return el && el.props && el.props.value && typeof el.props.value.t == 'function';
    });
    return provider ? provider({ children: null }).props.value : null;
}

function findCategories(mod) {
    const hook = findExport(mod, (v) => {
        if (typeof v != 'function') return false;
        const out = v();
        return Array.isArray(out) && out.length > 0 && Array.isArray(out[0].dataKeys);
    });
    return hook ? hook() : null;
}

// Most rounds are hand-pinned rather than computed, so this table is the real source of a board.
function findPinnedBoards(mod) {
    return findExport(mod, (v) => {
        if (!v || typeof v != 'object' || Array.isArray(v)) return false;
        const keys = Object.keys(v);
        if (!keys.length || !keys.every(k => /^\d{4}-\d{2}-\d{2}$/.test(k))) return false;
        const first = v[keys[0]];
        return first && Array.isArray(first.countries) && Array.isArray(first.categories);
    });
}

async function loadGame() {
    const html = await getText(SITE + '/');
    const entries = [...new Set([...html.matchAll(/\/assets\/(routes-[A-Za-z0-9_-]+\.js)/g)].map(m => m[1]))];
    if (!entries.length) {
        throw new Error('No route bundles found on ' + SITE);
    }

    // Both route bundles get downloaded, then the one holding the game is picked out.
    let names = [];
    for (const entry of entries) {
        names = names.concat(await downloadGraph(entry));
    }

    const reactModule = names.find(n => n.startsWith('jsx-runtime'));
    const i18nModule = names.find(n => n.startsWith('i18n-context'));
    const categoryModule = names.find(n => n.startsWith('categories'));
    if (!reactModule || !i18nModule || !categoryModule) {
        throw new Error('Geozee bundle is missing an expected module');
    }

    const react = findReact(await importLocal(reactModule));
    if (!react) {
        throw new Error('Could not find react in the Geozee bundle');
    }
    let i18n = null;
    installHooks(react, () => i18n);
    i18n = findI18nValue(await importLocal(i18nModule));
    if (!i18n) {
        throw new Error('Could not find the Geozee translations');
    }

    const categoryModuleExports = await importLocal(categoryModule);
    const categories = findCategories(categoryModuleExports);
    if (!categories) {
        throw new Error('Could not read the Geozee categories');
    }
    const pinned = findPinnedBoards(categoryModuleExports);
    if (!pinned) {
        throw new Error('Could not read the Geozee pinned rounds');
    }

    let game = null;
    for (const name of entries) {
        const mod = await importLocal(name);
        if (mod.dailySelection && mod.buildDailyPool && mod.normalize) {
            game = mod;
            break;
        }
    }
    if (!game) {
        throw new Error('Could not find the Geozee board builder');
    }

    const countries = game.normalize(JSON.parse(await getText(COUNTRY_DATA)));
    if (countries.length < 9) {
        throw new Error('Only ' + countries.length + ' countries in the Geozee data');
    }
    return { game, categories, countries, pinned };
}

// Mirrors Geozee's own resolver: take the pinned round when there is one, otherwise deal a board.
function pickRound(loaded, date) {
    const pin = loaded.pinned[date];
    if (pin) {
        const byCode = new Map(loaded.countries.map(c => [c.code, c]));
        const byId = new Map(loaded.categories.map(c => [c.id, c]));
        const countries = pin.countries.map(c => byCode.get(c)).filter(Boolean);
        const categories = pin.categories.map(c => byId.get(c)).filter(Boolean);
        if (countries.length === 9 && categories.length === 9) {
            return { countries, categories, pinned: true };
        }
    }
    const pool = loaded.game.buildDailyPool(loaded.countries, date);
    return Object.assign(loaded.game.dailySelection(pool, date, loaded.categories), { pinned: false });
}

function buildBoard(loaded, date) {
    const picked = pickRound(loaded, date);
    return {
        date: date,
        pinned: picked.pinned,
        countries: picked.countries.map(c => ({ code: c.code, name: c.name })),
        categories: picked.categories.map(c => ({
            id: c.id,
            name: c.name,
            rule: c.rule,
            ruleCompact: c.ruleCompact
        }))
    };
}

export const handler = async (event) => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    };
    const asked = event && event.queryStringParameters && event.queryStringParameters.date;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(asked || '') ? asked : pacificDate();

    try {
        if (!boardCache[date]) {
            if (!gamePromise) {
                gamePromise = loadGame();
            }
            boardCache[date] = buildBoard(await gamePromise, date);
        }
        return { statusCode: 200, headers, body: JSON.stringify(boardCache[date], null, 2) };
    } catch (error) {
        // A failed load shouldn't poison every later invocation.
        gamePromise = null;
        console.error('Could not build the Geozee board:', error);
        return { statusCode: 502, headers, body: JSON.stringify({ error: String(error.message || error) }) };
    }
};
