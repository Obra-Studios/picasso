"use strict";
// This plugin draws a random bezier curve every 2 seconds and prints the document tree
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// Function to generate a random number between min and max
function random(min, max) {
    return Math.random() * (max - min) + min;
}
// Function to print the document tree recursively
function printDocumentTree(node_1) {
    return __awaiter(this, arguments, void 0, function* (node, depth = 0) {
        const indent = '  '.repeat(depth);
        const nodeInfo = `${indent}${node.type}: ${node.name || '(unnamed)'}`;
        console.log(nodeInfo);
        // For PageNode, we need to load it first before accessing children
        if (node.type === 'PAGE') {
            yield node.loadAsync();
        }
        // If the node has children, recursively print them
        if ('children' in node) {
            for (const child of node.children) {
                yield printDocumentTree(child, depth + 1);
            }
        }
    });
}
// Function to create a random bezier curve
function createRandomBezierCurve() {
    const vector = figma.createVector();
    // Set random position
    const x = random(0, figma.viewport.bounds.width || 1000);
    const y = random(0, figma.viewport.bounds.height || 1000);
    // Create a path with a random bezier curve
    // A bezier curve needs: start point, control point 1, control point 2, end point
    const startX = random(0, 200);
    const startY = random(0, 200);
    const control1X = random(0, 200);
    const control1Y = random(0, 200);
    const control2X = random(0, 200);
    const control2Y = random(0, 200);
    const endX = random(0, 200);
    const endY = random(0, 200);
    // Create the bezier path
    vector.vectorPaths = [{
            windingRule: 'NONZERO',
            data: `M ${startX} ${startY} C ${control1X} ${control1Y}, ${control2X} ${control2Y}, ${endX} ${endY}`
        }];
    // Set random fill color
    vector.fills = [{
            type: 'SOLID',
            color: {
                r: random(0, 1),
                g: random(0, 1),
                b: random(0, 1)
            }
        }];
    // Set position
    vector.x = x;
    vector.y = y;
    // Set stroke
    vector.strokes = [{
            type: 'SOLID',
            color: {
                r: random(0, 1),
                g: random(0, 1),
                b: random(0, 1)
            }
        }];
    vector.strokeWeight = random(1, 5);
    return vector;
}
// Main execution
(() => __awaiter(void 0, void 0, void 0, function* () {
    console.log('Starting bezier curve drawer and document tree printer...');
    // Load all pages first
    yield figma.loadAllPagesAsync();
    console.log('Document tree at start:');
    yield printDocumentTree(figma.root);
    // Draw a curve and print tree every 2 seconds
    let intervalCount = 0;
    const intervalId = setInterval(() => __awaiter(void 0, void 0, void 0, function* () {
        intervalCount++;
        console.log(`\n========== Interval #${intervalCount} ==========`);
        console.log('--- Drawing new bezier curve ---');
        // Create and add the random bezier curve
        const curve = createRandomBezierCurve();
        figma.currentPage.appendChild(curve);
        // Reload pages to get latest state
        yield figma.loadAllPagesAsync();
        console.log('\n--- Printing updated document tree ---');
        yield printDocumentTree(figma.root);
        console.log('--- End of document tree ---');
        console.log(`========== End of Interval #${intervalCount} ==========\n`);
    }), 2000);
    // Clean up on plugin close
    figma.on('close', () => {
        clearInterval(intervalId);
    });
}))();
