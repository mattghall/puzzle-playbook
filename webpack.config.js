const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const dist = path.resolve(__dirname, 'dist');
// Each game builds into its own folder so it can be served from /<game> with a clean URL.
const games = ['connections', 'geozee', 'geogrid', 'weaver'];

const gameEntries = {};
const gameCopies = [];
const gamePages = [];
games.forEach((game) => {
    gameEntries[game + '/main'] = './games/' + game + '/js/main.js';
    // The tags are injected rather than hardcoded so the hashed filenames stay in sync.
    gamePages.push(new HtmlWebpackPlugin({
        template: 'games/' + game + '/index.html',
        filename: path.join(game, 'index.html'),
        chunks: [game + '/main'],
        inject: 'head',
        scriptLoading: 'blocking',
        minify: false,
    }));
    gameCopies.push({ from: 'games/' + game + '/manifest.json', to: path.join(dist, game, 'manifest.json'), noErrorOnMissing: true });
    gameCopies.push({ from: 'games/' + game + '/js/service-worker.js', to: path.join(dist, game, 'service-worker.js'), noErrorOnMissing: true });
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
        new CopyWebpackPlugin({
            patterns: [
                ...gameCopies,
                { from: 'src/landing/index.html', to: path.join(dist, 'index.html') },
                { from: 'src/landing/style.css', to: path.join(dist, 'landing.css') },
                { from: 'shared/style/base.css', to: path.join(dist, 'base.css') },
                { from: 'dep', to: path.join(dist, 'dep') },
                { from: 'img', to: path.join(dist, 'img') },
            ],
        }),
    ],
    mode: 'production',
};
