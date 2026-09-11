importAll(require.context('../style', false, /\.css$/));
import '@shared/style/base.css';
import { wordList } from './words/wordle-words.js';
import { guessList } from './words/wordle-guesses.js';
import { w500WordList } from './words/word500-words.js';
const MAIN_JS_VERSION = 1.0;
const HELP_MODE = new URLSearchParams(window.location.search).get("help") === "1";
const ANSWERS = new Set(wordList);
const LEGAL_GUESSES = new Set([...guessList, ...wordList]);
const SORTED_GUESSES = [...LEGAL_GUESSES].sort();

function importAll(r) {
    r.keys().forEach(r);
}

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

// Unique letters count double because a repeat wastes a slot.
const WEIGHTS = {
    commonLetters: 1.0,
    correctLocation: 1.0,
    uniqueLetters: 2,
    vowels: 1.0
};

const graveyard = new Set();
let validWords = [];

function refreshGraveyard() {
    $(".graveyard0 > td:not(:first-child)").remove();
    $(".graveyard1 > td").remove();
    $(".graveyard2 > td").remove();
    $(".graveyard3 > td").remove();
    $(".graveyard4 > td").remove();
    $(".graveyard5 > td").remove();
    let i = 0;
    let row = ".graveyard0";
    for (const letter of Array.from(graveyard).sort()) {
        if ((i + 1) % 5 == 0) {
            row = ".graveyard" + (i + 1) / 5;
        }
        $(row).append("<td letter=\"" + letter + "\"><input class=\"l-box\" type=\"text\" value=\"" + letter + "\"></td>");
        i++;
    }
}

// Tints the guess row green if it could be the answer, yellow if it's only a legal guess.
function checkValidGuess() {
    const inputs = document.querySelectorAll('.guess .l-box');
    const word = Array.from(inputs).map(input => input.value).join('');
    if (word.length === 5) {
        if (validWords.includes(word)) {
            $("#guesses").css("background-color", "#28a745");
        } else if (LEGAL_GUESSES.has(word)) {
            $("#guesses").css("background-color", "#ffc107");
        } else {
            $("#guesses").css("background-color", "#dc3545");
        }
    } else {
        $("#guesses").css("background-color", "rgba(0, 0, 0, 0)");
    }
}

function refreshBank() {
    if (!$("#wordle-pane").hasClass("active")) {
        return;
    }
    const bank = [];
    const clues = Array.from({ length: 5 }, (_, i) => ({
        green: $("#w" + i).val(),
        temporary: HELP_MODE ? "" : $("#g" + i).val(),
        yellow: $("#c" + i).val()
    }));
    $("#wordle-pane .strong-bank").empty();
    validWords = [];
    for (const word of SORTED_GUESSES) {
        if (wordIsValid(word, clues)) {
            if (ANSWERS.has(word)) {
                bank.push("<span>" + word + "</span>");
                validWords.push(word);
            } else {
                bank.push('<span class="guess-only">' + word + '</span>');
            }
        }
    }
    $("#wordle-pane .bank").html(bank.join(""));
    if (validWords.length > 0) {
        for (const word of sortWordList(validWords, WEIGHTS).slice(0, 4)) {
            $("#wordle-pane .strong-bank").append("<span class=\"strong\">" + word + "</span>");
        }
    }
    checkValidGuess();
}

function wordIsValid(word, clues) {
    for (const letter of graveyard) {
        if (word.includes(letter)) {
            return false;
        }
    }
    for (let i = 0; i < 5; i++) {
        if (clues[i].green && word[i] != clues[i].green) {
            return false;
        }
        if (clues[i].temporary && word[i] != clues[i].temporary) {
            return false;
        }
    }
    for (let i = 0; i < 5; i++) {
        const closes = clues[i].yellow;
        for (let x = 0; x < closes.length; x++) {
            const close = closes[x];
            if (close && (!word.includes(close) || word[i] == close)) {
                return false;
            }
        }
    }
    return true;
}

// The letter that turns up most often in each position, across whatever is still in the bank.
function calculateMostCommonLetters(wList, wordLength = 5) {
    const letterFreq = Array.from({ length: wordLength }, () => ({}));
    wList.forEach(word => {
        for (let i = 0; i < wordLength; i++) {
            const letter = word[i];
            if (letter) {
                if (!letterFreq[i][letter]) {
                    letterFreq[i][letter] = 0;
                }
                letterFreq[i][letter]++;
            }
        }
    });
    return letterFreq.map(freq => {
        return Object.keys(freq).reduce((a, b) => (freq[a] > freq[b] ? a : b));
    });
}

function countCommonLetters(word, uniqueCommonLetters) {
    let count = 0;
    for (const letter of word) {
        if (uniqueCommonLetters.includes(letter)) {
            count++;
        }
    }
    return count;
}

function countCorrectLocation(word, mostCommonLetters) {
    let count = 0;
    for (let i = 0; i < mostCommonLetters.length; i++) {
        if (word[i] === mostCommonLetters[i]) {
            count++;
        }
    }
    return count;
}

function countVowels(word) {
    let count = 0;
    for (const letter of word) {
        if (VOWELS.has(letter)) {
            count++;
        }
    }
    return count;
}

function calculateScore(word, mostCommonLetters, uniqueCommonLetters, weights) {
    const commonLettersScore = countCommonLetters(word, uniqueCommonLetters) * weights.commonLetters;
    const correctLocationScore = countCorrectLocation(word, mostCommonLetters) * weights.correctLocation;
    const uniqueLettersScore = new Set(word).size * weights.uniqueLetters;
    const vowelsScore = countVowels(word) * weights.vowels;
    return commonLettersScore + correctLocationScore + uniqueLettersScore + vowelsScore;
}

function sortWordList(wList, weights) {
    const mostCommonLetters = calculateMostCommonLetters(wList);
    const uniqueCommonLetters = [...new Set(mostCommonLetters)];
    return wList.sort((a, b) => {
        const aScore = calculateScore(a, mostCommonLetters, uniqueCommonLetters, weights);
        const bScore = calculateScore(b, mostCommonLetters, uniqueCommonLetters, weights);
        return bScore - aScore;
    });
}

// Word500 gives letter counts, not positions.
let w5Timeout;
const W5_ROWS = 8;
const W5_MAX_SHOWN = 500;
// Scoring every possible guess against every candidate is quadratic, so cap the work.
const W5_MAX_OPS = 3000000;
let w5CommonSet = null;

function showHelperTab(paneSelector) {
    $('#helper-tabs .nav-link').removeClass('active');
    $('#helper-tabs .nav-link[href="' + paneSelector + '"]').addClass('active');
    $('.tab-content > .tab-pane').removeClass('show active');
    $(paneSelector).addClass('show active');
    refreshBank();
    w5Refresh();
}

// Wordle candidates count as common words in the wider Word500 dictionary.
function w5IsCommon(word) {
    if (!w5CommonSet) {
        w5CommonSet = new Set(wordList);
    }
    return w5CommonSet.has(word);
}

function w5BuildBoard() {
    const board = $('#w5-board').empty();
    for (let r = 0; r < W5_ROWS; r++) {
        for (let i = 0; i < 5; i++) {
            board.append($('<div class="w5-cell"><input maxlength="1" class="w5-l" type="text"></div>').data('row', r));
        }
        board.append($('<div class="w5-cell green"><input maxlength="1" class="w5-count-input w5-g" type="text" inputmode="numeric"></div>').data('row', r));
        board.append($('<div class="w5-cell yellow"><input maxlength="1" class="w5-count-input w5-y" type="text" inputmode="numeric"></div>').data('row', r));
        board.append($('<div class="w5-cell red"><input maxlength="1" class="w5-count-input w5-r" type="text" inputmode="numeric"></div>').data('row', r));
        board.append($('<div class="w5-cell w5-clear-cell"><button type="button" class="w5-clear" title="clear row">&times;</button></div>').data('row', r));
    }
}

function w5RowCells(row) {
    return $('#w5-board .w5-cell').filter(function () {
        return $(this).data('row') === row;
    });
}

// The three counts always sum to 5, so once two are entered the third writes itself.
function w5FillThirdCount(row) {
    const cells = w5RowCells(row);
    const fields = [cells.find('.w5-g'), cells.find('.w5-y'), cells.find('.w5-r')];
    const filled = fields.filter(function (field) {
        return field.val() !== '';
    });
    if (filled.length !== 2) {
        return;
    }
    const sum = filled.reduce(function (total, field) {
        return total + parseInt(field.val(), 10);
    }, 0);
    const missing = fields.find(function (field) {
        return field.val() === '';
    });
    if (sum <= 5) {
        missing.val(5 - sum);
    }
}

function w5RowIsComplete(cells) {
    return w5RowWord(cells).length === 5 && cells.find('.w5-g').val() !== '' && cells.find('.w5-y').val() !== '';
}

function w5RowWord(cells) {
    let word = '';
    cells.find('.w5-l').each(function () {
        word += this.value;
    });
    return word;
}

function w5Clues() {
    const clues = [];
    for (let r = 0; r < W5_ROWS; r++) {
        const cells = w5RowCells(r);
        if (!w5RowIsComplete(cells)) {
            cells.removeClass('w5-row-bad');
            continue;
        }
        const green = parseInt(cells.find('.w5-g').val(), 10);
        const yellow = parseInt(cells.find('.w5-y').val(), 10);
        if (isNaN(green) || isNaN(yellow) || green + yellow > 5) {
            cells.addClass('w5-row-bad');
            continue;
        }
        cells.removeClass('w5-row-bad');
        clues.push({ word: w5RowWord(cells), green: green, yellow: yellow });
    }
    return clues;
}

// Returns [green, yellow], counting each matching letter only once.
function w5Score(guess, word) {
    let green = 0;
    const counts = {};
    for (let i = 0; i < 5; i++) {
        if (guess[i] === word[i]) {
            green++;
        }
        counts[word[i]] = (counts[word[i]] || 0) + 1;
    }
    let shared = 0;
    const guessCounts = {};
    for (let j = 0; j < 5; j++) {
        guessCounts[guess[j]] = (guessCounts[guess[j]] || 0) + 1;
    }
    for (const letter in guessCounts) {
        shared += Math.min(guessCounts[letter], counts[letter] || 0);
    }
    return [green, shared - green];
}

function w5HasRepeats(word) {
    return new Set(word).size !== word.length;
}

function w5Candidates() {
    const clues = w5Clues();
    // Standard difficulty never repeats a letter in the secret word; hard mode can.
    const noRepeats = !$('#w5-hard-mode').is(':checked');
    const candidates = [];
    for (let i = 0; i < w500WordList.length; i++) {
        const word = w500WordList[i];
        if (noRepeats && w5HasRepeats(word)) {
            continue;
        }
        let ok = true;
        for (let c = 0; c < clues.length; c++) {
            const score = w5Score(clues[c].word, word);
            if (score[0] !== clues[c].green || score[1] !== clues[c].yellow) {
                ok = false;
                break;
            }
        }
        if (ok) {
            candidates.push(word);
        }
    }
    return candidates;
}

// Rank by expected survivors, including probes that aren't remaining candidates.
function w5BestGuesses(candidates, limit) {
    const pool = wordList.concat(candidates.filter(function (word) {
        return !w5IsCommon(word);
    }));
    // Sample evenly to stay within the scoring budget.
    let sample = candidates;
    const budget = Math.floor(W5_MAX_OPS / pool.length);
    if (candidates.length > budget) {
        sample = [];
        const step = candidates.length / budget;
        for (let s = 0; s < candidates.length; s += step) {
            sample.push(candidates[Math.floor(s)]);
        }
    }
    const candidateSet = new Set(candidates);
    const scored = pool.map(function (guess) {
        const buckets = {};
        for (let i = 0; i < sample.length; i++) {
            const score = w5Score(guess, sample[i]);
            const key = score[0] * 6 + score[1];
            buckets[key] = (buckets[key] || 0) + 1;
        }
        let expected = 0;
        for (const key in buckets) {
            expected += buckets[key] * buckets[key];
        }
        return {
            word: guess,
            expected: expected / sample.length,
            // Slightly penalize guesses that can't win or aren't common words.
            tieBreak: (candidateSet.has(guess) ? 0 : 1) + (w5IsCommon(guess) ? 0 : 1)
        };
    });
    scored.sort(function (a, b) {
        return a.expected * (1 + 0.05 * a.tieBreak) - b.expected * (1 + 0.05 * b.tieBreak);
    });
    return scored.slice(0, limit).map(function (entry) {
        return entry.word;
    });
}

function w5Refresh() {
    if (!$('#word500-pane').hasClass('active')) {
        return;
    }
    clearTimeout(w5Timeout);
    w5Timeout = setTimeout(w5Render, 150);
}

function w5Render() {
    const candidates = w5Candidates();
    const bank = $('.w5-bank').empty();
    const strong = $('.w5-strong-bank').empty();

    $('.w5-count').text(candidates.length + (candidates.length === 1 ? ' word left' : ' words left'));

    if (candidates.length === 0) {
        bank.append('<span class="used">no words match these clues</span>');
        return;
    }

    for (const word of w5BestGuesses(candidates, 4)) {
        strong.append('<span class="strong">' + word + '</span>');
    }
    // Everyday words first, obscure dictionary entries grayed out after them.
    const common = candidates.filter(w5IsCommon);
    const obscure = candidates.filter(function (candidate) {
        return !w5IsCommon(candidate);
    });
    const shown = common.concat(obscure).slice(0, W5_MAX_SHOWN);
    for (let i = 0; i < shown.length; i++) {
        bank.append('<span' + (w5IsCommon(shown[i]) ? '' : ' class="used"') + '>' + shown[i] + '</span>');
    }
    if (candidates.length > shown.length) {
        bank.append('<span class="used">…and ' + (candidates.length - shown.length) + ' more</span>');
    }
}

// The footer floats over the page, so the panes are told how much room it takes.
function fitPanes() {
    const footer = document.getElementById('footer-row');
    if (footer) {
        document.documentElement.style.setProperty('--footer-height', footer.offsetHeight + 'px');
    }
}

function attachGuessTyping() {
    const inputs = document.querySelectorAll('.guess .l-box');
    inputs.forEach((input, index) => {
        input.addEventListener('input', function () {
            input.value = input.value.replace(/[^a-zA-Z]/g, '').toLowerCase();
            if (input.value.length === 1) {
                if (index < inputs.length - 1) {
                    inputs[index + 1].focus();
                }
            }
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === "Backspace" && input.value === '' && index > 0) {
                inputs[index - 1].focus();
            }
        });
    });
}

$(document).ready(function () {
    $('#main-version-span').text(MAIN_JS_VERSION);
    document.querySelectorAll("#wordle-pane .help-only").forEach(row => {
        row.hidden = !HELP_MODE;
    });
    fitPanes();
    $(window).on('resize', fitPanes);
    attachGuessTyping();
    w5BuildBoard();

    $('body').on('click', 'input', function () {
        $(this).select();
    });

    $('body').on('keyup', function () {
        refreshBank();
    });

    $('body').on('input change', '.guess .l-box, .winners .l-box, .cigars .l-box', function (e) {
        e.currentTarget.value = e.currentTarget.value.replace(/[^a-zA-Z]/g, '').toLowerCase();
        refreshBank();
    });

    // Bootstrap's tab data-api doesn't fire on this page, so the panes are switched by hand.
    $('body').on('click', '#helper-tabs .nav-link', function (e) {
        e.preventDefault();
        showHelperTab($(e.currentTarget).attr('href'));
    });

    $('body').on('keyup', '.graveyard0 > td:first > input', function (e) {
        const letter = $(e.currentTarget).val();
        if (/^[a-zA-Z]$/.test(letter)) {
            graveyard.add(letter.toLowerCase());
            refreshGraveyard();
        }
        $(".graveyard0 > td:first").children().val("");
        $(".graveyard0 > td:first").children().select();
    });

    $('body').on('keyup', '.cigars > td > input, .winners > td > input', function (e) {
        e.currentTarget.value = e.currentTarget.value.toLowerCase();
    });

    // Editing a letter already in the graveyard replaces it, clearing it takes it back out.
    $('body').on('keyup', '.graveyard0 > td:not(:first-child) > input', function (e) {
        const letter = $(e.currentTarget).val();
        const divLetter = e.currentTarget.parentElement.getAttribute("letter");
        if (letter != divLetter) {
            if (/^[a-zA-Z]$/.test(letter)) {
                graveyard.add(letter.toLowerCase());
            } else {
                graveyard.delete(divLetter);
            }
            refreshGraveyard();
        }
        $(".graveyard0 > td:first").children().val("");
        $(".graveyard0 > td:first").children().select();
    });

    $('body').on('input', '#w5-board .w5-l', function (e) {
        const input = e.currentTarget;
        input.value = input.value.replace(/[^a-zA-Z]/g, '').toLowerCase();
        if (input.value.length === 1) {
            $(input).closest('.w5-cell').next().find('input').focus();
        }
    });

    $('body').on('keydown', '#w5-board .w5-l', function (e) {
        if (e.key === "Backspace" && e.currentTarget.value === '') {
            $(e.currentTarget).closest('.w5-cell').prev().find('input').focus();
        }
    });

    $('body').on('input', '#w5-board .w5-count-input', function (e) {
        const input = e.currentTarget;
        input.value = input.value.replace(/[^0-5]/g, '').slice(0, 1);
        w5FillThirdCount($(input).closest('.w5-cell').data('row'));
        if (input.value !== '') {
            $(input).closest('.w5-cell').next().find('input').focus();
        }
    });

    $('body').on('click', '#w5-board .w5-clear', function (e) {
        const row = $(e.currentTarget).closest('.w5-cell').data('row');
        w5RowCells(row).find('input').val('');
        w5RowCells(row).first().find('input').focus();
        w5Refresh();
    });

    $('body').on('input change', '#w5-board input, #w5-hard-mode', w5Refresh);

    refreshBank();
    w5Refresh();
});
