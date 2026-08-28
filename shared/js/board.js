// Every game's board comes from a Lambda behind /<game>/board on the same origin, so no
// API hostname ever ends up in the bundle.
export function boardUrl(game, date) {
    return date ? '/' + game + '/board?date=' + date : '/' + game + '/board';
}

// Fetches the board and falls back to a canned one so the page still works offline.
// The fallback should look obviously different from a live board, otherwise a broken
// fetch is indistinguishable from a working one.
export async function loadBoard(options) {
    const url = boardUrl(options.game, options.date);
    console.log('Fetching ' + url);
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (options.validate && !options.validate(data)) {
            throw new Error('Board did not look right');
        }
        return { board: data, live: true };
    } catch (error) {
        console.log('Could not fetch the board: ' + error);
        return { board: options.fallback, live: false };
    }
}
