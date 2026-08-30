// Weaver keeps every puzzle in its JS bundle, so this pulls the bundle apart and picks out one day.
const SITE = 'https://wordwormdormdork.com';
const PAGE = SITE + '/weaver/';
const DICTIONARIES = SITE + '/dictionaries/';
// The puzzle rolls over at midnight Eastern, which the game counts as a five hour offset from UTC.
const DAY = 86400000;
const ROLLOVER = 5 * 3600000;

// Warm invocations reuse the parsed bundle and any day they've already built.
let bundlePromise = null;
const dictionaryCache = {};
const boardCache = {};

function epochDayNow() {
    return Math.floor((Date.now() - ROLLOVER) / DAY);
}

function epochDayFor(date) {
    const parts = date.split('-').map(Number);
    return Math.floor((Date.UTC(parts[0], parts[1] - 1, parts[2]) + ROLLOVER) / DAY);
}

function dateFor(epochDay) {
    return new Date(epochDay * DAY + ROLLOVER).toISOString().slice(0, 10);
}

function secondsUntilRollover() {
    const next = (epochDayNow() + 1) * DAY + ROLLOVER;
    return Math.max(1, Math.round((next - Date.now()) / 1000));
}

// Past puzzles are settled, future ones can still be pinned, today's expires at the rollover.
function cacheControl(date, today) {
    if (date < today) return 'public, max-age=86400';
    if (date > today) return 'public, max-age=300';
    return 'public, max-age=' + secondsUntilRollover();
}

async function getText(url) {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error('HTTP ' + res.status + ' for ' + url);
    }
    return res.text();
}

async function getJson(url) {
    return JSON.parse(await getText(url));
}

// The bundle is hash named, so the page is the only place its current URL is written down.
async function bundleUrl() {
    const html = await getText(PAGE);
    const match = html.match(/\/static\/js\/main\.[a-f0-9]+\.js/);
    if (!match) {
        throw new Error('No main bundle linked from the Weaver page');
    }
    return SITE + match[0];
}

// Walks back from an index to the start of the array literal that encloses it.
function arrayLiteralBefore(source, index) {
    let depth = 0;
    for (let i = index - 1; i >= 0; i--) {
        const char = source[i];
        if (char === ']') depth++;
        else if (char === '[') {
            depth--;
            if (depth === 0) return source.slice(i, index);
        }
    }
    return null;
}

// Every puzzle table is a literal that gets mapped straight onto named fields.
function parseTables(source) {
    const tables = [];
    const marker = 'startWord:';
    let at = 0;
    while ((at = source.indexOf(marker, at)) !== -1) {
        const open = source.lastIndexOf('.map(', at);
        const literal = open === -1 ? null : arrayLiteralBefore(source, open);
        at += marker.length;
        if (!literal || literal.length < 1000) continue;
        let rows = null;
        try {
            // Minified object keys come through bare and gaps come through as void 0, neither of which JSON takes.
            const json = literal
                .replace(/([{,])\s*([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
                .replace(/\bvoid 0\b/g, 'null');
            rows = JSON.parse(json);
        } catch (error) {
            continue;
        }
        if (!Array.isArray(rows) || rows.length < 100) continue;
        // The day the table's first puzzle ran is assigned just after the map call.
        const offset = source.slice(at, at + 400).match(/[=,]\s*[A-Za-z$_][\w$]*\s*=\s*(\d{5})\s*[,;)]/);
        tables.push({ rows: rows, startDay: offset ? Number(offset[1]) : null });
    }
    return tables;
}

// Classic Weaver ladders keep the same word length throughout; Weaver X is the one that changes.
function isClassic(rows) {
    return rows.every(row => typeof row[0] === 'string' && typeof row[1] === 'string' && row[0].length === row[1].length);
}

async function loadBundle() {
    const source = await getText(await bundleUrl());
    const table = parseTables(source).find(entry => entry.startDay !== null && isClassic(entry.rows));
    if (!table) {
        throw new Error('No classic Weaver puzzle table in the bundle');
    }
    return table;
}

// Patches ship as added and removed lists that stack on top of the base word list.
async function loadDictionary(config) {
    const type = config && config.type ? config.type : 'scowl60';
    const version = config && config.version ? config.version : 1;
    const patch = config && config.patch ? config.patch : 0;
    const key = type + '-v' + version + '-p' + patch;
    if (dictionaryCache[key]) {
        return dictionaryCache[key];
    }
    const prefix = DICTIONARIES + type + '/v' + version + '-' + type + '-';
    const words = new Set(await getJson(prefix + 'base.json'));
    for (let step = 1; step <= patch; step++) {
        const delta = await getJson(prefix + 'patch-' + String(step).padStart(3, '0') + '.json');
        (delta.removed || []).forEach(word => words.delete(word));
        (delta.added || []).forEach(word => words.add(word));
    }
    if (words.size < 10000) {
        throw new Error('Only ' + words.size + ' words in the ' + type + ' dictionary');
    }
    dictionaryCache[key] = words;
    return words;
}

// Each row also carries the optimal path, so only the two ends and its length get past here.
async function buildBoard(date) {
    const table = await bundlePromise;
    const index = epochDayFor(date) - table.startDay;
    if (index < 0 || index >= table.rows.length) {
        throw new Error('Weaver has no puzzle for ' + date);
    }
    const row = table.rows[index];
    const startWord = row[0];
    const endWord = row[1];
    if (startWord.length !== endWord.length) {
        throw new Error('Puzzle for ' + date + ' is not a fixed length ladder');
    }
    const dictionary = await loadDictionary(row[4]);
    const words = [...dictionary].filter(word => word.length === startWord.length).sort();
    if (!words.includes(startWord) || !words.includes(endWord)) {
        throw new Error('Puzzle words for ' + date + ' are missing from the dictionary');
    }
    return {
        date: date,
        gameNumber: index + 1,
        startWord: startWord,
        endWord: endWord,
        wordLength: startWord.length,
        optimalSteps: typeof row[2] === 'number' ? row[2] : null,
        words: words
    };
}

export const handler = async (event) => {
    const today = dateFor(epochDayNow());
    const asked = event && event.queryStringParameters && event.queryStringParameters.date;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(asked || '') ? asked : today;
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': cacheControl(date, today)
    };

    try {
        if (!bundlePromise) {
            bundlePromise = loadBundle();
        }
        // Only a bad bundle should be retried; asking for a date outside the table is just a miss.
        try {
            await bundlePromise;
        } catch (error) {
            bundlePromise = null;
            throw error;
        }
        if (!boardCache[date]) {
            boardCache[date] = await buildBoard(date);
        }
        return { statusCode: 200, headers, body: JSON.stringify(boardCache[date]) };
    } catch (error) {
        console.error('Could not build the Weaver board:', error);
        const failed = Object.assign({}, headers, { 'Cache-Control': 'no-store' });
        return { statusCode: 502, headers: failed, body: JSON.stringify({ error: String(error.message || error) }) };
    }
};
