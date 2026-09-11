# Puzzle Playbook

Scratchpads for daily puzzle games, at [playbook.trailmatt.com](https://playbook.trailmatt.com).

Each helper lets you plan the whole puzzle before you commit to a guess:

- **[/connections](https://playbook.trailmatt.com/connections)** — group the sixteen words into four sets.
- **[/weaver](https://playbook.trailmatt.com/weaver)** — build the word ladder from either end.
- **[/wordle](https://playbook.trailmatt.com/wordle)** — bank the words that still fit, Word500 too.
- **[/geogrid](https://playbook.trailmatt.com/geogrid)** — collect the countries that fit each square.
- **[/category-map](https://playbook.trailmatt.com/category-map)** — explore countries and filter them by category.
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

## Category map

`/category-map` has Globe and Map views; Map uses the Equal Earth projection.
The home page links to it. Source files and update commands retain the internal
`world-map` name.
Country fills: natural, white, neighbor colors, images, and criteria.
Flags preload in the background when the page opens. Images view shows a loading
panel with progress until its image set is ready; other views remain usable.
Display and filter settings stay in the URL, so links can be copied, bookmarked,
and reopened. For example, `/category-map?display=images&view=map` opens flags on
the flat map. `display` also accepts `natural`, `white`, `neighbors`, `criteria`,
and `timezones`. Filters use readable parameters such as `flag-color=red`,
`official-language=arabic`, `rainfall-min=500`, and `olympic-medals-exact=0`.
Repeat a parameter to select multiple values; prefix it with `not-` to exclude it,
as in `not-flag-color=red`. Older `filter`/`exclude` links still open and are
rewritten using friendly names. `match=any` uses Any instead of All. `images`, `timezone`, `capitals=1`,
`largest=1`, and `cities=1` through `cities=10` store the remaining display settings.
Defaults are omitted. Unknown filters or invalid settings show a warning.
Browsing categories, selected countries, and the current pan/zoom aren't saved.
Small countries have compact flag cutouts in image mode and colored bubbles in
criteria mode. Names appear on hover, keyboard focus, or selection. Short leader
lines point to their locations. Marker boxes occupy at most 4% of the map and
follow both projections; zooming separates crowded markers. Countries
without outlines use GeoGrid's coordinates where available, without inventing
geometry. Missing images retain a labeled placeholder.
Capitals and the top 1–10 cities per country are separate overlays.
Government seats retain their specific roles; they aren't all labeled capitals.
City rankings use city-proper population, not metropolitan population.

Geography and terrain come from Natural Earth. **Every category uses
[GeoGrid's combined dataset](https://cdn-assets.teuteuf.fr/data/geogrid/combined.json)
as its source of truth**, including flag colors, population, borders, and the other
[Categories Atlas](https://www.geogridgame.com/) fields. The atlas defines the available
conditions and variants; Wikipedia isn't a fallback for category matching.

Search the full world atlas and select any number of conditions. Combine them with
All or Any; Exclude reverses an individual condition. Opposing conditions can produce
no matches. Missing source values remain unknown, even when excluded. Areas outside
GeoGrid's country set have a separate status.
Flag choices share color and feature groups; single-option categories don't repeat
their headings. Stars and suns share GeoGrid's single condition.
Individual flag colors use With/Without swatch pickers for GeoGrid's eleven colors.
Multiple colors can be selected; legacy duplicate color variants share one swatch.
Numeric filters have two handles, including categories with only one bound in the
original atlas. Stops use the atlas's thresholds, zero, and every integer border
count. Both handles on the same value select an exact match, including
zero Olympic medals. Otherwise, bounds retain strict over/under comparisons.
The outside endpoints apply no filter and show zero (or a negative source minimum)
in the category's units and infinity. Missing numeric facts remain unknown.
Removing a bound's chip resets that handle; removing an exact-match chip resets both.
Letter, name-length, language, timezone, religion, former-colony, empire, and
neighbor-country filters use dropdowns. Choose another option to add a condition;
remove selections using their chips. Top/bottom-20 categories share the Rankings section.
Same-sex laws use a Legal / Off / Illegal switch. Legal selects GeoGrid's marriage
condition; Illegal selects its sexual-activity condition. Off removes either filter.
Selected filters share a fixed-height toolbar with Match and Clear all, even when
Display is collapsed. Chips scroll horizontally instead of resizing the map.
Use the x to remove one, click its name to toggle exclusion, or use Clear all.
Other fill modes show them as saved, not applied.
Hover a country or tap it on mobile to see its name on the map.
Click or tap empty map space to clear the country and city selection.
On desktop, countries and their details sit left of the map, with controls on the
right. Display and GeoGrid categories have independent drawers. Clicking the
selected country's name again clears its selection. The page fits the viewport;
the country and map panels have equal height, with scrolling inside the side panels.
Narrow screens keep the map above the side panels in a scrollable content area.

The Time zones view colors countries by their GeoGrid UTC offsets. Purple indicates
multiple zones; choose an offset from the dropdown or color key to highlight all
countries that observe it. Hover or select a country to see its recorded offsets.
This view uses country-level facts, not internal timezone boundary polygons or
a live daylight-saving clock.

The snapshot includes 127 category IDs and 441 variants for 249 countries.
The 20 capital-related variants use GeoGrid's separate `common/cities.json`:
capital names are available for 243 countries/territories, and at least one capital
population is available for 242. Multiple capitals are kept separately; each
population bound or exact match can match any capital. Missing populations remain
unknown unless another capital proves a match. Capital initials use normalized
English names, without removing articles such as "The".

The capital/largest-city comparison has sufficient evidence for 164 countries.
It compares recorded cities, not an exhaustive census ranking. Missing populations
that could change the result and countries with fewer than two populated cities
remain unknown. Places without a designated capital aren't assigned one.
GeoGrid doesn't supply population dates or consistent city/metro boundaries;
these are its recorded figures, not standardized current census counts.
All non-capital category facts and missing values remain from `combined.json`.

Flag colors follow GeoGrid's eleven-color palette: black, white, gray, pink, red,
orange, yellow, green, blue, purple, and brown. Shades aren't separate choices.
GeoGrid doesn't cite a separate source for its flag-color field.

Wikipedia supplies city overlays; flags and other image assets come from Wikimedia
Commons. City rankings aren't exhaustive; coverage appears in country details.
Bundled snapshots record sources, checksums, revisions, observation years, and image
licenses where applicable. Natural Earth's boundaries use de facto territory groupings.
Countries without geometry, including Tuvalu, remain in category results without an
invented outline.

### Updating data

```sh
npm run world-map:update -- --scope facts
npm run world-map:update -- --scope cities
npm run world-map:update -- --scope images
npm run world-map:update -- --scope atlas
npm run world-map:update -- --scope capitals
git diff -- games/world-map/data games/world-map/img
npm run build
```

Review the diff and `/category-map` locally before requesting a release.
The update command doesn't commit, push, or publish.
Use `--country USA` to limit a Wikipedia or image refresh to one country.
Atlas refreshes update the entire category dataset together. They discover the
current public atlas, refresh combined and city data, and rebuild category memberships.
Capital-only refreshes fetch just GeoGrid's cities and preserve every non-capital
fact and membership, including unknowns. They don't update Wikipedia city overlays.
New or changed unsupported category rules fail before either snapshot is replaced.
Snapshot files must be clean before a refresh. Failed updates preserve existing data.
Concurrent edits aren't overwritten. New Wikipedia coverage requires a source mapping;
changed Wikipedia layouts need an explicit mapping update.

`node tools/world-map/verify-sources.mjs` replays pinned Wikipedia sources.
`node tools/world-map-geography.mjs` rebuilds geography from pinned Natural Earth
downloads; it requires `curl`, Python 3, and Pillow. Normal builds use bundled data.

### Image sets

`games/world-map/data/image-sets.json` registers image sets by ID.
Each set maps country IDs to local images, labels, credits, and placement.
Flags are the initial set. Portraits, seals, and paintings use the same format.

```json
{
  "src": "img/example/FRA.webp",
  "label": "Image title",
  "source": {
    "title": "File:Example.webp",
    "url": "https://commons.wikimedia.org/wiki/File:Example.webp",
    "creator": "Artist",
    "license": "CC0",
    "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
    "sha256": "<file SHA-256>"
  },
  "placement": {
    "fit": "cover",
    "focalPoint": [0.5, 0.5],
    "scale": 1,
    "offset": [0, 0],
    "background": "#ffffff"
  }
}
```

Use `contain` to preserve the whole image or `stretch` to fit all bands of a flag
across a region. Generic images default to `cover`. Focal points and offsets use fractions
of the placement bounds. `regions` supplies placement overrides keyed by region
index; regions are grouped geographically, largest first. Images stay anchored
to geography in both projections. Disconnected regions can use separate placements.
Optional `rotation` is clockwise degrees within the placement bounds.
SVG, PNG, JPEG, and WebP are supported. Only use assets with verified reuse rights.
Keep the Commons file title and file checksum with each entry. The image updater
refreshes registered sets from those titles; it doesn't choose artwork for you.

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
2. Add the name and its play link to `playLinks` in `webpack.config.js`. Standalone
   tools without an external game go directly in `games`.
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
