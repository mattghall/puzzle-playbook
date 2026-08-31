importAll(require.context('../style', false, /\.css$/));
import '@shared/style/base.css';
import feather from 'feather-icons';
import { startChase } from '@shared/js/skeleton.js';
import { attachDatePicker } from '@shared/js/dates';
import { loadBoard } from '@shared/js/board';
const mainJsVersion = 1.0;

function importAll(r) {
    r.keys().forEach(r);
}

// Weaver's first puzzle ran on this date, so the picker can't go back any further.
const firstPuzzleDate = '2022-02-17';

// Undocumented: ?help=1 lists every legal word one letter off each end.
const helpMode = new URLSearchParams(window.location.search).get('help') === '1';

const fallbackBoard = {
    date: '',
    gameNumber: 0,
    startWord: 'demo',
    endWord: 'mode',
    wordLength: 4,
    optimalSteps: null,
    words: ['demo', 'demy', 'dome', 'mode', 'more', 'mote', 'note']
};

let board = fallbackBoard;
let words = new Set();
// Prefixes that can still reach a legal next word, so a doomed one is called out as you type.
let reachable = new Set();
// Every prefix in the dictionary, which separates a nonexistent word from an illegal one.
let wordPrefixes = new Set();
// The ladder grows inward from both ends, so each half is tracked separately.
let topChain = [];
let bottomChain = [];
let typed = '';
// Fires the finish animation once, and rearms if a rung is pulled back out.
let celebrated = false;

function wordLength() {
    return board.wordLength || board.startWord.length;
}

// The word currently sitting at the bottom of the upper half.
function topWord() {
    return topChain.length ? topChain[topChain.length - 1] : board.startWord;
}

// The word currently sitting at the top of the lower half.
function bottomWord() {
    return bottomChain.length ? bottomChain[0] : board.endWord;
}

// How many positions two same length words disagree on, or how far a prefix has strayed.
function distance(a, b) {
    let count = 0;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) count++;
    }
    return count;
}

// Every unused dictionary word sitting exactly one letter off the given word.
function neighborsOf(word) {
    const found = [];
    for (let i = 0; i < word.length; i++) {
        for (let code = 97; code < 123; code++) {
            const letter = String.fromCharCode(code);
            if (letter === word[i]) continue;
            const candidate = word.slice(0, i) + letter + word.slice(i + 1);
            if (words.has(candidate) && !used(candidate)) found.push(candidate);
        }
    }
    return found;
}

// Only the words playable right now can be typed toward, so index their prefixes.
function buildReachable() {
    return prefixesOf(neighborsOf(topWord()).concat(neighborsOf(bottomWord())));
}

function prefixesOf(list) {
    const set = new Set();
    list.forEach((word) => {
        for (let i = 0; i <= word.length; i++) {
            set.add(word.slice(0, i));
        }
    });
    return set;
}

function used(word) {
    return word === board.startWord || word === board.endWord
        || topChain.includes(word) || bottomChain.includes(word);
}

// The two halves meet once their facing words are a single letter apart.
function solved() {
    return distance(topWord(), bottomWord()) === 1;
}

// A word that doesn't exist outranks one that merely strayed, and both apply as you type.
function judge(word) {
    if (!wordPrefixes.has(word)) return { state: 'nonword' };
    const toTop = distance(word, topWord());
    const toBottom = distance(word, bottomWord());
    if (toTop > 1 && toBottom > 1) return { state: 'far' };
    if (word.length === wordLength() && used(word)) return { state: 'used' };
    if (!reachable.has(word)) return { state: 'unknown' };
    if (word.length < wordLength()) return { state: 'partial' };
    if (toTop === 1 && toBottom === 1) return { state: 'bridge' };
    if (toTop === 1) return { state: 'top' };
    if (toBottom === 1) return { state: 'bottom' };
    return { state: 'far' };
}

function commit() {
    const word = typed.toLowerCase();
    if (word.length < wordLength()) return;
    const verdict = judge(word);
    // A bridging word can go on either half, so it joins the top and the halves meet.
    if (verdict.state === 'bottom') {
        bottomChain.unshift(word);
    } else if (verdict.state === 'top' || verdict.state === 'bridge') {
        topChain.push(word);
    } else {
        return;
    }
    typed = '';
    render();
}

// Removing a rung takes the rest of its half with it, so the ladder stays connected.
function removeFromTop(index) {
    topChain = topChain.slice(0, index);
    render();
}

function removeFromBottom(index) {
    bottomChain = bottomChain.slice(index + 1);
    render();
}

function reset() {
    topChain = [];
    bottomChain = [];
    typed = '';
    render();
    focusTyper();
}

function blockEl(letter, classes) {
    const block = document.createElement('div');
    block.className = ['block'].concat(classes || []).join(' ');
    block.textContent = letter || '';
    return block;
}

// Green marks a letter that already agrees with the end word, the same cue the game gives.
function matchClasses(word, index) {
    return word[index] === board.endWord[index] ? ['greenBlock'] : [];
}

// Blue rings the one letter this rung changed from the word it was played off of.
function rungClasses(word, index, source) {
    const classes = matchClasses(word, index);
    if (source && word[index] !== source[index]) {
        classes.push('changedBlock');
        // A rebuild after the finish animation should keep the gold it left behind.
        if (celebrated) classes.push('goldFill');
    }
    return classes;
}

// Wiping innerHTML would take the typing input with it, so only the rows come out.
function clearLadder(ladder) {
    Array.from(ladder.children).forEach((child) => {
        if (child.id !== 'typer') child.remove();
    });
}

function rowEl(classes) {
    const row = document.createElement('div');
    row.className = ['ladder-row'].concat(classes || []).join(' ');
    return row;
}

function wordRow(word, classes, blockClassesFor) {
    const row = rowEl(classes);
    for (let i = 0; i < word.length; i++) {
        row.appendChild(blockEl(word[i], blockClassesFor ? blockClassesFor(i) : []));
    }
    return row;
}

// The end word lights up wherever the nearest word above it already agrees.
function endWordClasses(index) {
    if (solved()) return ['endWordBlock', 'endWordBlockComplete'];
    const above = topChain.length || bottomChain.length ? bottomChain[0] || topWord() : null;
    const near = bottomChain.length ? bottomChain[bottomChain.length - 1] : topWord();
    const source = near || above;
    if (source && source[index] === board.endWord[index]) {
        return ['endWordBlock', 'endWordBlockComplete'];
    }
    return ['endWordBlock'];
}

// Once the letters lean toward one end, the row slides over to sit against that half.
function snapDirection() {
    if (!typed) return null;
    const toTop = distance(typed, topWord());
    const toBottom = distance(typed, bottomWord());
    if (toTop < toBottom) return 'snap-top';
    if (toBottom < toTop) return 'snap-bottom';
    return null;
}

function typingRow() {
    const verdict = judge(typed);
    const tone = {
        nonword: 'redBlock', unknown: 'orangeBlock', used: 'redBlock', far: 'yellowBlock'
    }[verdict.state];
    const snap = snapDirection();
    const row = rowEl(snap ? ['typing-row', snap] : ['typing-row']);
    for (let i = 0; i < wordLength(); i++) {
        const classes = [];
        // A bad word colors the whole row, empty cells included, so the verdict reads at a glance.
        if (tone) {
            classes.push(tone);
        } else if (typed[i]) {
            classes.push('filledBlock');
            if (typed[i] === board.endWord[i]) classes.push('greenBlock');
        } else if (i === typed.length) {
            classes.push('currentBlock');
        }
        row.appendChild(blockEl(typed[i], classes));
    }
    return row;
}

// The × sits outside the blocks, so a matching gutter on the left keeps the word centered.
function removeButton(onRemove) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rung-remove';
    button.textContent = '\u00d7';
    button.title = 'Remove this rung';
    button.setAttribute('aria-label', 'Remove this rung');
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        onRemove();
    });
    return button;
}

function withRemove(row, onRemove) {
    const gutter = document.createElement('div');
    gutter.className = 'rung-gutter';
    row.insertBefore(gutter, row.firstChild);
    row.appendChild(removeButton(onRemove));
    return row;
}

function render() {
    const ladder = document.getElementById('ladder');
    clearLadder(ladder);
    ladder.classList.toggle('help-mode', helpMode);
    reachable = buildReachable();

    ladder.appendChild(wordRow(board.startWord, ['start-row'], () => ['startWordBlock']));

    topChain.forEach((word, index) => {
        const above = index ? topChain[index - 1] : board.startWord;
        const row = wordRow(word, ['entered-row'], (i) => rungClasses(word, i, above));
        ladder.appendChild(withRemove(row, () => removeFromTop(index)));
    });

    let typing = null;
    if (!solved()) {
        appendHelper(ladder, topWord());
        typing = typingRow();
        ladder.appendChild(typing);
        appendHelper(ladder, bottomWord());
    }

    bottomChain.forEach((word, index) => {
        // A bottom rung was played off the word below it, so that's what it changed.
        const below = index + 1 < bottomChain.length ? bottomChain[index + 1] : board.endWord;
        const row = wordRow(word, ['entered-row'], (i) => rungClasses(word, i, below));
        ladder.appendChild(withRemove(row, () => removeFromBottom(index)));
    });

    ladder.appendChild(wordRow(board.endWord, ['end-row'], endWordClasses));

    renderStatus();
    if (typing) positionTyper(typing);

    if (!solved()) {
        celebrated = false;
    } else if (!celebrated) {
        celebrated = true;
        celebrate();
    }
}

const goldStepMs = 250;

// Each row fades up and back on its own delay, so the gold pours down the ladder.
function celebrate() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ladder = document.getElementById('ladder');
    // Clearing and reflowing first lets a replay restart an animation that's still running.
    ladder.querySelectorAll('.block').forEach((block) => {
        block.classList.remove('goldWave', 'goldFillWave', 'goldFill');
        block.style.animationDelay = '';
    });
    void ladder.offsetWidth;
    // The two fixed ends aren't part of the path, so the gold skips them.
    ladder.querySelectorAll('.ladder-row:not(.start-row):not(.end-row)').forEach((row, index) => {
        const changed = row.querySelector('.changedBlock');
        row.querySelectorAll('.block').forEach((block) => {
            block.style.animationDelay = index * goldStepMs + 'ms';
            block.classList.add(block === changed ? 'goldFillWave' : 'goldWave');
            block.addEventListener('animationend', () => {
                if (block === changed) block.classList.add('goldFill');
                block.classList.remove('goldWave', 'goldFillWave');
                block.style.animationDelay = '';
            }, { once: true });
        });
    });
}

function fillTyped(word) {
    typed = word;
    commit();
    document.getElementById('typer').value = typed;
}

// The help list sits against the word it comes from, so it reads as options for that end.
function helperList(word) {
    const options = neighborsOf(word).sort();
    if (!options.length) return null;
    const line = document.createElement('div');
    line.className = 'helper-line';
    options.forEach((option) => {
        const item = document.createElement('span');
        item.className = 'helper-word';
        item.textContent = option;
        item.addEventListener('click', () => fillTyped(option));
        line.appendChild(item);
    });
    return line;
}

function appendHelper(ladder, word) {
    if (!helpMode) return;
    const line = helperList(word);
    if (line) ladder.appendChild(line);
}

// Says why the row went yellow or red, so the color never needs interpreting.
function problemWith(word) {
    const shown = '"' + word.toUpperCase() + '"';
    const state = judge(word).state;
    if (state === 'nonword' && word.length === wordLength()) {
        return shown + ' is not in the word list';
    }
    if (state === 'nonword') return 'No word starts with ' + shown;
    if (state === 'far') return 'More than one letter from both ends';
    if (state === 'used') return shown + ' is already on the ladder';
    if (state === 'unknown') return 'No legal words within one letter';
    return '';
}

// Matching the optimal path speaks for itself, so the count only shows when there was a shorter way.
function appendOptimal(status, steps) {
    if (!board.optimalSteps || steps <= board.optimalSteps) return;
    const note = document.createElement('div');
    note.className = 'optimal-note';
    note.textContent = 'optimal ' + board.optimalSteps;
    status.appendChild(note);
}

function renderStatus() {
    const status = document.getElementById('status');
    status.classList.remove('status-bad', 'status-done');
    if (solved()) {
        const rungs = topChain.length + bottomChain.length;
        const steps = rungs + 1;
        status.textContent = 'Ladder complete in ' + steps + ' steps';
        status.classList.add('status-done');
        appendOptimal(status, steps);
        return;
    }
    const problem = typed ? problemWith(typed) : '';
    if (problem) {
        status.textContent = problem;
        status.classList.add('status-bad');
        return;
    }
    status.textContent = distance(topWord(), bottomWord()) + ' letters between the two ends';
}

// The input rides along with the typing row, so focusing it can't scroll the ladder away.
function positionTyper(row) {
    const typer = document.getElementById('typer');
    if (typer) typer.style.top = row.offsetTop + 'px';
}

// A phone keyboard covers the bottom of the screen and the pinned footer covers more, so center between them.
function centerTypingRow() {
    const row = document.querySelector('.typing-row');
    if (!row) return;
    const view = window.visualViewport;
    const top = view ? view.offsetTop : 0;
    const footer = document.getElementById('footer-row');
    const bottom = top + (view ? view.height : window.innerHeight) - (footer ? footer.offsetHeight : 0);
    if (bottom <= top) return;
    const box = row.getBoundingClientRect();
    window.scrollBy({ top: box.top + box.height / 2 - (top + bottom) / 2 });
}

function focusTyper() {
    const typer = document.getElementById('typer');
    if (!typer) return;
    typer.focus({ preventScroll: true });
    centerTypingRow();
}

function renderSkeleton() {
    const ladder = document.getElementById('ladder');
    clearLadder(ladder);
    const blocks = [];
    for (let r = 0; r < 5; r++) {
        const row = rowEl(['entered-row']);
        for (let i = 0; i < 5; i++) {
            const block = blockEl('', ['skeleton']);
            blocks.push(block);
            row.appendChild(block);
        }
        ladder.appendChild(row);
    }
    startChase(blocks);
    document.getElementById('status').textContent = '';
}

function attachTyping() {
    const typer = document.getElementById('typer');
    typer.addEventListener('input', () => {
        const clean = typer.value.replace(/[^a-zA-Z]/g, '').toLowerCase().slice(0, wordLength());
        typer.value = clean;
        typed = clean;
        render();
        centerTypingRow();
    });
    typer.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            typer.value = typed;
            centerTypingRow();
        }
    });
    // Tapping anywhere on the ladder should bring up a keyboard on a phone.
    document.getElementById('ladder').addEventListener('click', focusTyper);
    // The keyboard opening resizes the visual viewport rather than firing a scroll event.
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', centerTypingRow);
    }
}

async function load(date) {
    renderSkeleton();
    const result = await loadBoard({
        game: 'weaver',
        date: date,
        fallback: fallbackBoard,
        validate: (data) => data && data.startWord && data.endWord && Array.isArray(data.words) && data.words.length > 0
    });
    board = result.board;
    words = new Set(board.words);
    wordPrefixes = prefixesOf(board.words);
    topChain = [];
    bottomChain = [];
    typed = '';
    const failed = document.getElementById('fetch-error');
    failed.style.display = result.live ? 'none' : 'block';
    failed.textContent = result.live ? '' : 'Could not load today\'s puzzle, so this is a stand in.';
    document.getElementById('typer').value = '';
    render();
    focusTyper();
}

$(document).ready(function () {
    $('#main-version-span').text(mainJsVersion);
    feather.replace();
    $('#clear-btn').on('click', reset);
    // Tapping the version replays the finish animation, once there's something to replay.
    $('.version-span').on('click', () => {
        if (solved()) celebrate();
    });
    $('#date-picker').attr('min', firstPuzzleDate);
    attachTyping();
    const today = attachDatePicker('#date-picker', load);
    load(today);
});
