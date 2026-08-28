// import $ from 'jquery';
import '@shared/style/base.css';
importAll(require.context('../style', false, /\.css$/));
// import 'bootstrap/dist/css/bootstrap.min.css';
// import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import feather from 'feather-icons';
import { createDragEngine } from '@shared/js/dragdrop.js';
import { attachDatePicker } from '@shared/js/dates.js';
import { loadBoard } from '@shared/js/board.js';
import { startChase } from '@shared/js/skeleton.js';
const mainJsVersion = 1.6;

function importAll(r) {
    r.keys().forEach(r);
}

let lockedColor = { white: false, yellow: false, green: false, blue: false, purple: false };
let colors = Object.keys(lockedColor);

// Declare the base array at the top of the file
let boxes = [];

// Clockwise trip around the outside of the 4x4 grid, leaving the middle four alone.
const skeletonRing = [0, 1, 2, 3, 7, 11, 15, 14, 13, 12, 8, 4];

// Sixteen blank tiles so the grid is full size before the words land. The space holds the line height.
function renderSkeleton() {
    $('#grid').empty();
    const tiles = [];
    for (let i = 0; i < 16; i++) {
        const div = document.createElement('div');
        div.classList.add('box', 'white-guess', 'skeleton');
        div.textContent = '\u00a0';
        tiles.push(div);
        $('#grid').append(div);
    }
    startChase(skeletonRing.map(i => tiles[i]));
    adjustPageSize();
}

function renderGrid() {
    $('#grid').empty();
    boxes.forEach((boxData) => {
        const div = document.createElement('div');
        div.classList.add('box', boxData.color + (boxData.confirmed ? '-confirmed' : '-guess'));
        div.textContent = boxData.text;
        div.dataset.boxId = boxData.boxId; // Use boxId to uniquely identify the box
        div.draggable = true;

        // Attach events to the box
        attachBoxEvents(div, boxData);

        $('#grid').append(div);
        adjustFontSize(div);
    });
    updateLocks();
    adjustPageSize();
}

export function swapBoxes(el1, el2) {
    const boxId1 = el1.dataset.boxId;
    const boxId2 = el2.dataset.boxId;
    console.log("Swapping " + el1.textContent + " & " + el2.textContent);

    const index1 = boxes.findIndex(box => box.boxId == boxId1);
    const index2 = boxes.findIndex(box => box.boxId == boxId2);

    // Swap the two boxes in the array
    const temp = boxes[index1];
    boxes[index1] = boxes[index2];
    boxes[index2] = temp;

    renderGrid();
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function shuffleBoxes() {
    shuffleArray(boxes);
    renderGrid();
}

function sortBoxes() {
    const sortedBoxes = [];

    // Separate boxes by color
    const yellowBoxes = boxes.filter(box => box.color === 'yellow');
    const greenBoxes = boxes.filter(box => box.color === 'green');
    const blueBoxes = boxes.filter(box => box.color === 'blue');
    const purpleBoxes = boxes.filter(box => box.color === 'purple');
    const whiteBoxes = boxes.filter(box => box.color === 'white');

    // Helper function to fill a row with a specific color and fill with whites if needed
    function fillRowWithColor(colorBoxes, rowSize) {
        const row = [...colorBoxes]; // Clone the array
        const remainingSlots = rowSize - colorBoxes.length;
        if (remainingSlots > 0) {
            row.push(...whiteBoxes.splice(0, remainingSlots)); // Fill the remaining slots with white boxes
        }
        return row;
    }

    // Push sorted rows into sortedBoxes
    sortedBoxes.push(...fillRowWithColor(yellowBoxes, 4)); // Yellow row
    sortedBoxes.push(...fillRowWithColor(greenBoxes, 4));  // Green row
    sortedBoxes.push(...fillRowWithColor(blueBoxes, 4));   // Blue row
    sortedBoxes.push(...fillRowWithColor(purpleBoxes, 4)); // Purple row

    boxes = sortedBoxes;
    renderGrid();
}

function resetBoard() {
    // Reset each box to its default state
    boxes.forEach(box => {
        box.color = "white"; // Reset color to white
        box.confirmed = false; // Reset confirmed to false
    });

    colors.forEach(color => {
        if (color == "white") return;
        unlockColor(color);
    });

    // Re-render the grid with the reset boxes
    renderGrid();
}

function toggleBoxColor(box, boxData) {
    let unlockedColors = Object.keys(lockedColor).filter(color => lockedColor[color] === false);

    const currentIndex = unlockedColors.indexOf(boxData.color);
    boxData.color = unlockedColors[(currentIndex + 1) % unlockedColors.length]; // Cycle to the next color class
    updateBoxClass(box, boxData); // Update the box class
}

function toggleConfirmed(box, boxData) {
    boxData.confirmed = !boxData.confirmed; // Toggle confirmed state
    updateBoxClass(box, boxData); // Update the box class
}

function updateBoxClass(box, boxData) {
    const colorClass = boxData.color + (boxData.confirmed ? '-confirmed' : '-guess');
    box.classList.remove(...colors.map(color => color + '-guess'), ...colors.map(color => color + '-confirmed'));
    box.classList.add(colorClass)
    console.log("Color Update: " + box.textContent + " → " + boxData.color);
    updateLocks();
}

function updateLocks() {
    for (let selectedColor of colors) {
        if (selectedColor === 'white') continue; // Ignore white color
        var className = ".lock-" + selectedColor;
        const isDisabled = $(className).hasClass("disabled");
        const shouldEnable = boxes.filter(box => box.color === selectedColor).length == 4 && !lockedColor[selectedColor];

        if (isDisabled) {
            if (shouldEnable) {
                $(className).removeClass("disabled");
                console.log("Enabling Lock " + selectedColor);
            }
        } else if (boxes.filter(box => box.color === selectedColor).length !== 4) {
            $(className).addClass("disabled");
            console.log("Disabling Lock " + selectedColor);
        }
    }
}

function adjustPageSize() {
    const htmlHeight = $("html").height();
    const htmlWidth = $("html").width();
    const htmlAspectRatio = htmlWidth / htmlHeight;
    const bodyHeight = $("body").height();
    const bodyWidth = $("body").width();
    const bodyAspectRatio = bodyWidth / bodyHeight;
    const gameHeight = $("body > .container").height();
    const gameWidth = $("body > .container").width();
    const gameAspectRatio = gameWidth / gameHeight;
    const gridHeight = $("#grid").height();
    const containerHeight = $("body > .container").height();
    const gameDivHeight = $("#game-div").height();

    const usableHeight = htmlHeight - 80;

    var boxPadding = $(".box").css("padding-top").replace("px", "");

    console.log({ htmlHeight, htmlWidth, htmlAspectRatio, bodyHeight, bodyWidth, bodyAspectRatio, gameHeight, gameWidth, gameAspectRatio, gridHeight, containerHeight });

    if (gameDivHeight > usableHeight) {
        var diff = gameDivHeight - usableHeight;
        console.log("diff: " + diff);
        var padding = boxPadding - diff / 8;
        $(".box").css("padding-top", padding + "px");
        $(".box").css("padding-bottom", padding + "px");
    } else {
        var diff = usableHeight - gameDivHeight;
        console.log("diff: " + diff);
        var padding = boxPadding + diff / 8;
        $(".box").css("padding-top", padding + "px");
        $(".box").css("padding-bottom", padding + "px");
    }
}

$(function () {
    feather.replace();
    document.body.style.overflow = 'hidden'; // Disable scrolling


    $("#main-version-span").text(mainJsVersion);

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function() {
            navigator.serviceWorker.register('/connections/service-worker.js').then(function(registration) {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            }, function(error) {
                console.log('ServiceWorker registration failed: ', error);
            });
        });
    }

    async function initializeGame(date = '') {
        renderSkeleton();
        const result = await loadBoard({
            game: 'connections',
            date: date,
            fallback: defaultWords,
            validate: function (data) {
                return Array.isArray(data) && data.length > 0 && !data.hasOwnProperty('error');
            }
        });
        const fetchedWords = result.board;

        // Convert fetchedWords or defaultWords into the required format for boxes
        const fetchedBoxes = fetchedWords.map((word, index) => ({
            boxId: index + 1, // Assign a unique boxId starting from 1
            text: word,
            color: "white", // Default color is white
            confirmed: false // Default confirmed state is false
        }));

        // Check if there are any words fetched and then render the grid
        boxes.length = 0; // Clear the existing boxes array
        boxes.push(...fetchedBoxes); // Populate boxes with fetched data
        renderGrid(); // Render the grid
    }

    // Initial rendering of the game with today's date
    initializeGame(attachDatePicker('#date-picker', function (picked) {
        console.log('Resetting board for new date ' + picked);
        initializeGame(picked);
    }));

    // Attach shuffle functionality to the shuffle button
    $('#shuffle-btn').on('click', function () {
        shuffleBoxes(); // jQuery returns a wrapped set, use [0] for the DOM element
        console.log("Shuffle");
    });

    // Attach sort functionality to the sort button
    $('#sort-btn').on('click', function () {
        sortBoxes(); // Use [0] to get the actual DOM element
        console.log("Sort");
    });

    // Attach clear functionality to the clear button
    $('#clear-btn').on('click', function () {
        resetBoard(); // Use [0] to get the actual DOM element
        console.log("Clear");
    });

    // Automatically fetch and load words when the date picker value changes

    $(".version-span").on("click", function () {
        $(".fileVersions").toggle();
        toggleDebug();
        console.log("Opening debug console");
    });

    // Enable the lock buttons
    $('.icon-clickable').on('click', function (event) {
        if ($(this).hasClass('disabled')) return;


        let colorMatch = this.classList.value.match(/lock-(\w+)/);

        // Extract the color if there's a match
        let color = colorMatch[1];

        if ($(this).get(0).classList.contains("unlocked")) {
            lockColor(color);
        } else {
            unlockColor(color);
        }
        renderGrid();
    });

    // Disable drag event on footer and body
    $('body, #footer-row').on('dragstart', function(event) {
        event.preventDefault();
    });
});

// Function to dynamically adjust font size based on box content
function adjustFontSize(box) {
    let fontSize = 16; // Starting font size in px
    const boxWidth = box.offsetWidth;
    const boxHeight = box.offsetHeight;

    // Get the box's content
    let content = box.innerText || box.textContent;
    const tempDiv = document.createElement('div');

    // Create a temporary div to measure the text size
    tempDiv.style.position = 'absolute';
    tempDiv.style.visibility = 'hidden';
    tempDiv.style.fontSize = fontSize + 'px';
    tempDiv.innerHTML = content;
    document.body.appendChild(tempDiv);

    // Reduce font size until text fits within the box
    while ((tempDiv.offsetWidth > boxWidth || tempDiv.offsetHeight > boxHeight) && fontSize > 10) {
        fontSize--;
        tempDiv.style.fontSize = fontSize + 'px';
    }

    // Set the final font size
    box.style.fontSize = fontSize + 'px';

    // Remove the temporary div
    document.body.removeChild(tempDiv);
}

function unlockColor(color) {
    let that = $(".lock-" + color)[0]
    console.log("Unlocking " + color);
    for (let i = 0; i < boxes.length; i++) {
        if (boxes[i].color === color) {
            boxes[i].confirmed = false;
        }
    }
    $(that).addClass("unlocked");
    $(that).removeClass("locked");
    $($(that).children().get(0)).addClass("d-none");
    $($(that).children().get(1)).removeClass("d-none");
    lockedColor[color] = false;
}

function lockColor(color) {
    let that = $(".lock-" + color)[0]
    console.log("Locking " + color);
    for (let i = 0; i < boxes.length; i++) {
        if (boxes[i].color === color) {
            boxes[i].confirmed = true;
        }
    }
    $(that).addClass("locked");
    $(that).removeClass("unlocked");
    $($(that).children().get(1)).addClass("d-none");
    $($(that).children().get(0)).removeClass("d-none");
    lockedColor[color] = true;
}

const defaultWords = [
    "APPLE", "BANANA", "CHERRY", "ORANGE",
    "RABBIT", "CAT", "FROG", "TURTLE",
    "COKE", "SPRITE", "7-UP", "PEPSI",
    "MOUSE", "WIRELESS KEYBOARD", "MONITOR", "MIC"
];

// Boxes are both the things you drag and the things you drop onto, so a drop swaps the pair.
const drag = createDragEngine({
    dragSelector: '.box',
    dropSelector: '.box',
    findTarget: function (node) {
        return node ? $(node).closest('.box').get(0) || null : null;
    }
});

function attachBoxEvents(div, boxData) {
    const options = {
        onTap: function () {
            if (boxData.confirmed) {
                console.log('Clicked on locked box: ' + div.textContent);
                return;
            }
            console.log('Click: ' + div.textContent);
            toggleBoxColor(div, boxData);
        },
        onDrop: function (target, source) {
            swapBoxes(source, target);
        }
    };
    drag.makeDraggable(div, options);
    drag.makeDropTarget(div, options);
}
