// import $ from 'jquery';
importAll(require.context('../style', false, /\.css$/));
// import 'bootstrap/dist/css/bootstrap.min.css';
// import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import feather from 'feather-icons';
const mainJsVersion = 1.3;
const apiUrl = 'https://mj3c9f7sje.execute-api.us-west-2.amazonaws.com/default/connections-scraper';

function importAll(r) {
    r.keys().forEach(r);
}

let lockedColor = { white: false, yellow: false, green: false, blue: false, purple: false };
let colors = Object.keys(lockedColor);

// Declare the base array at the top of the file
let boxes = [];

function renderGrid() {
    $('#grid').empty();
    boxes.forEach((boxData) => {
        const div = document.createElement('div');
        div.classList.add('box', boxData.color + (boxData.confirmed ? '-confirmed' : '-guess'));
        div.textContent = boxData.text;
        div.dataset.boxId = boxData.boxId; // Use boxId to uniquely identify the box
        div.draggable = true;

        // Attach events to the box
        attachBoxEvents(div, boxData, boxes, $('#grid'));

        $('#grid').append(div);
        adjustFontSize(div);
    });
    updateLocks();
    adjustPageSize();
    endLoading();
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
function startLoading() {
    $('#loading-overlay').fadeIn('slow');
}

function endLoading() {
    $('#loading-overlay').fadeOut('slow');
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
    startLoading();
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
    $('#loading-overlay').show();
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

    // Function to fetch words from the API
    async function fetchWords(date = '') {
        try {
            const url = date ? `${apiUrl}?date=${date}` : apiUrl;
            console.log("Fetching " + url);
            const response = await fetch(url);
            const data = await response.json();

            // Assuming the API returns an array of words in the response
            return data;
        } catch (error) {
            console.log('Error fetching words:', error);
            return []; // Return an empty array if the API call fails
        }
    }

    // Function to initialize the game
    async function initializeGame(date = '') {
        var fetchedWords = await fetchWords(date);

        // If fetch fails, use default words and display an error message
        if (!fetchedWords || fetchedWords.hasOwnProperty("error") || fetchedWords.length === 0) {
            console.log("Could not fetch data from NYT connections. Using default word list.");
            fetchedWords = defaultWords; // Fall back to the default words
        } else {
            console.log(fetchedWords);
        }

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

    // Get the current date in yyyy-mm-dd format
    const currentDate = getCurrentDateFormatted();
    $('#date-picker').val(currentDate); // Set the date picker's value to today's date

    // Initial rendering of the game with today's date
    initializeGame(currentDate);

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
    $('#date-picker').on('change', function () {
        startLoading();
        const selectedDate = $('#date-picker').val(); // Use jQuery to get the value
        if (selectedDate) {
            console.log("Resetting board for new date " + selectedDate);
            initializeGame(selectedDate); // Fetch words for the selected date
        } else {
            alert("Please select a valid date.");
        }
    });

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

function getCurrentDateFormatted() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0'); // Month is 0-based, so add 1
    const day = String(today.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

const defaultWords = [
    "APPLE", "BANANA", "CHERRY", "ORANGE",
    "RABBIT", "CAT", "FROG", "TURTLE",
    "COKE", "SPRITE", "7-UP", "PEPSI",
    "MOUSE", "WIRELESS KEYBOARD", "MONITOR", "MIC"
];

let draggedElement = null;
let touchStart = 0;

function handleTouchStart(e) {
    console.log("Touch start: " + e.target.textContent);
    e.preventDefault(); // Prevent the default touch behavior (scrolling)
    draggedElement = e.target; // Store the element being touched
    $(draggedElement).addClass('dragging');
    touchStart = e.timeStamp;
}

function handleTouchMove(e) {
    console.log("Touch move: " + e.target.textContent);
    e.preventDefault(); // Prevent scrolling or default behavior
    const touchLocation = e.touches[0];
    const targetElement = document.elementFromPoint(touchLocation.clientX, touchLocation.clientY);

    clearOverlapping();
    if (targetElement && targetElement !== draggedElement) {
        $(targetElement).addClass('overlapping');
    }
}

function handleTouchEnd(e) {
    console.log("Touch end: " + e.target.textContent);
    e.preventDefault(); // Prevent the default touch behavior
    const touchLocation = e.changedTouches[0];
    const targetElement = document.elementFromPoint(touchLocation.clientX, touchLocation.clientY);
    if (!targetElement) {
        cleanupAfterDrag();
        return;
    }
    if (!$(targetElement).hasClass("box")) {
        console.log("Dragged into no-mans land... ignoring");
        cleanupAfterDrag();
        return;
    }
    // Swap elements if valid drop target
    if (targetElement && draggedElement !== targetElement) {
        swapBoxes(draggedElement, targetElement);
    } else if (e.timeStamp - touchStart < 300) {
        console.log("This was a click not a touch");
        var div = e.target;
        const boxId = $(div).data('boxId');
        const boxData = boxes.find(box => box.boxId == boxId);
        if (!boxData.confirmed) {
            toggleBoxColor(div, boxData);
        }
    } else {
        console.log("This was an aborted drag");
    }
    cleanupAfterDrag();

}

function cleanupAfterDrag() {
    $(".box").removeClass("dragging overlapping");
    draggedElement = null; // Clear the dragged element
}

function handleDragStart(e) {
    console.log("Drag start: " + e.target.textContent);
    draggedElement = e.target; // Track the dragged element
    $(e.target).addClass('dragging');
}

function handleDragEnd(e) {
    console.log("Drag end: " + e.target.textContent);
    $(e.target).removeClass('dragging');
    clearOverlapping();
}

function handleDragOver(e) {
    console.log("Drag over: " + e.target.textContent);
    e.preventDefault(); // Allow dropping
    clearOverlapping();
    if (e.target !== draggedElement) {
        $(e.target).addClass('overlapping');
    }
}

function handleDragLeave(e) {
    console.log("Drag leave: " + e.target.textContent);
    e.preventDefault();
    if (e.target !== draggedElement) {
        clearOverlapping();
    }
}

function handleDrop(e, draggedElement, _grid) {
    console.log("Drop: " + e.target.textContent);
    e.preventDefault();
    const targetElement = e.target;
    if (draggedElement !== targetElement) {
        // Swap the boxes based on boxId
        swapBoxes(draggedElement, targetElement);
    }
    clearOverlapping();
    renderGrid();
}

function clearOverlapping() {
    $(".box").removeClass('overlapping');

}

function attachBoxEvents(div, boxData, _grid) {
    $(div).on('click', function () {
        if (!boxData.confirmed) {
            console.log("Click: " + div.textContent);
            toggleBoxColor(div, boxData, ["white", "yellow", "green", "blue", "purple"]);
        } else {
            console.log("Clicked on locked box: " + div.textContent);
        }

    });

    $(div).on('dragstart', handleDragStart);
    $(div).on('dragend', handleDragEnd);
    $(div).on('dragover', handleDragOver);
    $(div).on('dragleave', handleDragLeave);
    $(div).on('drop', function (e) {
        handleDrop(e, draggedElement, _grid); // Handle the drop event
    });
    $(div).on('touchstart', handleTouchStart);
    $(div).on('touchmove', handleTouchMove);
    $(div).on('touchend', handleTouchEnd);
}