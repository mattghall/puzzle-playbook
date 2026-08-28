const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const dist = path.resolve(__dirname, 'dist');

// Each game builds into its own folder so it can be served from /<game> with a clean URL.
const games = ['connections'];

const gameEntries = {};
const gameCopies = [];
games.forEach((game) => {
    gameEntries[game + '/main'] = './games/' + game + '/js/main.js';
    gameCopies.push({ from: 'games/' + game + '/index.html', to: path.join(dist, game, 'index.html') });
    gameCopies.push({ from: 'games/' + game + '/manifest.json', to: path.join(dist, game, 'manifest.json'), noErrorOnMissing: true });
    gameCopies.push({ from: 'games/' + game + '/js/service-worker.js', to: path.join(dist, game, 'service-worker.js'), noErrorOnMissing: true });
});

module.exports = {
    entry: gameEntries,
    output: {
        filename: '[name].bundle.js',
        path: dist,
        clean: true,
    },
    devtool: 'source-map',
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
            filename: '[name].css',
        }),
        new CopyWebpackPlugin({
            patterns: [
                ...gameCopies,
                { from: 'src/landing/index.html', to: path.join(dist, 'index.html') },
                { from: 'dep', to: path.join(dist, 'dep') },
                { from: 'img', to: path.join(dist, 'img') },
            ],
        }),
    ],
    mode: 'production',
};
