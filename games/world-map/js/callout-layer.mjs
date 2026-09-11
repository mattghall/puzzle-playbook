import { getAssetUrl } from "./imagery.mjs";

export function createCalloutLayer(container, canvas, onCountry, onError) {
    const buttons = new Map();
    return (callouts, appearance) => {
        const visible = new Set();
        for (const callout of callouts) {
            if (!callout.box) continue;
            visible.add(callout.id);
            let button = buttons.get(callout.id);
            if (!button) {
                button = document.createElement("button");
                button.type = "button";
                button.className = "country-callout";
                button.dataset.country = callout.id;
                button.addEventListener("click", () => onCountry(callout.id));
                buttons.set(callout.id, button);
                container.append(button);
            }
            const image = appearance.mode === "imagery" ? appearance.images?.[callout.id] : null;
            const content = appearance.mode + ":" + (image?.src || "");
            if (button.dataset.content !== content) {
                const icon = document.createElement(image ? "img" : "span");
                icon.className = image ? "callout-image" : "callout-bubble";
                if (image) {
                    icon.alt = "";
                    icon.src = getAssetUrl(image.src);
                    icon.addEventListener("error", () => onError(new Error("Couldn't load " + image.label)), { once: true });
                }
                const name = document.createElement("span");
                name.className = "callout-name";
                name.textContent = callout.name;
                button.replaceChildren(icon, name);
                button.dataset.content = content;
            }
            const status = appearance.mode === "imagery" ? image?.label || "Image unavailable" : appearance.statuses.get(callout.id);
            button.title = callout.name + ": " + status;
            button.setAttribute("aria-label", button.title);
            button.setAttribute("aria-pressed", String(callout.id === appearance.selected));
            button.style.setProperty("--callout-color", appearance.colors.get(callout.id));
            const [left, top, right, bottom] = callout.box;
            button.style.transform = `translate(${left}px, ${top}px)`;
            button.style.width = right - left + "px";
            button.style.height = bottom - top + "px";
            button.style.setProperty("--label-width", callout.labelWidth + "px");
            button.style.setProperty("--label-left", callout.labelOffset[0] + "px");
            button.style.setProperty("--label-top", callout.labelOffset[1] + "px");
        }
        for (const [id, button] of buttons) {
            if (visible.has(id)) continue;
            if (button === document.activeElement) canvas.focus({ preventScroll: true });
            button.remove();
            buttons.delete(id);
        }
        container.hidden = !visible.size;
    };
}
