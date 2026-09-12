# Puzzle Playbook

Scratchpads for daily puzzle games, at [playbook.trailmatt.com](https://playbook.trailmatt.com).

Each helper lets you plan the whole puzzle before you commit to a guess:

- **[/connections](https://playbook.trailmatt.com/connections)** — group the sixteen words into four sets.
- **[/weaver](https://playbook.trailmatt.com/weaver)** — build the word ladder from either end.
- **[/wordle](https://playbook.trailmatt.com/wordle)** — bank the words that still fit, Word500 too.
- **[/geogrid](https://playbook.trailmatt.com/geogrid)** — collect the countries that fit each square.
- **[/geozee](https://playbook.trailmatt.com/geozee)** — drag nine flags into nine categories.

## Wordle dictionary

The helper uses 3,209 WordleBot candidate answers from the July 14, 2026
[WordGamesBot snapshot](https://github.com/WordGamesBot/wordgamesbot.github.io/blob/90dc1f4855d14adb39d0f944d6af6fe48ef6d3e0/WordLists/NYT/Answers_with_ED.js).
These are estimated possible answers, not an exhaustive official NYT answer pool.
The same list supplies Word500's common-word ranking; its wider dictionary is unchanged.

Legal guesses come from the 14,855-word
[tabatkins/wordle-list snapshot](https://github.com/tabatkins/wordle-list/blob/255b9469c4dad99a3b95cc4ddbe139b3d3747868/words)
(September 6, 2022, MIT license). The helper combines these with the newer answer candidates.
Matching words appear alphabetically, with answer candidates in black and legal guess-only words in gray.
The four suggestions still use only answer candidates. This is a bundled dictionary,
not a live check against NYT's current accepted guesses.

By default, the top row temporarily filters candidates by letter position alongside the
green clues. Clearing a top-row letter removes that temporary constraint. Add `?help=1`
to show the yellow and red clue rows and use the top row as a guess checker instead.
Word500 is unchanged.

## Layout

    games/<name>/     one game: index.html, js/, style/
    shared/           drag engine, board loader, date picker, loading overlay
    lambda/<name>.mjs the scraper behind /<name>/board
    infra/            the CloudFront functions for clean URLs and the old redirect
    tools/            local dev server
    src/landing/      the landing page

## Running it

    npm install
    npm start

That builds into `dist/` and serves it on port 8080 with the same clean-URL rewriting
CloudFront does. It also runs the board Lambdas in-process, so `/connections/board` and
`/geozee/board` work without touching AWS.

`npm run build` builds without serving, and `npm run watch` rebuilds on change.

## Adding a game

1. `games/<name>/` with an `index.html` using **absolute** asset paths
   (`/<name>/main.bundle.js`, not `main.bundle.js`). Relative paths break at `/<name>`
   because the browser resolves them against `/`.
2. Add the name and its play link to `playLinks` in `webpack.config.js`.
3. `lambda/<name>.mjs` for the board, plus a route on the `playbook-boards` API and a
   matching route on the CloudFront distribution. Skip this if the helper has no daily
   board to fetch, the way `/wordle` doesn't.
4. Register it in `tools/dev-server.mjs` and add a card to the landing page.

The shared drag engine already covers mouse, touch, and the short-touch-is-a-tap rule, so
a new game supplies selectors and callbacks rather than writing its own event handling.

## Deploying

Push to `release`. `main` is not deployed.

The workflow syncs `dist/` to S3, updates both board Lambdas, and invalidates CloudFront.
Cache headers are deliberately short because the bundle filenames aren't hashed.
