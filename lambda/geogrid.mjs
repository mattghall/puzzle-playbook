// Geogrid publishes each day's board as a static file, so this just works out which one a date is.
const DATA = 'https://cdn-assets.teuteuf.fr/data/';
// Board #1 ran on this date and the numbering has been one a day ever since.
const EPOCH = '2024-04-07';

// Warm invocations reuse the country list and any board they've already built.
let countriesPromise = null;
const boardCache = {};

function pacificDate() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

// Today's board is only good until the puzzle rolls over at midnight Pacific.
function secondsUntilPacificMidnight() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).formatToParts(new Date());
    const value = (type) => Number(parts.find(part => part.type === type).value);
    return 86400 - ((value('hour') % 24) * 3600 + value('minute') * 60 + value('second'));
}

// Past rounds are settled, future ones can still be pinned, today's expires at the rollover.
function cacheControl(date, today) {
    if (date < today) return 'public, max-age=86400';
    if (date > today) return 'public, max-age=300';
    return 'public, max-age=' + secondsUntilPacificMidnight();
}

// Counted in UTC so a daylight saving change can't drop or repeat a day.
function boardIdFor(date) {
    const asUtc = (value) => {
        const parts = value.split('-').map(Number);
        return Date.UTC(parts[0], parts[1] - 1, parts[2]);
    };
    return Math.round((asUtc(date) - asUtc(EPOCH)) / 86400000) + 1;
}

async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error('HTTP ' + res.status + ' for ' + url);
    }
    return res.json();
}

// The same list the real game searches, trimmed to what an autocomplete needs.
async function loadCountries() {
    const raw = await getJson(DATA + 'common/countries.json');
    const countries = raw
        .filter(country => country && country.code && country.name)
        .map(country => ({ code: country.code.toLowerCase(), name: country.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    if (countries.length < 100) {
        throw new Error('Only ' + countries.length + ' countries in the Geogrid data');
    }
    return countries;
}

function category(entry) {
    return { id: entry.id, name: entry.name, variantId: entry.variantId === undefined ? null : entry.variantId };
}

// The board file also carries the answer for every square, so only the categories get past here.
async function buildBoard(date) {
    const boardId = boardIdFor(date);
    if (boardId < 1) {
        throw new Error('Geogrid did not exist on ' + date);
    }
    const [raw, countries] = await Promise.all([
        getJson(DATA + 'geogrid/boards/' + boardId + '.json'),
        countriesPromise
    ]);
    if (!Array.isArray(raw.rows) || raw.rows.length !== 3 || !Array.isArray(raw.columns) || raw.columns.length !== 3) {
        throw new Error('Board ' + boardId + ' is not a 3x3 grid');
    }
    return {
        date: date,
        boardId: boardId,
        rows: raw.rows.map(category),
        columns: raw.columns.map(category),
        countries: countries
    };
}

export const handler = async (event) => {
    const today = pacificDate();
    const asked = event && event.queryStringParameters && event.queryStringParameters.date;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(asked || '') ? asked : today;
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': cacheControl(date, today)
    };

    try {
        if (!countriesPromise) {
            countriesPromise = loadCountries();
        }
        if (!boardCache[date]) {
            boardCache[date] = await buildBoard(date);
        }
        return { statusCode: 200, headers, body: JSON.stringify(boardCache[date], null, 2) };
    } catch (error) {
        // A failed load shouldn't poison every later invocation.
        countriesPromise = null;
        console.error('Could not build the Geogrid board:', error);
        const failed = Object.assign({}, headers, { 'Cache-Control': 'no-store' });
        return { statusCode: 502, headers: failed, body: JSON.stringify({ error: String(error.message || error) }) };
    }
};
