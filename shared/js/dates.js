export function getCurrentDateFormatted() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

// Wires a date input to today and reloads the game whenever it changes.
export function attachDatePicker(selector, onChange) {
    const today = getCurrentDateFormatted();
    $(selector).val(today);
    $(selector).on('change', function () {
        const picked = $(selector).val();
        if (picked) {
            onChange(picked);
        }
    });
    return today;
}
