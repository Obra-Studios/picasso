// This plugin draws a random bezier curve every 2 seconds and prints the document tree

// Function to generate a random number between min and max
function random(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

// Function to print the document tree recursively
async function printDocumentTree(node: BaseNode, depth: number = 0): Promise<void> {
    const indent = '  '.repeat(depth);
    const nodeInfo = `${indent}${node.type}: ${node.name || '(unnamed)'}`;
    console.log(nodeInfo);

    // For PageNode, we need to load it first before accessing children
    if (node.type === 'PAGE') {
        await (node as PageNode).loadAsync();
    }

    // If the node has children, recursively print them
    if ('children' in node) {
        for (const child of node.children) {
            await printDocumentTree(child, depth + 1);
        }
    }
}

// Function to create a random bezier curve
function createRandomBezierCurve(): VectorNode {
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
(async () => {
    console.log('Starting bezier curve drawer and document tree printer...');

    // Load all pages first
    await figma.loadAllPagesAsync();

    console.log('Document tree at start:');
    await printDocumentTree(figma.root);

    // Draw a curve and print tree every 2 seconds
    let intervalCount = 0;
    const intervalId = setInterval(async () => {
        intervalCount++;
        console.log(`\n========== Interval #${intervalCount} ==========`);
        console.log('--- Drawing new bezier curve ---');

        // Create and add the random bezier curve
        const curve = createRandomBezierCurve();
        figma.currentPage.appendChild(curve);

        // Reload pages to get latest state
        await figma.loadAllPagesAsync();

        console.log('\n--- Printing updated document tree ---');
        await printDocumentTree(figma.root);
        console.log('--- End of document tree ---');

        console.log(`========== End of Interval #${intervalCount} ==========\n`);
    }, 2000);

    // Clean up on plugin close
    figma.on('close', () => {
        clearInterval(intervalId);
    });
})();

