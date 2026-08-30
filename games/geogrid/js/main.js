importAll(require.context('../style', false, /\.css$/));
import '@shared/style/base.css';
import feather from 'feather-icons';
import { createDragEngine } from '@shared/js/dragdrop';
import { startChase } from '@shared/js/skeleton.js';
import { attachDatePicker } from '@shared/js/dates';
import { loadBoard } from '@shared/js/board';
const mainJsVersion = 1.0;

function importAll(r) {
    r.keys().forEach(r);
}

// Board #1 ran on this date, so the picker can't go back any further.
const firstBoardDate = '2024-04-07';
const maxResults = 5;

let board = { date: '', boardId: 0, rows: [], columns: [], countries: [] };
let candidates = {};
let placements = {};
let activeKey = null;
let searchTerm = '';
let results = [];
let focusedIndex = 0;
let selectedCode = null;

// Three row categories and three column categories, keyed by where they sit.
function categoryKeys() {
    return ['row0', 'row1', 'row2', 'col0', 'col1', 'col2'];
}

function categoryFor(key) {
    const list = key.startsWith('row') ? board.rows : board.columns;
    return list[Number(key.slice(3))] || null;
}

function countryByCode(code) {
    return board.countries.find(c => c.code === code);
}

// A square's own shortlist: everything you listed under both of its categories.
function applicableFor(index) {
    const rows = candidates['row' + Math.floor(index / 3)] || [];
    const cols = candidates['col' + (index % 3)] || [];
    return rows.filter(code => cols.includes(code));
}

function countryName(code) {
    const country = countryByCode(code);
    return country ? country.name : code;
}

// Two letter code to regional indicators, the same trick the other games use.
function flagEmoji(code) {
    const upper = (code || '').toUpperCase();
    if (upper.length !== 2) return '🏳️';
    return String.fromCodePoint(...[...upper].map(ch => 127397 + ch.charCodeAt(0)));
}

// A board that asks about flags can't have us drawing them, so names carry it instead.
function flagsAllowed() {
    return !categoryKeys().some(key => {
        const category = categoryFor(key);
        return category && /\bflags?\b/i.test(category.name);
    });
}

// Matches how Geogrid itself compares names: strip accents, punctuation and case.
function searchKey(name) {
    return String(name || '').trim().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[- '()]/g, '')
        .toLowerCase();
}

// The names Geogrid uses aren't always the ones people type, so both forms match.
const nameAliases = {
    "Côte d'Ivoire": 'Ivory Coast',
    'Åland': 'Aland Islands',
    'Timor-Leste': 'East Timor',
    'Federated States of Micronesia': 'Micronesia',
    'Bailiwick of Guernsey': 'Guernsey',
    'Cabo Verde': 'Cape Verde',
    'Réunion': 'Reunion',
    'Curaçao': 'Curacao',
    'Saint Barthélemy': 'Saint Barthelemy',
    'São Tomé and Príncipe': 'Sao Tome and Principe',
    'Türkiye': 'Turkey',
    'Naoero': 'Nauru'
};

function matchesTerm(country, term) {
    if (searchKey(country.name).includes(term)) return true;
    const alias = nameAliases[country.name];
    return !!alias && searchKey(alias).includes(term);
}

// Geogrid waits for two characters and shows five results, so this does too.
function runSearch() {
    const term = searchKey(searchTerm);
    if (term.length < 2) {
        results = [];
        focusedIndex = 0;
        return;
    }
    const taken = candidates[activeKey] || [];
    results = board.countries
        .filter(country => matchesTerm(country, term) && !taken.includes(country.code))
        .slice(0, maxResults);
    focusedIndex = 0;
}

function storageKey() {
    return 'geogrid-' + board.boardId;
}

// A scratchpad you retype after every refresh isn't much of a scratchpad.
function saveWork() {
    if (!board.boardId) return;
    try {
        localStorage.setItem(storageKey(), JSON.stringify({ candidates: candidates, placements: placements }));
    } catch (error) {
        console.log('Could not save this board: ' + error);
    }
}

function loadWork() {
    candidates = {};
    placements = {};
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey()) || '{}');
        if (saved && saved.candidates) candidates = saved.candidates;
        if (saved && saved.placements) placements = saved.placements;
    } catch (error) {
        console.log('Could not read the saved board: ' + error);
    }
}

function addCandidate(key, code) {
    const list = candidates[key] || [];
    if (list.includes(code)) return;
    candidates[key] = list.concat([code]);
    console.log('Added ' + code + ' to ' + key);
}

function removeCandidate(key, code) {
    candidates[key] = (candidates[key] || []).filter(c => c !== code);
}

function moveCandidate(fromKey, toKey, code) {
    if (fromKey === toKey) return;
    removeCandidate(fromKey, code);
    addCandidate(toKey, code);
}

function placeCountry(index, code) {
    placements[index] = code;
    selectedCode = null;
    console.log('Placed ' + code + ' in square ' + index);
}

function clearSquare(index) {
    delete placements[index];
}

// A country can only be used once on a real board, so a repeat is worth shouting about.
function isClashing(code) {
    return Object.values(placements).filter(c => c === code).length > 1;
}

function buildChip(key, code) {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.dataset.code = code;
    chip.dataset.key = key;
    chip.draggable = true;
    if (code === selectedCode) {
        chip.classList.add('selected');
    }
    if (Object.values(placements).includes(code)) {
        chip.classList.add('placed');
    }
    chip.innerHTML = '<span class="chip-flag"></span><span class="chip-name"></span>' +
        '<button type="button" class="chip-remove" aria-label="Remove">&times;</button>';
    $(chip).find('.chip-flag').text(flagsAllowed() ? flagEmoji(code) : '');
    $(chip).find('.chip-name').text(countryName(code));
    attachChipEvents(chip);
    return chip;
}

function buildResults() {
    const box = document.createElement('div');
    box.className = 'results';
    if (searchKey(searchTerm).length < 2) {
        return box;
    }
    if (!results.length) {
        const none = document.createElement('div');
        none.className = 'result-empty';
        none.textContent = 'No countries found';
        box.appendChild(none);
        return box;
    }
    results.forEach((country, i) => {
        const row = document.createElement('div');
        row.className = 'result';
        if (i === focusedIndex) {
            row.classList.add('focused');
        }
        row.innerHTML = '<span class="chip-flag"></span><span class="result-name"></span>';
        $(row).find('.chip-flag').text(flagsAllowed() ? flagEmoji(country.code) : '');
        $(row).find('.result-name').text(country.name);
        // Mousedown rather than click, so the input doesn't blur before the pick registers.
        $(row).on('mousedown', function (event) {
            event.preventDefault();
            chooseCountry(country.code);
        });
        box.appendChild(row);
    });
    return box;
}

// The cell stays exactly one grid square no matter how long its list gets.
const bubbleFlags = 4;

function buildCategory(key) {
    const category = categoryFor(key);
    const list = candidates[key] || [];
    const cell = document.createElement('div');
    cell.className = 'cat';
    cell.dataset.key = key;
    if (key === activeKey) {
        cell.classList.add('active');
    }

    const name = document.createElement('div');
    name.className = 'cat-name';
    name.textContent = category ? category.name : '';
    cell.appendChild(name);

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (!list.length) {
        bubble.classList.add('bubble-empty');
        bubble.textContent = 'Add';
    } else if (!flagsAllowed()) {
        bubble.classList.add('bubble-count');
        bubble.textContent = list.length + (list.length === 1 ? ' country' : ' countries');
    } else {
        list.slice(0, bubbleFlags).forEach((code) => {
            const flag = document.createElement('span');
            flag.className = 'bubble-flag';
            flag.textContent = flagEmoji(code);
            flag.title = countryName(code);
            bubble.appendChild(flag);
        });
        if (list.length > bubbleFlags) {
            const more = document.createElement('span');
            more.className = 'bubble-more';
            more.textContent = '+' + (list.length - bubbleFlags);
            bubble.appendChild(more);
        }
    }
    cell.appendChild(bubble);

    attachCategoryEvents(cell, key);
    return cell;
}

// Editing happens under the grid so an open list never covers the squares.
function buildEditor() {
    const panel = document.createElement('div');
    panel.className = 'editor-panel';

    const category = categoryFor(activeKey);
    const head = document.createElement('div');
    head.className = 'editor-head';
    const title = document.createElement('div');
    title.className = 'editor-title';
    title.textContent = category ? category.name : '';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'editor-close';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '&times;';
    $(close).on('click', function (event) {
        event.stopPropagation();
        closeCategory();
    });
    head.appendChild(title);
    head.appendChild(close);

    const field = document.createElement('div');
    field.className = 'editor-field';
    const input = document.createElement('input');
    input.className = 'cat-input';
    input.type = 'text';
    input.placeholder = 'Add a country';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = searchTerm;
    attachInputEvents(input);
    field.appendChild(input);
    field.appendChild(buildResults());

    const chips = document.createElement('div');
    chips.className = 'chips';
    (candidates[activeKey] || []).forEach(code => chips.appendChild(buildChip(activeKey, code)));

    panel.appendChild(head);
    panel.appendChild(field);
    panel.appendChild(chips);
    return panel;
}

function buildSquare(index) {
    const square = document.createElement('div');
    square.className = 'square';
    square.dataset.index = index;

    const chosen = document.createElement('div');
    chosen.className = 'square-chosen';
    const code = placements[index];
    if (code) {
        square.classList.add('filled');
        if (isClashing(code)) {
            square.classList.add('clash');
        }
        chosen.appendChild(buildPlaced(index, code));
    }
    square.appendChild(chosen);

    const applicable = applicableFor(index);
    if (applicable.length) {
        square.appendChild(buildApplicable(index, applicable));
    }

    attachSquareEvents(square, index);
    return square;
}

// Anything sitting in both of this square's categories, offered as one click picks.
function buildApplicable(index, codes) {
    const strip = document.createElement('div');
    strip.className = 'square-auto';
    const named = !flagsAllowed();
    codes.forEach((code) => {
        const flag = document.createElement('button');
        flag.type = 'button';
        flag.className = named ? 'auto-flag auto-named' : 'auto-flag';
        flag.textContent = named ? countryName(code) : flagEmoji(code);
        flag.title = countryName(code);
        if (placements[index] === code) {
            flag.classList.add('chosen');
        }
        $(flag).on('click', function (event) {
            event.stopPropagation();
            chooseForSquare(index, code);
        });
        strip.appendChild(flag);
    });
    return strip;
}

// Clicking an offered flag picks it, or takes it back out if it was already the pick.
function chooseForSquare(index, code) {
    if (placements[index] === code) {
        clearSquare(index);
    } else {
        placeCountry(index, code);
    }
    saveWork();
    renderAll();
}

function buildPlaced(index, code) {
    const placed = document.createElement('div');
    placed.className = 'placed';
    placed.dataset.code = code;
    placed.dataset.index = index;
    placed.draggable = true;

    if (flagsAllowed()) {
        const img = document.createElement('img');
        img.className = 'placed-flag';
        img.alt = countryName(code);
        // Native handler so jQuery's cleanup on re-render doesn't strip it.
        img.onerror = function () {
            $(img).replaceWith('<div class="placed-flag placed-flag-fallback">' + flagEmoji(code) + '</div>');
        };
        img.src = 'https://flagcdn.com/' + code + '.svg';
        placed.appendChild(img);
    } else {
        placed.classList.add('placed-nameonly');
    }

    const name = document.createElement('div');
    name.className = 'placed-name';
    $(name).text(countryName(code));
    placed.appendChild(name);
    attachPlacedEvents(placed);
    return placed;
}

function buildBadge() {
    const badge = document.createElement('div');
    badge.className = 'badge-cell';
    badge.innerHTML = '<div class="badge-label">Board</div><div class="badge-number"></div>';
    $(badge).find('.badge-number').text(board.boardId ? '#' + board.boardId : '');
    return badge;
}

function renderGrid() {
    $('#grid').empty();
    $('#grid').append(buildBadge());
    ['col0', 'col1', 'col2'].forEach(key => $('#grid').append(buildCategory(key)));
    for (let row = 0; row < 3; row++) {
        $('#grid').append(buildCategory('row' + row));
        for (let col = 0; col < 3; col++) {
            $('#grid').append(buildSquare(row * 3 + col));
        }
    }
}

// The tint travels the outside of the 3x3, leaving the middle square alone.
const skeletonRing = [0, 1, 2, 5, 8, 7, 6, 3];

// A full size grid before the board lands, so nothing jumps when it does.
function renderSkeleton() {
    $('#grid').empty();
    $('#editor').empty();
    $('#flag-note').hide();
    const badge = document.createElement('div');
    badge.className = 'badge-cell skeleton';
    $('#grid').append(badge);

    const cats = [];
    const squares = [];
    for (let i = 0; i < 3; i++) {
        const cat = document.createElement('div');
        cat.className = 'cat skeleton';
        cats.push(cat);
        $('#grid').append(cat);
    }
    for (let row = 0; row < 3; row++) {
        const cat = document.createElement('div');
        cat.className = 'cat skeleton';
        cats.push(cat);
        $('#grid').append(cat);
        for (let col = 0; col < 3; col++) {
            const square = document.createElement('div');
            square.className = 'square skeleton';
            squares.push(square);
            $('#grid').append(square);
        }
    }
    startChase(skeletonRing.map(i => squares[i]));
    startChase(cats);
}

function renderAll() {
    renderGrid();
    fitCategoryNames();
    $('#flag-note').toggle(!flagsAllowed());
    renderEditor();
    feather.replace();
    if (activeKey) {
        focusInput();
    }
}

// Cells can't grow, so a long category name shrinks until it fits its own box.
function fitCategoryNames() {
    $('#grid').find('.cat-name').each(function () {
        let size = 13;
        this.style.fontSize = size + 'px';
        while (this.scrollHeight > this.clientHeight && size > 8) {
            size -= 0.5;
            this.style.fontSize = size + 'px';
        }
    });
}

function renderEditor() {
    $('#editor').empty();
    $('#hint').toggle(!activeKey);
    if (activeKey) {
        $('#editor').append(buildEditor());
    }
}

// The panel is rebuilt on every change, so the caret has to be put back by hand.
function focusInput() {
    const input = $('#editor').find('.cat-input').get(0);
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
}

// Only the dropdown changes while typing, so the input keeps its caret.
function renderResults() {
    const field = $('#editor').find('.editor-field');
    if (!field.length) return;
    field.find('.results').remove();
    field.get(0).appendChild(buildResults());
}

// Clicking the open category again puts it away.
function openCategory(key) {
    if (activeKey === key) {
        closeCategory();
        return;
    }
    activeKey = key;
    searchTerm = '';
    results = [];
    focusedIndex = 0;
    console.log('Editing ' + key);
    renderAll();
}

function closeCategory() {
    if (!activeKey) return;
    activeKey = null;
    searchTerm = '';
    results = [];
    renderAll();
}

function chooseCountry(code) {
    addCandidate(activeKey, code);
    searchTerm = '';
    results = [];
    focusedIndex = 0;
    saveWork();
    renderAll();
}

function resetBoard() {
    candidates = {};
    placements = {};
    activeKey = null;
    searchTerm = '';
    results = [];
    selectedCode = null;
    saveWork();
    renderAll();
}

async function initializeGame(date) {
    renderSkeleton();
    $('#fetch-error').hide();
    const result = await loadBoard({
        game: 'geogrid',
        date: date,
        fallback: defaultBoard,
        validate: function (data) {
            return data && Array.isArray(data.rows) && data.rows.length === 3 &&
                Array.isArray(data.columns) && data.columns.length === 3 &&
                Array.isArray(data.countries) && data.countries.length > 0;
        }
    });
    board = result.board;
    if (!result.live) {
        $('#fetch-error').text("Couldn't reach the board API, so this is board #1 from 2024-04-07, not today's puzzle.").show();
    }
    activeKey = null;
    searchTerm = '';
    results = [];
    selectedCode = null;
    loadWork();
    renderAll();
}

$(function () {
    feather.replace();

    $('#main-version-span').text(mainJsVersion);

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('/geogrid/service-worker.js').then(function (registration) {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            }, function (error) {
                console.log('ServiceWorker registration failed: ', error);
            });
        });
    }

    const currentDate = attachDatePicker('#date-picker', initializeGame);
    $('#date-picker').attr('min', firstBoardDate);
    $('#date-picker').attr('max', currentDate);
    initializeGame(currentDate);

    $('#clear-btn').on('click', function () {
        resetBoard();
        console.log('Reset');
    });

    $('.version-span').on('click', function () {
        $('.fileVersions').toggle();
    });

    // Cells change width with the window, so the names have to be measured again.
    $(window).on('resize', fitCategoryNames);

    // Clicking off the board and the panel puts the open category away.
    $(document).on('click', function (event) {
        if (!$(event.target).closest('.cat, #editor').length) {
            closeCategory();
        }
    });

    $('body, #footer-row').on('dragstart', function (event) {
        if (!$(event.target).hasClass('chip') && !$(event.target).hasClass('placed')) {
            event.preventDefault();
        }
    });
});

// The target is whichever container the pointer landed in, not the exact node under it.
const drag = createDragEngine({
    dragSelector: '.chip, .placed',
    dropSelector: '.cat, .square',
    findTarget: function (node) {
        return $(node).closest('.cat, .square').get(0) || null;
    }
});

function dropOnTarget(target, source) {
    const code = source.dataset.code;
    const fromKey = source.dataset.key;
    const fromIndex = source.dataset.index;
    const square = $(target).closest('.square');
    if (square.length) {
        placeCountry(Number(square.data('index')), code);
    } else {
        const cell = $(target).closest('.cat');
        if (!cell.length) return;
        const toKey = cell.data('key');
        if (fromKey !== undefined) {
            moveCandidate(fromKey, toKey, code);
        } else {
            addCandidate(toKey, code);
        }
    }
    // Dragging out of a square empties it, whether it landed in another square or a category.
    if (fromIndex !== undefined) {
        clearSquare(Number(fromIndex));
    }
    saveWork();
    renderAll();
}

function attachChipEvents(chip) {
    drag.makeDraggable(chip, {
        onTap: function () {
            const code = chip.dataset.code;
            selectedCode = selectedCode === code ? null : code;
            console.log('Selected ' + selectedCode);
            renderAll();
        },
        onDrop: function (target, source) {
            dropOnTarget(target, source);
        }
    });

    // Bound after the drag engine so removing a chip doesn't also select it.
    $(chip).find('.chip-remove').on('click', function (event) {
        event.stopPropagation();
        removeCandidate(chip.dataset.key, chip.dataset.code);
        saveWork();
        renderAll();
    });
}

function attachPlacedEvents(placed) {
    drag.makeDraggable(placed, {
        onTap: function () {
            clearSquare(Number(placed.dataset.index));
            saveWork();
            renderAll();
        },
        onDrop: function (target, source) {
            dropOnTarget(target, source);
        }
    });
}

function attachCategoryEvents(cell, key) {
    $(cell).on('click', function () {
        openCategory(key);
    });

    drag.makeDropTarget(cell, {
        onDrop: function (target, source) {
            dropOnTarget(target, source);
        }
    });
}

function attachSquareEvents(square, index) {
    $(square).on('click', function () {
        if (selectedCode) {
            placeCountry(index, selectedCode);
            saveWork();
            renderAll();
        }
    });

    drag.makeDropTarget(square, {
        onDrop: function (target, source) {
            dropOnTarget(target, source);
        }
    });
}

function attachInputEvents(input) {
    $(input).on('input', function () {
        searchTerm = input.value;
        runSearch();
        renderResults();
    });

    $(input).on('keydown', function (event) {
        if (event.key === 'Escape') {
            closeCategory();
            return;
        }
        if (!results.length) return;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusedIndex = (focusedIndex + 1) % results.length;
            renderResults();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            focusedIndex = (focusedIndex - 1 + results.length) % results.length;
            renderResults();
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const picked = results[focusedIndex];
            if (picked) {
                chooseCountry(picked.code);
            }
        }
    });
}

// Board #1, shown only when the board API can't be reached. The banner says so.
const defaultBoard = {
    date: '2024-04-07',
    boardId: 1,
    rows: [
        { id: 'flag_has_x_colors', name: 'Flag with black', variantId: null },
        { id: 'multiple_words', name: 'Name consists of multiple words', variantId: null },
        { id: 'flag_has_star', name: 'Flag with a star/sun', variantId: null }
    ],
    columns: [
        { id: 'olympic_medals_over_x', name: 'More than 50 Olympic medals', variantId: null },
        { id: 'in_north_america', name: 'In North America', variantId: null },
        { id: 'gdp_per_capita_over_x', name: 'GDP per capita over $20k', variantId: null }
    ],
    countries: [
        { code: 'ca', name: 'Canada' },
        { code: 'de', name: 'Germany' },
        { code: 'mx', name: 'Mexico' },
        { code: 'us', name: 'United States of America' }
    ]
};
