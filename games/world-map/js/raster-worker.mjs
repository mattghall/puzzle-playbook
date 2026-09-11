import { createProjection, isVisible } from "./projection.mjs";

const TEXTURES = new Map();

self.onmessage = function(event) {
    const message = event.data;
    if (message.type === "texture") {
        TEXTURES.set(message.id, { width: message.width, height: message.height, pixels: new Uint8ClampedArray(message.buffer) });
        self.postMessage({ type: "ready", id: message.id });
        return;
    }
    try {
        const texture = TEXTURES.get(message.texture);
        if (!texture) throw new Error("Image texture unavailable");
        const view = message.view;
        const ratio = message.ratio;
        const width = Math.max(1, Math.round(view.width * ratio));
        const height = Math.max(1, Math.round(view.height * ratio));
        const projection = createProjection(view);
        const pixels = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const screen = [(x + 0.5) / ratio, (y + 0.5) / ratio];
                const point = projection.invert(screen);
                if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) ||
                    Math.abs(point[1]) > 90 || !isVisible(point, view)) continue;
                // Inverse projections also return points beyond their visible outline.
                const projected = projection(point);
                if (Math.abs(projected[0] - screen[0]) > 0.5 || Math.abs(projected[1] - screen[1]) > 0.5) continue;
                const tx = Math.min(texture.width - 1, Math.max(0, Math.floor((point[0] + 180) / 360 * texture.width)));
                const ty = Math.min(texture.height - 1, Math.max(0, Math.floor((90 - point[1]) / 180 * texture.height)));
                const from = (ty * texture.width + tx) * 4;
                const to = (y * width + x) * 4;
                pixels[to] = texture.pixels[from];
                pixels[to + 1] = texture.pixels[from + 1];
                pixels[to + 2] = texture.pixels[from + 2];
                pixels[to + 3] = texture.pixels[from + 3];
            }
        }
        self.postMessage({ type: "frame", sequence: message.sequence, width, height, buffer: pixels.buffer }, [pixels.buffer]);
    } catch (error) {
        self.postMessage({ type: "error", message: error.message, sequence: message.sequence });
    }
};
