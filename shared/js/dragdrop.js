// One drag engine for every game, covering mouse drag and touch.
// Phones fire touch events for plain taps too, so a short touch that ends on the element
// it started on counts as a click rather than an aborted drag.
const TAP_MS = 300;

// Builds an engine bound to one game's selectors. config:
//   dragSelector   elements that can carry .dragging, for cleanup
//   dropSelector   elements that can carry .overlapping, for cleanup
//   findTarget     maps the node under the pointer to a drop target, or null
export function createDragEngine(config) {
    let dragged = null;
    let touchStartedAt = 0;

    function clearOverlapping() {
        $(config.dropSelector).removeClass('overlapping');
    }

    function cleanup() {
        $(config.dragSelector).removeClass('dragging');
        clearOverlapping();
        dragged = null;
    }

    function highlight(node) {
        clearOverlapping();
        const target = config.findTarget(node);
        if (target && target !== dragged) {
            $(target).addClass('overlapping');
        }
        return target;
    }

    function begin(el, onPick) {
        dragged = el;
        $(el).addClass('dragging');
        if (onPick) {
            onPick(el);
        }
    }

    // opts: onTap, onDrop(target, dragged), onPick
    function makeDraggable(el, opts) {
        $(el).on('click', function (e) {
            e.stopPropagation();
            if (opts.onTap) {
                opts.onTap(el);
            }
        });

        $(el).on('dragstart', function () {
            begin(el, opts.onPick);
        });

        $(el).on('dragend', cleanup);

        $(el).on('touchstart', function (e) {
            e.preventDefault();
            touchStartedAt = e.timeStamp;
            begin(el, opts.onPick);
        });

        $(el).on('touchmove', function (e) {
            e.preventDefault();
            const touch = e.touches[0];
            highlight(document.elementFromPoint(touch.clientX, touch.clientY));
        });

        $(el).on('touchend', function (e) {
            e.preventDefault();
            const touch = e.changedTouches[0];
            const node = document.elementFromPoint(touch.clientX, touch.clientY);
            const target = config.findTarget(node);
            const quick = e.timeStamp - touchStartedAt < TAP_MS;
            cleanup();
            // Still over the thing you grabbed, and it was brief, so it was a tap.
            if (quick && (!node || el.contains(node) || node === el)) {
                if (opts.onTap) {
                    opts.onTap(el);
                }
                return;
            }
            if (target && target !== el && opts.onDrop) {
                opts.onDrop(target, el);
            }
        });
    }

    // opts: onDrop(target, dragged)
    function makeDropTarget(el, opts) {
        $(el).on('dragover', function (e) {
            e.preventDefault();
            highlight(e.target);
        });

        $(el).on('dragleave', function () {
            $(el).removeClass('overlapping');
        });

        $(el).on('drop', function (e) {
            e.preventDefault();
            const source = dragged;
            cleanup();
            if (source && source !== el && opts.onDrop) {
                opts.onDrop(el, source);
            }
        });
    }

    return {
        makeDraggable,
        makeDropTarget,
        cleanup,
        clearOverlapping,
        current: function () {
            return dragged;
        }
    };
}
