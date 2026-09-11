const path = require('path');
const fs = require('fs');
const feather = require('feather-icons');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const dist = path.resolve(__dirname, 'dist');
// Each game builds into its own folder so it can be served from /<game> with a clean URL.
// The only part of the footer that differs per game is the link out to the real puzzle.
const playLinks = {
    connections: { name: 'Connections', url: 'https://www.nytimes.com/games/connections' },
    geozee: { name: 'Geozee', url: 'https://geozee.earth' },
    geogrid: { name: 'Geogrid', url: 'https://www.geogridgame.com' },
    weaver: { name: 'Weaver', url: 'https://wordwormdormdork.com/weaver/' },
    wordle: { name: 'Wordle', url: 'https://www.nytimes.com/games/wordle' }
};
const gameSources = { 'category-map': 'world-map' };
const games = [...Object.keys(playLinks), ...Object.keys(gameSources)];

const footerTemplate = fs.readFileSync(path.resolve(__dirname, 'shared/html/footer.html'), 'utf8').trimEnd();
const buttonClass = 'btn btn-outline-light btn-floating m-1';

// Drawn at build time so the footer needs no script and the landing page needs no bundle.
const githubIcon = feather.icons.github.toSvg();

// The landing page is the playbook home with no puzzle of its own, so it renders with no game.
function renderFooter(game) {
    const link = playLinks[game];
    const playButton = link
        ? '<a class="' + buttonClass + '" href="' + link.url + '" target="_blank" role="button">Play ' + link.name + '</a>'
        : '';
    const playbookHomeButton = game
        ? '<a class="' + buttonClass + '" href="https://playbook.trailmatt.com" role="button">Playbook Home</a>'
        : '';
    return footerTemplate
        .replace('{{playButton}}', playButton)
        .replace('{{playbookHomeButton}}', playbookHomeButton)
        .replace('{{githubIcon}}', githubIcon);
}

const gameEntries = {};
const gameCopies = [];
const gamePages = [];
games.forEach((game) => {
    const source = gameSources[game] || game;
    gameEntries[game + '/main'] = './games/' + source + '/js/main.js';
    // The tags are injected rather than hardcoded so the hashed filenames stay in sync.
    gamePages.push(new HtmlWebpackPlugin({
        template: 'games/' + source + '/index.html',
        filename: path.join(game, 'index.html'),
        chunks: [game + '/main'],
        inject: 'head',
        scriptLoading: 'blocking',
        minify: false,
        templateParameters: { footer: renderFooter(game) },
    }));
    gameCopies.push({ from: 'games/' + source + '/manifest.json', to: path.join(dist, game, 'manifest.json'), noErrorOnMissing: true });
    gameCopies.push({ from: 'games/' + source + '/js/service-worker.js', to: path.join(dist, game, 'service-worker.js'), noErrorOnMissing: true });
});

module.exports = {
    entry: gameEntries,
    output: {
        filename: '[name].[contenthash].bundle.js',
        path: dist,
        publicPath: '/',
        clean: true,
    },
    devtool: 'source-map',
    resolve: {
        alias: {
            '@shared': path.resolve(__dirname, 'shared'),
        },
    },
    module: {
        rules: [
            {
                test: /\.css$/,
                use: [
                    MiniCssExtractPlugin.loader,
                    'css-loader',
                ],
            },
        ],
    },
    plugins: [
        new MiniCssExtractPlugin({
            filename: '[name].[contenthash].css',
        }),
        ...gamePages,
        // Templated rather than copied so it shares the one footer. It has no script of its own.
        new HtmlWebpackPlugin({
            template: 'src/landing/index.html',
            filename: 'index.html',
            chunks: [],
            inject: false,
            minify: false,
            templateParameters: { footer: renderFooter() },
        }),
        new CopyWebpackPlugin({
            patterns: [
                ...gameCopies,
                { from: 'games/world-map/data', to: path.join(dist, 'category-map/data') },
                { from: 'games/world-map/img', to: path.join(dist, 'category-map/img') },
                { from: 'node_modules/d3-geo/LICENSE', to: path.join(dist, 'category-map/licenses/d3-geo.txt') },
                { from: 'node_modules/d3-array/LICENSE', to: path.join(dist, 'category-map/licenses/d3-array.txt') },
                { from: 'node_modules/internmap/LICENSE', to: path.join(dist, 'category-map/licenses/internmap.txt') },
                { from: 'node_modules/topojson-client/LICENSE', to: path.join(dist, 'category-map/licenses/topojson-client.txt') },
                { from: 'games/wordle/wordle-guesses-LICENSE.txt', to: path.join(dist, 'wordle/wordle-guesses-LICENSE.txt') },
                { from: 'src/landing/style.css', to: path.join(dist, 'landing.css') },
                // Copied rather than left in dist, which is cleaned on every build.
                { from: 'src/robots.txt', to: path.join(dist, 'robots.txt') },
                { from: 'shared/style/base.css', to: path.join(dist, 'base.css') },
                { from: 'dep', to: path.join(dist, 'dep') },
                { from: 'img', to: path.join(dist, 'img') },
            ],
        }),
    ],
    mode: 'production',
};
