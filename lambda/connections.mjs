const PUZZLE_URL = 'https://www.nytimes.com/svc/connections/v2/';

// en-CA already formats as YYYY-MM-DD, and the time zone does the daylight savings work.
function pacificDate() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

export const handler = async (event) => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    };
    const asked = event && event.queryStringParameters && event.queryStringParameters.date;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(asked || '') ? asked : pacificDate();

    try {
        const response = await fetch(PUZZLE_URL + date + '.json');
        // A date with no puzzle returns an error page, so this has to be checked before parsing.
        if (!response.ok) {
            const message = response.status === 404
                ? 'No Connections puzzle for ' + date
                : 'The puzzle feed returned HTTP ' + response.status + ' for ' + date;
            return { statusCode: response.status === 404 ? 404 : 502, headers, body: JSON.stringify({ error: message }) };
        }

        const data = await response.json();
        const words = data.categories.flatMap(category => category.cards.map(card => card.content));
        if (words.length === 0) {
            throw new Error('The puzzle for ' + date + ' had no words');
        }

        // Sorted so the board never arrives grouped by category.
        return { statusCode: 200, headers, body: JSON.stringify(words.sort(), null, 2) };
    } catch (error) {
        console.error('Could not build the Connections board:', error);
        return { statusCode: 502, headers, body: JSON.stringify({ error: String(error.message || error) }) };
    }
};
