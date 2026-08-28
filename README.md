# Puzzle Playbook

Scratchpads for daily puzzle games, at [playbook.trailmatt.com](https://playbook.trailmatt.com).

Each helper lets you plan the whole puzzle before you commit to a guess:

- **[/connections](https://playbook.trailmatt.com/connections)** — group the sixteen words into four sets.
- **[/geozee](https://playbook.trailmatt.com/geozee)** — drag nine flags into nine categories.

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
2. Add the name to the `games` array in `webpack.config.js`.
3. `lambda/<name>.mjs` for the board, plus a route on the `playbook-boards` API and a
   matching route on the CloudFront distribution.
4. Register it in `tools/dev-server.mjs` and add a card to the landing page.

The shared drag engine already covers mouse, touch, and the short-touch-is-a-tap rule, so
a new game supplies selectors and callbacks rather than writing its own event handling.

## Deploying

Push to `release`. `main` is not deployed.

The workflow syncs `dist/` to S3, updates both board Lambdas, and invalidates CloudFront.
Cache headers are deliberately short because the bundle filenames aren't hashed.
