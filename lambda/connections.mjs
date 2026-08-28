const PUZZLE_URL = 'https://www.nytimes.com/svc/connections/v2/';

// Warm invocations reuse boards that were already fetched, keyed by the date they belong to.
const boardCache = {};

// en-CA already formats as YYYY-MM-DD, and the time zone does the daylight savings work.
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

// Past puzzles are settled, future ones show up later, today's expires at the rollover.
function cacheControl(date, today) {
    if (date < today) return 'public, max-age=86400';
    if (date > today) return 'public, max-age=300';
    return 'public, max-age=' + secondsUntilPacificMidnight();
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
        if (!boardCache[date]) {
            const response = await fetch(PUZZLE_URL + date + '.json');
            // A date with no puzzle returns an error page, so this has to be checked before parsing.
            if (!response.ok) {
                const message = response.status === 404
                    ? 'No Connections puzzle for ' + date
                    : 'The puzzle feed returned HTTP ' + response.status + ' for ' + date;
                // A miss can turn into a real puzzle later, so failures are held briefly.
                const failed = Object.assign({}, headers, { 'Cache-Control': 'public, max-age=300' });
                return { statusCode: response.status === 404 ? 404 : 502, headers: failed, body: JSON.stringify({ error: message }) };
            }

            const data = await response.json();
            const words = data.categories.flatMap(category => category.cards.map(card => card.content));
            if (words.length === 0) {
                throw new Error('The puzzle for ' + date + ' had no words');
            }

            // Sorted so the board never arrives grouped by category.
            boardCache[date] = JSON.stringify(words.sort(), null, 2);
        }

        return { statusCode: 200, headers, body: boardCache[date] };
    } catch (error) {
        console.error('Could not build the Connections board:', error);
        const failed = Object.assign({}, headers, { 'Cache-Control': 'no-store' });
        return { statusCode: 502, headers: failed, body: JSON.stringify({ error: String(error.message || error) }) };
    }
};
