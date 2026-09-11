import { parse } from "acorn";

function walk(node, visit) {
    if (!node || typeof node !== "object") return;
    if (node.type) visit(node);
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(child => walk(child, visit));
        else if (value && typeof value === "object") walk(value, visit);
    }
}

function getProperty(node, name) {
    if (node?.type !== "ObjectExpression") throw new Error("Expected atlas metadata object");
    return node.properties.find(item => item.type === "Property" && !item.computed && (item.key.name || item.key.value) === name)?.value;
}

function readLiteral(node) {
    if (node?.type === "Literal" && !node.regex) return node.value;
    if (node?.type === "ArrayExpression") return node.elements.map(readLiteral);
    if (node?.type === "ObjectExpression") {
        return Object.fromEntries(node.properties.map(item => {
            if (item.type !== "Property" || item.computed || item.method || item.kind !== "init") throw new Error("Unsupported atlas object syntax");
            return [item.key.name || item.key.value, readLiteral(item.value)];
        }));
    }
    if (node?.type === "UnaryExpression" && node.operator === "!" && node.argument.type === "Literal") return !node.argument.value;
    if (node?.type === "UnaryExpression" && node.operator === "-" && typeof node.argument.value === "number") return -node.argument.value;
    throw new Error("Unsupported literal atlas syntax: " + node?.type);
}

function formatCompactNumber(value) {
    for (const [size, suffix] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]) {
        if (value >= size) return value / size + suffix;
    }
    return String(value);
}

function readLabelValue(node, parameter, argument) {
    if (node.type === "Literal") return readLiteral(node);
    if (node.type === "MemberExpression" && !node.computed && node.object.name === argument && ["id", "name", "value", "code"].includes(node.property.name)) {
        return parameter[node.property.name];
    }
    if (node.type === "TemplateLiteral") {
        return node.quasis.reduce((result, part, index) => result + part.value.cooked + (node.expressions[index] ? readLabelValue(node.expressions[index], parameter, argument) : ""), "");
    }
    if (node.type === "BinaryExpression" && node.operator === "+") return readLabelValue(node.left, parameter, argument) + readLabelValue(node.right, parameter, argument);
    if (node.type === "CallExpression" && node.arguments.length === 1 && node.callee.type === "Identifier") {
        const value = readLabelValue(node.arguments[0], parameter, argument);
        // These two helpers format short picker labels; no upstream function is executed.
        if (node.callee.name === "Ci" && typeof value === "number") return formatCompactNumber(value);
        if (node.callee.name === "Si" && typeof value === "string") return value.charAt(0).toUpperCase() + value.slice(1);
    }
    throw new Error("Unsupported atlas label syntax: " + node.type);
}

export function extractCatalog(source) {
    const ast = parse(source, { ecmaVersion: "latest" });
    const declarations = [];
    const arrays = [];
    walk(ast, node => {
        if (node.type === "VariableDeclarator") declarations.push(node);
        if (node.type === "ArrayExpression") arrays.push(node);
    });
    const findDeclaration = (name, before) => {
        const matches = declarations.filter(node => node.id.name === name && node.start < before && ["ObjectExpression", "ArrayExpression"].includes(node.init?.type));
        if (!matches.length) throw new Error("Missing literal atlas declaration: " + name);
        return matches.at(-1).init;
    };
    const getSectionName = node => node?.type === "ObjectExpression" && getProperty(node, "section")?.value;
    const hasId = (node, id) => {
        let found = false;
        walk(node, entry => {
            if (entry.type === "Property" && (entry.key.name || entry.key.value) === "id" && entry.value.value === id) found = true;
        });
        return found;
    };
    const pickers = arrays.filter(node => node.elements.some(item => getSectionName(item) === "Capital") && node.elements.some(item => getSectionName(item) === "Flag") && hasId(node, "island_nation"));
    if (pickers.length !== 1) throw new Error("Expected exactly one world category picker");
    const picker = pickers[0];
    const atlases = arrays.filter(node => node.elements.length && node.elements.every(item => {
        if (item?.type !== "Identifier") return false;
        const candidates = declarations.filter(entry => entry.id.name === item.name && entry.start < node.start && entry.init?.type === "ObjectExpression");
        return candidates.length && getProperty(candidates.at(-1).init, "categories");
    }));
    const worldAtlases = atlases.filter(node => node.elements.some(item => {
        const categories = getProperty(findDeclaration(item.name, node.start), "categories");
        return categories.elements.some(category => readLiteral(getProperty(category, "ids")).includes("island_nation"));
    }));
    if (worldAtlases.length !== 1) throw new Error("Expected exactly one world Categories Atlas");
    const metadata = new Map();
    for (const reference of worldAtlases[0].elements) {
        const section = findDeclaration(reference.name, worldAtlases[0].start);
        const categories = getProperty(section, "categories");
        if (categories?.type !== "ArrayExpression") throw new Error("Unsupported atlas categories");
        for (const category of categories.elements) {
            const ids = readLiteral(getProperty(category, "ids"));
            const name = readLiteral(getProperty(category, "name"));
            const sourceNode = getProperty(category, "sources");
            const sources = sourceNode ? readLiteral(sourceNode).map(item => ({ name: item.name, url: item.link })) : [];
            for (const id of ids) {
                if (metadata.has(id)) throw new Error("Duplicate atlas category: " + id);
                metadata.set(id, { category: name, sources });
            }
        }
    }
    const choices = [];
    for (const sectionNode of picker.elements) {
        const section = readLiteral(getProperty(sectionNode, "section"));
        const entries = getProperty(sectionNode, "choices");
        if (entries?.type !== "ArrayExpression") throw new Error("Unsupported picker choices");
        for (const entry of entries.elements) {
            let parameters = [null];
            let object = entry;
            let argument;
            if (entry.type === "SpreadElement") {
                const call = entry.argument;
                if (call.type !== "CallExpression" || call.callee.type !== "MemberExpression" || call.callee.computed || call.callee.property.name !== "map" || call.callee.object.type !== "Identifier" || call.arguments.length !== 1) {
                    throw new Error("Unsupported picker variant expansion");
                }
                const callback = call.arguments[0];
                if (callback.type !== "ArrowFunctionExpression" || callback.params.length !== 1 || callback.params[0].type !== "Identifier" || callback.body.type !== "ObjectExpression") {
                    throw new Error("Unsupported picker variant metadata");
                }
                argument = callback.params[0].name;
                object = callback.body;
                parameters = readLiteral(findDeclaration(call.callee.object.name, picker.start));
            }
            const id = readLiteral(getProperty(object, "id"));
            const category = metadata.get(id);
            if (!category) throw new Error("World picker category absent from atlas: " + id);
            for (const parameter of parameters) {
                const variantId = readLabelValue(getProperty(object, "variantId"), parameter, argument);
                const label = readLabelValue(getProperty(object, "name"), parameter, argument).replace(/\bGrey\b/g, "Gray");
                if (variantId !== null && !Number.isInteger(variantId)) throw new Error("Invalid picker variant: " + id);
                if (!label || typeof label !== "string") throw new Error("Missing picker label: " + id);
                choices.push({
                    key: id + ":" + (variantId ?? "default"), id, variantId, label, section,
                    ...category,
                    parameter: parameter ? parameter.code ?? parameter.value : null,
                    ...(parameter?.legacy ? { legacy: true } : {}),
                });
            }
        }
    }
    const ids = new Set(choices.map(choice => choice.id));
    const missing = [...metadata.keys()].filter(id => !ids.has(id));
    if (missing.length) throw new Error("Atlas categories absent from world picker: " + missing.join(", "));
    if (new Set(choices.map(choice => choice.key)).size !== choices.length) throw new Error("Duplicate world picker variants");
    return choices;
}
