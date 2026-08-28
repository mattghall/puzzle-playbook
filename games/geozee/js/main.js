importAll(require.context('../style', false, /\.css$/));
import '@shared/style/base.css';
import feather from 'feather-icons';
import { createDragEngine } from '@shared/js/dragdrop';
import { startLoading, endLoading } from '@shared/js/loading';
import { attachDatePicker } from '@shared/js/dates';
import { loadBoard } from '@shared/js/board';
const mainJsVersion = 1.3;

function importAll(r) {
    r.keys().forEach(r);
}

let board = { date: '', categories: [], countries: [] };
let placements = {};
let selectedCode = null;
let previewCode = null;
let flagCache = {};
let flagFailed = {};
let showPicks = false;

function countryByCode(code) {
    return board.countries.find(c => c.code === code);
}

// Two letter code to regional indicators, which is how Geozee draws its own flags.
function flagEmoji(code) {
    const upper = (code || '').toUpperCase();
    if (upper.length !== 2) return '🏳️';
    return String.fromCodePoint(...[...upper].map(ch => 127397 + ch.charCodeAt(0)));
}

function slotOf(code) {
    return Object.keys(placements).find(catId => placements[catId] === code) || null;
}

function buildCountryBox(code, inStrip) {
    const div = document.createElement('div');
    div.classList.add('country');
    div.dataset.code = code;
    const placed = !!slotOf(code);
    // The strip keeps Geozee's deal order, so a placed country grays out in place rather than leaving.
    if (inStrip && placed) {
        div.classList.add('used');
    } else {
        div.draggable = true;
    }
    if (code === selectedCode) {
        div.classList.add('selected');
    }
    const country = countryByCode(code);
    div.innerHTML = '<span class="flag">' + flagEmoji(code) + '</span>' +
        '<span class="country-name"></span>';
    $(div).find('.country-name').text(country ? country.name : code);
    attachCountryEvents(div);
    return div;
}

function renderBoard() {
    $('#board').empty();
    board.categories.forEach((category) => {
        const slot = document.createElement('div');
        slot.classList.add('slot');
        slot.dataset.category = category.id;

        const placed = placements[category.id];
        if (placed) {
            slot.classList.add('filled');
        }

        const head = document.createElement('div');
        head.classList.add('slot-head');
        const title = document.createElement('div');
        title.classList.add('slot-name');
        title.textContent = category.name;
        head.appendChild(title);

        const rule = document.createElement('div');
        rule.classList.add('slot-rule');
        rule.textContent = category.ruleCompact || category.rule || '';
        rule.title = category.rule || '';

        const drop = document.createElement('div');
        drop.classList.add('slot-drop');
        if (placed) {
            drop.appendChild(buildCountryBox(placed, false));
        }

        slot.appendChild(head);
        slot.appendChild(rule);
        slot.appendChild(drop);
        attachSlotEvents(slot, category);
        $('#board').append(slot);
    });
}

function renderQueue() {
    $('#queue').empty();
    board.countries.forEach((country) => {
        const cell = document.createElement('div');
        cell.classList.add('flag-slot');
        cell.dataset.code = country.code;
        if (slotOf(country.code)) {
            cell.classList.add('empty');
        }
        cell.appendChild(buildCountryBox(country.code, true));
        attachStripEvents(cell);
        $('#queue').append(cell);
    });
    const left = board.countries.filter(c => !slotOf(c.code)).length;
    $('#queue-label').text(left ? 'Countries — ' + left + ' left' : 'All nine placed');
}

function renderPicks() {
    $('#picks-list').empty();
    // Deal order, so a row never moves once the board is dealt.
    board.countries.forEach((country) => {
        const catId = slotOf(country.code);
        const category = catId ? board.categories.find(c => c.id === catId) : null;
        const row = document.createElement('div');
        row.classList.add('pick-row');
        row.classList.add(category ? 'placed' : 'unplaced');

        const flag = document.createElement('span');
        flag.classList.add('flag');
        flag.textContent = flagEmoji(country.code);

        const name = document.createElement('span');
        name.classList.add('pick-country');
        $(name).text(country.name);

        const sep = document.createElement('span');
        sep.classList.add('pick-sep');
        sep.textContent = '-';

        const cat = document.createElement('span');
        cat.classList.add('pick-category');
        $(cat).text(category ? category.name : 'Not placed');

        row.appendChild(flag);
        row.appendChild(name);
        row.appendChild(sep);
        row.appendChild(cat);
        $('#picks-list').append(row);
    });
}

function flagUrl(code) {
    return 'https://flagcdn.com/' + code.toLowerCase() + '.svg';
}

// Fetch all nine flags up front so clicking one swaps instantly.
function preloadFlags() {
    board.countries.forEach((country) => {
        const code = country.code;
        if (flagCache[code]) {
            return;
        }
        const img = document.createElement('img');
        img.className = 'flag-preview-img';
        img.alt = country.name || code;
        // Native handler so jQuery's cleanup on re-render doesn't strip it.
        img.onerror = function () {
            flagFailed[code] = true;
            console.log('Could not preload the flag for ' + code);
            if (previewCode === code || !previewCode) {
                renderPreview();
            }
        };
        img.src = flagUrl(code);
        flagCache[code] = img;
    });
}

function renderPreview() {
    const code = previewCode || (board.countries[0] && board.countries[0].code);
    $('#flag-preview').empty();
    if (!code) {
        return;
    }
    const country = countryByCode(code);
    if (flagFailed[code]) {
        // Fall back to the emoji if the CDN is unreachable, e.g. offline.
        $('#flag-preview').append('<div class="flag-preview-fallback">' + flagEmoji(code) + '</div>');
    } else {
        if (!flagCache[code]) {
            preloadFlags();
        }
        $('#flag-preview').append(flagCache[code]);
    }
    const name = document.createElement('div');
    name.className = 'flag-preview-name';
    $(name).text(country ? country.name : code);
    $('#flag-preview').append(name);
}

function renderAll() {
    renderBoard();
    renderQueue();
    renderPicks();
    renderPreview();
    feather.replace();
    endLoading();
}

// The classes only bite below the lg breakpoint, so desktop always shows both columns.
function applyMobileView() {
    $('#picks-col').toggleClass('mobile-hidden', !showPicks);
    $('#game-col').toggleClass('mobile-hidden', showPicks);
    $('#view-toggle-btn').text(showPicks ? 'Grid' : 'List');
}

function placeCountry(code, catId) {
    const from = slotOf(code);
    const occupant = placements[catId];
    if (occupant === code) return;
    console.log('Placing ' + code + ' in ' + catId);

    if (occupant && from) {
        placements[from] = occupant;
    } else if (from) {
        delete placements[from];
    }
    placements[catId] = code;
    selectedCode = null;
    renderAll();
}

function returnCountry(code) {
    const from = slotOf(code);
    if (!from) return;
    console.log('Returning ' + code + ' to the strip');
    delete placements[from];
    selectedCode = null;
    renderAll();
}

function resetBoard() {
    startLoading();
    placements = {};
    selectedCode = null;
    previewCode = null;
    renderAll();
}

async function initializeGame(date) {
    startLoading();
    $('#fetch-error').hide();
    const result = await loadBoard({
        game: 'geozee',
        date: date,
        fallback: defaultBoard,
        validate: function (data) {
            return data && Array.isArray(data.countries) && data.countries.length === 9;
        }
    });
    board = result.board;
    if (!result.live) {
        $('#fetch-error').text("Couldn't reach the board API, so this is round #001 from 2026-07-09, not today's puzzle.").show();
    }
    flagCache = {};
    flagFailed = {};
    preloadFlags();
    resetBoard();
}

$(function () {
    feather.replace();
    $('#loading-overlay').show();

    $('#main-version-span').text(mainJsVersion);

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('/geozee/service-worker.js').then(function (registration) {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            }, function (error) {
                console.log('ServiceWorker registration failed: ', error);
            });
        });
    }

    const currentDate = attachDatePicker('#date-picker', initializeGame);
    applyMobileView();
    initializeGame(currentDate);

    $('#clear-btn').on('click', function () {
        resetBoard();
        console.log('Reset');
    });

    $('#view-toggle-btn').on('click', function () {
        showPicks = !showPicks;
        applyMobileView();
        console.log('Showing the ' + (showPicks ? 'picks list' : 'grid'));
    });

    $('.version-span').on('click', function () {
        $('.fileVersions').toggle();
    });

    // Dropping a country outside the board sends it back rather than losing the drag.
    drag.makeDropTarget($('#queue').get(0), {
        onDrop: function (target, source) {
            returnCountry(source.dataset.code);
        }
    });

    $('body, #footer-row').on('dragstart', function (event) {
        if (!$(event.target).hasClass('country')) {
            event.preventDefault();
        }
    });
});

// A country in the strip sits inside its own .flag-slot drop target, so findTarget has to
// resolve to the nearest real target rather than whatever node is under the finger.
const drag = createDragEngine({
    dragSelector: '.country',
    dropSelector: '.slot, .flag-slot, #queue',
    findTarget: function (node) {
        return $(node).closest('.slot, .flag-slot, #queue').get(0) || null;
    }
});

function dropOnTarget(target, code) {
    if (!target || !code) return;
    const slot = $(target).closest('.slot');
    if (slot.length) {
        placeCountry(code, slot.data('category'));
        return;
    }
    if ($(target).closest('#queue').length) {
        returnCountry(code);
    }
}

function attachCountryEvents(div) {
    const onTap = function () {
        const code = div.dataset.code;
        previewCode = code;
        if (slotOf(code)) {
            returnCountry(code);
        } else {
            selectedCode = selectedCode === code ? null : code;
            console.log('Selected ' + selectedCode);
            renderAll();
        }
    };

    // The grayed copy in the strip is a marker, not something to pick up.
    if ($(div).hasClass('used')) {
        $(div).on('click', function (e) {
            e.stopPropagation();
            onTap();
        });
        return;
    }

    drag.makeDraggable(div, {
        onTap: onTap,
        onPick: function () {
            previewCode = div.dataset.code;
            renderPreview();
        },
        onDrop: function (target, source) {
            dropOnTarget(target, source.dataset.code);
        }
    });
}

// Each country has its own slot in the strip, so a drop anywhere in the strip sends it home.
function attachStripEvents(cell) {
    drag.makeDropTarget(cell, {
        onDrop: function (target, source) {
            returnCountry(source.dataset.code);
        }
    });
}

function attachSlotEvents(slot, category) {
    $(slot).on('click', function () {
        if (selectedCode) {
            placeCountry(selectedCode, category.id);
        }
    });

    drag.makeDropTarget(slot, {
        onDrop: function (target, source) {
            placeCountry(source.dataset.code, category.id);
        }
    });
}

// Round #001, shown only when the board API can't be reached. The banner says so.
const defaultBoard = {
    date: "2026-07-09",
    countries: [
        { code: "lt", name: "Lithuania" },
        { code: "eg", name: "Egypt" },
        { code: "sz", name: "Eswatini" },
        { code: "tr", name: "Türkiye" },
        { code: "es", name: "Spain" },
        { code: "gg", name: "Bailiwick of Guernsey" },
        { code: "ci", name: "Côte d'Ivoire" },
        { code: "ke", name: "Kenya" },
        { code: "zm", name: "Zambia" }
    ],
    categories: [
        { id: "vast", name: "Vast", rule: "100 max — larger is better (1 pt / 20,000 km²)", ruleCompact: "100 max: larger wins (1 pt / 20,000 km²)" },
        { id: "starFlag", name: "Star/Sun Flag", rule: "100 pts if flag features a star/sun", ruleCompact: "100 if flag features a star/sun" },
        { id: "tiny", name: "Tiny", rule: "100 max — smaller is better (0 above 10,000 km²)", ruleCompact: "100 max: smaller wins (0 above 10,000 km²)" },
        { id: "north", name: "Northern Hemisphere", rule: "100 pts if in Northern Hemisphere", ruleCompact: "100 if in Northern Hemisphere" },
        { id: "languages", name: "Many Languages", rule: "100 max — 2 pts × living languages", ruleCompact: "100 max: 2 pts × languages" },
        { id: "population", name: "Population", rule: "100 max — 1 pt per million", ruleCompact: "100 max: 1 pt per million" },
        { id: "equator", name: "On the Equator", rule: "100 pts if it touches the equator", ruleCompact: "100 if it touches the equator" },
        { id: "wet", name: "Wet", rule: "100 max — more annual rainfall is better", ruleCompact: "100 max: more rainfall wins" },
        { id: "worldCup", name: "Men's FIFA World Cup", rule: "50 played · 100 won", ruleCompact: "50 played · 100 won" }
    ]
};
