const VERTEX_SHADER = `
attribute vec2 position;
void main() {
    gl_Position = vec4(position, 0.0, 1.0);
}
`;

// Equal Earth's inverse follows d3-geo; its license is included in the build.
const FRAGMENT_SHADER = `
precision highp float;
uniform sampler2D atlas;
uniform vec2 resolution;
uniform vec2 size;
uniform vec2 center;
uniform vec2 rotation;
uniform float scale;
uniform int projection;
const float PI = 3.141592653589793;
const float M = 0.866025403784439;
const float A1 = 1.340264;
const float A2 = -0.081106;
const float A3 = 0.000893;
const float A4 = 0.003796;

void main() {
    vec2 screen = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y) * size / resolution;
    vec2 p = vec2(screen.x - center.x, center.y - screen.y) / scale;
    float longitude;
    float latitude;
    if (projection == 0) {
        float squared = dot(p, p);
        if (squared > 1.0) discard;
        float depth = sqrt(max(0.0, 1.0 - squared));
        float c = cos(rotation.y);
        float s = sin(rotation.y);
        longitude = atan(p.x, depth * c + p.y * s) - rotation.x;
        latitude = asin(clamp(p.y * c - depth * s, -1.0, 1.0));
        longitude = mod(longitude + PI, 2.0 * PI) - PI;
    } else {
        float l = p.y;
        for (int i = 0; i < 12; i++) {
            float l2 = l * l;
            float l6 = l2 * l2 * l2;
            float fy = l * (A1 + A2 * l2 + l6 * (A3 + A4 * l2)) - p.y;
            float fpy = A1 + 3.0 * A2 * l2 + l6 * (7.0 * A3 + 9.0 * A4 * l2);
            l -= fy / fpy;
        }
        if (abs(l) > PI / 3.0 + 0.000001) discard;
        float l2 = l * l;
        float l6 = l2 * l2 * l2;
        longitude = M * p.x * (A1 + 3.0 * A2 * l2 + l6 * (7.0 * A3 + 9.0 * A4 * l2)) / cos(l);
        if (abs(longitude) > PI) discard;
        latitude = asin(clamp(sin(l) / M, -1.0, 1.0));
    }
    vec2 uv = vec2((longitude + PI) / (2.0 * PI), (PI / 2.0 - latitude) / PI);
    gl_FragColor = texture2D(atlas, uv);
}
`;

export function createRasterRenderer(onError, minimumSize) {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: false });
    if (!gl || !gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT).precision ||
        gl.getParameter(gl.MAX_TEXTURE_SIZE) < minimumSize) return null;
    const textures = new Map();
    let lost = false;
    canvas.addEventListener("webglcontextlost", event => {
        event.preventDefault();
        lost = true;
        onError(new Error("Map graphics context lost. Reload the page."));
    });

    function compile(type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error("Map shader failed: " + gl.getShaderInfoLog(shader));
        }
        return shader;
    }

    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error("Map shader link failed: " + gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniforms = Object.fromEntries(["atlas", "resolution", "size", "center", "rotation", "scale", "projection"]
        .map(name => [name, gl.getUniformLocation(program, name)]));
    gl.uniform1i(uniforms.atlas, 0);

    return {
        setTexture(id, image) {
            if (image.width > gl.getParameter(gl.MAX_TEXTURE_SIZE) || image.height > gl.getParameter(gl.MAX_TEXTURE_SIZE)) {
                throw new Error("Map image exceeds this device's texture limit");
            }
            if (textures.has(id)) gl.deleteTexture(textures.get(id));
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, image.width, image.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, image.data);
            const error = gl.getError();
            if (error !== gl.NO_ERROR) throw new Error("Couldn't upload map image (" + error + ")");
            textures.set(id, texture);
        },
        render(id, view, projection, ratio) {
            if (lost) return null;
            const width = Math.round(view.width * ratio);
            const height = Math.round(view.height * ratio);
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }
            gl.viewport(0, 0, width, height);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.bindTexture(gl.TEXTURE_2D, textures.get(id));
            gl.uniform2f(uniforms.resolution, width, height);
            gl.uniform2f(uniforms.size, view.width, view.height);
            gl.uniform2fv(uniforms.center, projection.translate());
            gl.uniform2f(uniforms.rotation, view.rotation[0] * Math.PI / 180, view.rotation[1] * Math.PI / 180);
            gl.uniform1f(uniforms.scale, projection.scale());
            gl.uniform1i(uniforms.projection, view.projection === "globe" ? 0 : 1);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            return canvas;
        },
    };
}
