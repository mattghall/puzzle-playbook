const chaseSeconds = 1.8;

// Negative stagger so the tint travels the list and the loop is already running on the first frame.
export function startChase(elements) {
    const total = elements.length;
    elements.forEach((el, i) => {
        const delay = (i / total) * chaseSeconds - chaseSeconds;
        el.classList.add('chase');
        el.style.setProperty('--chase-delay', delay.toFixed(3) + 's');
    });
}
