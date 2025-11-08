"use strict";
// This plugin uses OpenAI to complete vector designs based on user prompts
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// Prompts configuration - can be edited to customize AI behavior
const prompts = {
    systemPrompt: "You are a design assistant that helps complete designs in Figma. Given a description of existing shapes (rectangles, circles, ellipses, polygons, stars, lines, vectors) and a user's prompt, you should generate instructions for creating additional shapes to complete the design. CRITICAL: Pay close attention to the spatial positioning of existing shapes. Use the center coordinates (centerX, centerY) and bounds information to position new shapes relative to existing ones. Ensure all new shapes are positioned within the frame bounds and in logical positions relative to the existing design. Respond with a JSON array of shape creation instructions.",
    vectorDescriptionPrompt: "Describe the following vector in detail, including its shape, position, size, and any visual characteristics:",
    semanticDescriptionPrompt: "Based on the following DOM-like representation of shapes (rectangles, circles, polygons, stars, lines, vectors, etc.), provide a clear, concise description of what this design looks like. CRITICAL: Include specific pixel positions, coordinates, and spatial relationships. For each shape, mention:\n- Exact pixel positions (x, y coordinates)\n- Center coordinates (centerX, centerY)\n- Dimensions (width x height)\n- Spatial relationships between shapes (e.g., 'Shape A is at (100, 200) with center at (150, 250), positioned 50 pixels above Shape B at (100, 300)')\n- Frame bounds and how shapes are positioned within the frame\nUse specific numbers from the bounds data. Keep it to 3-4 sentences:\n\n{domRepresentation}",
    completionPrompt: "Given the existing shape description and the user's request to \"{userPrompt}\", generate instructions for creating additional shapes.\n\nSPATIAL CONTEXT:\n- The existing shape description is: {vectorDescription}\n- The DOM representation includes center coordinates (centerX, centerY) for each existing shape\n- Frame bounds are provided in the DOM representation - ensure all new shapes are positioned within these bounds\n- Use the center coordinates and bounds of existing shapes to position new shapes logically relative to them\n- The x, y coordinates you provide should be the top-left corner of the shape\n- Position new shapes in a way that makes visual sense relative to existing shapes\n\nDOM representation: {domRepresentation}\n\nRespond with a JSON array where each object has: type (circle, rectangle, ellipse, polygon, star, line, vector, or arrow), x, y, width, height (if applicable), pointCount (for polygon/star), innerRadius (for star), fills (color as RGB 0-1), strokes (color as RGB 0-1), strokeWeight, and any path data if it's a vector path. IMPORTANT: Ensure x and y coordinates place shapes within the frame bounds and in logical positions relative to existing shapes."
};
// Get DOM-like representation of any shape node
function getDOMRepresentation(node) {
    const bounds = node.absoluteBoundingBox;
    const fills = 'fills' in node ? node.fills : [];
    const strokes = 'strokes' in node ? node.strokes : [];
    const strokeWeight = ('strokeWeight' in node && typeof node.strokeWeight === 'number') ? node.strokeWeight : 0;
    const baseRep = {
        type: node.type,
        name: node.name || `Unnamed ${node.type}`,
        bounds: bounds ? {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            centerX: bounds.x + bounds.width / 2,
            centerY: bounds.y + bounds.height / 2
        } : null,
        fills: Array.isArray(fills) ? fills.map((fill) => {
            if (fill.type === 'SOLID') {
                return {
                    type: 'SOLID',
                    color: {
                        r: fill.color.r,
                        g: fill.color.g,
                        b: fill.color.b
                    },
                    opacity: fill.opacity !== undefined ? fill.opacity : 1
                };
            }
            return fill;
        }) : [],
        strokes: Array.isArray(strokes) ? strokes.map((stroke) => {
            if (stroke.type === 'SOLID') {
                return {
                    type: 'SOLID',
                    color: {
                        r: stroke.color.r,
                        g: stroke.color.g,
                        b: stroke.color.b
                    },
                    opacity: stroke.opacity !== undefined ? stroke.opacity : 1
                };
            }
            return stroke;
        }) : [],
        strokeWeight: strokeWeight
    };
    // Add type-specific properties
    switch (node.type) {
        case 'RECTANGLE':
            baseRep.cornerRadius = node.cornerRadius || 0;
            break;
        case 'ELLIPSE':
            // Ellipses don't have additional properties beyond base
            break;
        case 'POLYGON':
            baseRep.pointCount = node.pointCount || 3;
            break;
        case 'STAR':
            const starNode = node;
            baseRep.pointCount = starNode.pointCount || 5;
            baseRep.innerRadius = starNode.innerRadius || 0.5;
            break;
        case 'VECTOR':
            const vectorNode = node;
            baseRep.vectorPaths = vectorNode.vectorPaths && vectorNode.vectorPaths.length > 0
                ? vectorNode.vectorPaths.map(path => ({
                    windingRule: path.windingRule,
                    data: path.data
                }))
                : [];
            break;
        case 'LINE':
            // Lines don't have additional properties beyond base
            break;
    }
    return baseRep;
}
// Get DOM representation of all shapes as a structured tree
function getShapesDOMRepresentation(shapes, frame) {
    // Get frame bounds if available
    let frameBounds = null;
    if (frame) {
        const bounds = frame.absoluteBoundingBox;
        if (bounds) {
            frameBounds = {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
                centerX: bounds.x + bounds.width / 2,
                centerY: bounds.y + bounds.height / 2
            };
        }
    }
    return {
        documentTree: {
            type: 'DOCUMENT',
            frame: frameBounds,
            children: shapes.map(shape => getDOMRepresentation(shape))
        }
    };
}
// Describe any shape node
function describeShape(shape) {
    const bounds = shape.absoluteBoundingBox;
    const size = bounds ? `Size: ${bounds.width}x${bounds.height}` : 'Size: unknown';
    const position = bounds ? `Position: (${bounds.x}, ${bounds.y})` : 'Position: unknown';
    const fills = 'fills' in shape ? shape.fills : [];
    const fillInfo = Array.isArray(fills) && fills.length > 0
        ? `Fill: ${JSON.stringify(fills)}`
        : 'No fill';
    const strokes = 'strokes' in shape ? shape.strokes : [];
    const strokeWeight = ('strokeWeight' in shape && typeof shape.strokeWeight === 'number') ? shape.strokeWeight : 0;
    const strokeInfo = Array.isArray(strokes) && strokes.length > 0
        ? `Stroke: ${JSON.stringify(strokes)}, Weight: ${strokeWeight}`
        : 'No stroke';
    let typeInfo = '';
    switch (shape.type) {
        case 'RECTANGLE':
            const rect = shape;
            const cornerRadius = typeof rect.cornerRadius === 'number' ? rect.cornerRadius : 0;
            typeInfo = `Rectangle${cornerRadius > 0 ? `, Corner Radius: ${cornerRadius}` : ''}`;
            break;
        case 'ELLIPSE':
            typeInfo = 'Ellipse/Circle';
            break;
        case 'POLYGON':
            const polygon = shape;
            typeInfo = `Polygon, Points: ${polygon.pointCount || 3}`;
            break;
        case 'STAR':
            const star = shape;
            typeInfo = `Star, Points: ${star.pointCount || 5}, Inner Radius: ${star.innerRadius || 0.5}`;
            break;
        case 'VECTOR':
            const vector = shape;
            const pathInfo = vector.vectorPaths && vector.vectorPaths.length > 0
                ? `Paths: ${vector.vectorPaths.length} path(s)`
                : 'No paths';
            typeInfo = `Vector, ${pathInfo}`;
            break;
        case 'LINE':
            typeInfo = 'Line';
            break;
        default:
            typeInfo = shape.type;
    }
    return `${shape.name || `Unnamed ${shape.type}`} (${typeInfo}), ${size}, ${position}, ${fillInfo}, ${strokeInfo}`;
}
// Generate semantic description using OpenAI
function generateSemanticDescription(apiKey, domRepresentation, onDebug) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log('generateSemanticDescription: Starting...');
            const domString = JSON.stringify(domRepresentation, null, 2);
            const userPrompt = prompts.semanticDescriptionPrompt.replace('{domRepresentation}', domString);
            console.log('generateSemanticDescription: Calling OpenAI...');
            const response = yield callOpenAI(apiKey, "You are a design analysis assistant. Describe visual designs in clear, human-readable terms.", userPrompt, onDebug);
            console.log('generateSemanticDescription: Received response, length:', response.length);
            const trimmed = response.trim();
            console.log('generateSemanticDescription: Returning trimmed response, length:', trimmed.length);
            return trimmed;
        }
        catch (error) {
            console.error('generateSemanticDescription: Error occurred:', error);
            throw error;
        }
    });
}
// Get all frames in the document
function getAllFrames() {
    return __awaiter(this, void 0, void 0, function* () {
        yield figma.loadAllPagesAsync();
        const frames = [];
        const pages = figma.root.children;
        // Search through all pages for frames
        for (const page of pages) {
            if (page.type === 'PAGE') {
                const pageNode = page;
                // Ensure page is loaded
                yield pageNode.loadAsync();
                // Traverse the page to find all frames
                function collectFrames(node) {
                    if (node.type === 'FRAME') {
                        frames.push({
                            id: node.id,
                            name: node.name || 'Unnamed Frame',
                            pageName: pageNode.name || 'Unnamed Page'
                        });
                    }
                    if ('children' in node) {
                        for (const child of node.children) {
                            collectFrames(child);
                        }
                    }
                }
                for (const child of pageNode.children) {
                    collectFrames(child);
                }
            }
        }
        return frames;
    });
}
// Find a frame by ID
function findFrameById(frameId) {
    return __awaiter(this, void 0, void 0, function* () {
        yield figma.loadAllPagesAsync();
        const pages = figma.root.children;
        // Search through all pages for the frame with matching ID
        for (const page of pages) {
            if (page.type === 'PAGE') {
                const pageNode = page;
                yield pageNode.loadAsync();
                function findFrame(node) {
                    if (node.type === 'FRAME' && node.id === frameId) {
                        return node;
                    }
                    if ('children' in node) {
                        for (const child of node.children) {
                            const frame = findFrame(child);
                            if (frame) {
                                return frame;
                            }
                        }
                    }
                    return null;
                }
                for (const child of pageNode.children) {
                    const frame = findFrame(child);
                    if (frame) {
                        return frame;
                    }
                }
            }
        }
        return null;
    });
}
// Find all shapes (primitives and vectors) on a specific frame
function findVectorsOnFrame(frameId) {
    return __awaiter(this, void 0, void 0, function* () {
        const shapes = [];
        let frame = null;
        // Supported shape types
        const supportedTypes = ['RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'VECTOR', 'LINE'];
        function traverse(node) {
            if (supportedTypes.indexOf(node.type) !== -1) {
                shapes.push(node);
            }
            if ('children' in node) {
                for (const child of node.children) {
                    traverse(child);
                }
            }
        }
        if (frameId) {
            frame = yield findFrameById(frameId);
            if (frame) {
                for (const child of frame.children) {
                    traverse(child);
                }
            }
        }
        else {
            // Fallback: use current page if no frame selected
            for (const child of figma.currentPage.children) {
                traverse(child);
            }
        }
        return { vectors: shapes, frame };
    });
}
// Call OpenAI API
function callOpenAI(apiKey, systemPrompt, userPrompt, onDebug) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const requestBody = {
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.7,
            max_tokens: 1000
        };
        const requestData = {
            url: 'https://api.openai.com/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey.substring(0, 7)}...` // Mask API key for display
            },
            body: requestBody
        };
        const response = yield fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody)
        });
        const responseText = yield response.text();
        let responseData;
        if (!response.ok) {
            try {
                responseData = JSON.parse(responseText);
            }
            catch (_d) {
                responseData = { error: responseText };
            }
            if (onDebug) {
                onDebug(requestData, {
                    status: response.status,
                    statusText: response.statusText,
                    error: responseData
                });
            }
            throw new Error(`OpenAI API error: ${response.status} - ${responseText}`);
        }
        try {
            responseData = JSON.parse(responseText);
        }
        catch (parseError) {
            console.error('Error parsing response:', parseError);
            console.error('Response text:', responseText);
            responseData = { raw: responseText };
        }
        if (onDebug) {
            try {
                onDebug(requestData, {
                    status: response.status,
                    statusText: response.statusText,
                    data: responseData
                });
            }
            catch (debugError) {
                console.error('Error in onDebug callback:', debugError);
            }
        }
        const data = responseData;
        const content = (_c = (_b = (_a = data.choices) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content;
        if (!content) {
            console.error('No content in response:', JSON.stringify(data, null, 2));
            throw new Error('No content received from OpenAI API. Response structure may be unexpected.');
        }
        console.log('Extracted content from API:', content.substring(0, 100) + '...');
        const trimmed = content.trim();
        console.log('Returning trimmed content, length:', trimmed.length);
        return trimmed;
    });
}
// Parse OpenAI response and create vectors
function parseAndCreateVectors(response, parentFrame) {
    try {
        // Try to extract JSON from the response (it might be wrapped in markdown code blocks)
        let jsonString = response.trim();
        if (jsonString.startsWith('```json')) {
            jsonString = jsonString.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        }
        else if (jsonString.startsWith('```')) {
            jsonString = jsonString.replace(/```\n?/g, '').trim();
        }
        const instructions = JSON.parse(jsonString);
        if (!Array.isArray(instructions)) {
            throw new Error('Response is not an array');
        }
        const targetParent = parentFrame || figma.currentPage;
        const createdNodes = [];
        for (const instruction of instructions) {
            // Normalize type to lowercase
            const normalizedType = (instruction.type || '').toLowerCase();
            console.log('Processing instruction:', instruction, 'Normalized type:', normalizedType);
            let node;
            switch (normalizedType) {
                case 'circle':
                    node = figma.createEllipse();
                    if (instruction.radius) {
                        node.resize(instruction.radius * 2, instruction.radius * 2);
                    }
                    else if (instruction.width && instruction.height) {
                        node.resize(instruction.width, instruction.height);
                    }
                    break;
                case 'ellipse':
                    node = figma.createEllipse();
                    if (instruction.width && instruction.height) {
                        node.resize(instruction.width, instruction.height);
                    }
                    break;
                case 'rectangle':
                    node = figma.createRectangle();
                    if (instruction.width && instruction.height) {
                        node.resize(instruction.width, instruction.height);
                    }
                    break;
                case 'vector':
                    node = figma.createVector();
                    if (instruction.data) {
                        node.vectorPaths = [{
                                windingRule: 'NONZERO',
                                data: instruction.data
                            }];
                    }
                    break;
                case 'line':
                    node = figma.createLine();
                    if (instruction.width) {
                        node.resize(instruction.width, 0);
                    }
                    break;
                case 'polygon':
                    node = figma.createPolygon();
                    if (instruction.pointCount) {
                        node.pointCount = instruction.pointCount;
                    }
                    if (instruction.width && instruction.height) {
                        node.resize(instruction.width, instruction.height);
                    }
                    break;
                case 'star':
                    node = figma.createStar();
                    if (instruction.pointCount) {
                        node.pointCount = instruction.pointCount;
                    }
                    if (instruction.innerRadius !== undefined) {
                        node.innerRadius = instruction.innerRadius;
                    }
                    if (instruction.width && instruction.height) {
                        node.resize(instruction.width, instruction.height);
                    }
                    break;
                case 'arrow':
                    // Arrows are created as lines with arrowheads
                    node = figma.createLine();
                    if (instruction.width) {
                        node.resize(instruction.width, 0);
                    }
                    // Note: Arrow endpoints would need to be set via vector paths
                    // For now, we'll create a line and the user can add arrowheads manually
                    break;
                default:
                    console.warn(`Unknown shape type: ${instruction.type} (normalized: ${normalizedType})`);
                    continue;
            }
            if (!node) {
                console.warn('Failed to create node for instruction:', instruction);
                continue;
            }
            // Set position
            node.x = instruction.x;
            node.y = instruction.y;
            // Normalize and set fills
            if (instruction.fills && instruction.fills.length > 0) {
                const normalizedFills = instruction.fills.map((fill) => {
                    // If fill is just {r, g, b}, wrap it in the proper structure
                    if (fill.r !== undefined && fill.g !== undefined && fill.b !== undefined && !fill.type) {
                        return {
                            type: 'SOLID',
                            color: {
                                r: fill.r,
                                g: fill.g,
                                b: fill.b
                            },
                            opacity: fill.opacity !== undefined ? fill.opacity : 1
                        };
                    }
                    // If it already has the correct structure, use it as is
                    return fill;
                });
                node.fills = normalizedFills;
                console.log('Set fills:', normalizedFills);
            }
            // Normalize and set strokes
            if (instruction.strokes && instruction.strokes.length > 0) {
                const normalizedStrokes = instruction.strokes.map((stroke) => {
                    // If stroke is just {r, g, b}, wrap it in the proper structure
                    if (stroke.r !== undefined && stroke.g !== undefined && stroke.b !== undefined && !stroke.type) {
                        return {
                            type: 'SOLID',
                            color: {
                                r: stroke.r,
                                g: stroke.g,
                                b: stroke.b
                            },
                            opacity: stroke.opacity !== undefined ? stroke.opacity : 1
                        };
                    }
                    // If it already has the correct structure, use it as is
                    return stroke;
                });
                node.strokes = normalizedStrokes;
                if (instruction.strokeWeight !== undefined) {
                    node.strokeWeight = instruction.strokeWeight;
                }
                console.log('Set strokes:', normalizedStrokes, 'weight:', instruction.strokeWeight);
            }
            targetParent.appendChild(node);
            createdNodes.push(node);
        }
        if (createdNodes.length > 0) {
            figma.currentPage.selection = createdNodes;
            figma.viewport.scrollAndZoomIntoView(createdNodes);
            figma.notify(`Created ${createdNodes.length} vector(s)`);
        }
        else {
            figma.notify('No vectors were created');
        }
    }
    catch (error) {
        console.error('Error parsing OpenAI response:', error);
        console.error('Response was:', response);
        figma.notify('Error parsing AI response. Check console for details.');
    }
}
// Load UI HTML
const uiHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: 'Inter', sans-serif;
      padding: 16px;
      margin: 0;
    }
    h2 {
      margin-top: 0;
      font-size: 14px;
      font-weight: 600;
    }
    label {
      display: block;
      margin-bottom: 8px;
      font-size: 12px;
      font-weight: 500;
    }
    input[type="text"], textarea {
      width: 100%;
      padding: 8px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      font-size: 12px;
      box-sizing: border-box;
      margin-bottom: 12px;
    }
    textarea {
      min-height: 60px;
      resize: vertical;
    }
    .description-box {
      background: #f8f8f8;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      padding: 12px;
      margin-bottom: 16px;
      min-height: 60px;
      font-size: 12px;
      line-height: 1.5;
      color: #333;
    }
    .description-box.loading {
      color: #666;
      font-style: italic;
    }
    .description-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .description-header h3 {
      margin: 0;
      font-size: 12px;
      font-weight: 600;
    }
    .button-group {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }
    button {
      flex: 1;
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    button.primary {
      background: #18a0fb;
      color: white;
    }
    button.primary:hover:not(:disabled) {
      background: #1592e6;
    }
    button.secondary {
      background: #f0f0f0;
      color: #333;
    }
    button.secondary:hover:not(:disabled) {
      background: #e0e0e0;
    }
    button.refresh {
      background: #fff;
      color: #18a0fb;
      border: 1px solid #18a0fb;
      flex: 0 0 auto;
      padding: 6px 12px;
    }
    button.refresh:hover:not(:disabled) {
      background: #f0f8ff;
    }
    .api-key-section {
      margin-bottom: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid #e0e0e0;
    }
    .api-key-section input {
      font-family: monospace;
      font-size: 11px;
    }
    .info {
      font-size: 11px;
      color: #666;
      margin-top: 4px;
    }
    select {
      width: 100%;
      padding: 8px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      font-size: 12px;
      box-sizing: border-box;
      margin-bottom: 12px;
      background: white;
      cursor: pointer;
    }
    select:focus {
      outline: none;
      border-color: #18a0fb;
    }
    .frame-section {
      margin-bottom: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid #e0e0e0;
    }
    .debug-section {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid #e0e0e0;
    }
    .debug-toggle {
      display: flex;
      align-items: center;
      cursor: pointer;
      user-select: none;
      margin-bottom: 8px;
    }
    .debug-toggle h3 {
      margin: 0;
      font-size: 12px;
      font-weight: 600;
      flex: 1;
    }
    .debug-toggle::before {
      content: '▼';
      margin-right: 8px;
      font-size: 10px;
      transition: transform 0.2s;
    }
    .debug-toggle.collapsed::before {
      transform: rotate(-90deg);
    }
    .debug-content {
      display: block;
      max-height: 300px;
      overflow-y: auto;
    }
    .debug-content.collapsed {
      display: none;
    }
    .debug-box {
      background: #f8f8f8;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      padding: 12px;
      margin-bottom: 12px;
      font-size: 11px;
      font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
      white-space: pre-wrap;
      word-wrap: break-word;
      max-height: 200px;
      overflow-y: auto;
    }
    .debug-label {
      font-weight: 600;
      margin-bottom: 4px;
      color: #333;
    }
    .debug-box.error {
      background: #fff5f5;
      border-color: #ff6b6b;
    }
    .debug-box.success {
      background: #f0fff4;
      border-color: #51cf66;
    }
  </style>
</head>
<body>
  <div class="api-key-section">
    <label for="apiKey">OpenAI API Key:</label>
    <input type="text" id="apiKey" placeholder="sk-..." />
    <div class="info">Your API key is stored locally and never shared.</div>
  </div>
  
  <div class="frame-section">
    <label for="frameSelect">Select Frame:</label>
    <select id="frameSelect">
      <option value="">Loading frames...</option>
    </select>
    <div class="info">Choose which frame to analyze and add vectors to.</div>
  </div>
  
  <div class="description-section">
    <div class="description-header">
      <h3>Current Vector Description</h3>
      <button class="refresh" id="refresh">Refresh</button>
    </div>
    <div class="description-box" id="description">Loading description...</div>
  </div>
  
  <h2>Design Prompt</h2>
  <label for="prompt">What should be added to complete the design?</label>
  <textarea id="prompt" placeholder="e.g., draw a smiley face, add two eyes and a mouth"></textarea>
  
  <div class="button-group">
    <button class="primary" id="generate">Generate</button>
    <button class="secondary" id="cancel">Cancel</button>
  </div>

  <div class="debug-section">
    <div class="debug-toggle collapsed" id="debugToggle">
      <h3>API Debug (Request/Response)</h3>
    </div>
    <div class="debug-content collapsed" id="debugContent">
      <div class="debug-label">Request:</div>
      <div class="debug-box" id="debugRequest">No API calls yet</div>
      <div class="debug-label">Response:</div>
      <div class="debug-box" id="debugResponse">No API calls yet</div>
    </div>
  </div>

  <script>
    // Load saved API key
    parent.postMessage({ pluginMessage: { type: 'load-api-key' } }, '*');

    // Ensure buttons are enabled by default
    const refreshBtn = document.getElementById('refresh');
    const generateBtn = document.getElementById('generate');
    if (refreshBtn) refreshBtn.disabled = false;
    if (generateBtn) generateBtn.disabled = false;

    // Listen for messages from plugin
    window.onmessage = (event) => {
      const msg = event.data.pluginMessage;
      if (!msg) {
        console.log('No pluginMessage in event:', event.data);
        return;
      }

      console.log('Received message type:', msg.type, 'Full message:', msg);

      if (msg.type === 'api-key-loaded') {
        const apiKeyInput = document.getElementById('apiKey');
        if (apiKeyInput && msg.apiKey) {
          apiKeyInput.value = msg.apiKey;
        }
      } else if (msg.type === 'description-updated') {
        console.log('Processing description-updated message, description:', msg.description);
        const descriptionBox = document.getElementById('description');
        console.log('Description box element:', descriptionBox);
        if (descriptionBox) {
          descriptionBox.textContent = msg.description || 'No description provided';
          descriptionBox.classList.remove('loading');
          console.log('Description box updated successfully');
        } else {
          console.error('Description box element not found!');
        }
        // Enable buttons
        const refreshBtn = document.getElementById('refresh');
        const generateBtn = document.getElementById('generate');
        if (refreshBtn) {
          refreshBtn.disabled = false;
          console.log('Refresh button enabled');
        } else {
          console.error('Refresh button not found!');
        }
        if (generateBtn) {
          generateBtn.disabled = false;
          console.log('Generate button enabled');
        } else {
          console.error('Generate button not found!');
        }
      } else if (msg.type === 'description-loading') {
        console.log('Processing description-loading message');
        const descriptionBox = document.getElementById('description');
        if (descriptionBox) {
          descriptionBox.textContent = 'Generating description...';
          descriptionBox.classList.add('loading');
        }
        // Disable buttons while loading
        const refreshBtn = document.getElementById('refresh');
        const generateBtn = document.getElementById('generate');
        if (refreshBtn) refreshBtn.disabled = true;
        if (generateBtn) generateBtn.disabled = true;
        console.log('Buttons disabled during description loading');
      } else if (msg.type === 'frames-loaded') {
        const frameSelect = document.getElementById('frameSelect');
        if (frameSelect && msg.frames) {
          frameSelect.innerHTML = '<option value="">-- Select a frame --</option>';
          msg.frames.forEach(frame => {
            const option = document.createElement('option');
            option.value = frame.id;
            option.textContent = \`\${frame.name} (\${frame.pageName})\`;
            frameSelect.appendChild(option);
          });
          
          // Select saved frame if available
          if (msg.selectedFrameId) {
            frameSelect.value = msg.selectedFrameId;
          }
        }
      } else if (msg.type === 'api-debug') {
        const requestBox = document.getElementById('debugRequest');
        const responseBox = document.getElementById('debugResponse');
        
        if (requestBox && msg.request) {
          requestBox.textContent = JSON.stringify(msg.request, null, 2);
          requestBox.className = 'debug-box';
        }
        
        if (responseBox && msg.response) {
          responseBox.textContent = JSON.stringify(msg.response, null, 2);
          if (msg.response.status && msg.response.status >= 200 && msg.response.status < 300) {
            responseBox.className = 'debug-box success';
          } else if (msg.response.status && msg.response.status >= 400) {
            responseBox.className = 'debug-box error';
          } else {
            responseBox.className = 'debug-box';
          }
        }
      }
    };

    // Toggle debug section
    document.getElementById('debugToggle').onclick = () => {
      const toggle = document.getElementById('debugToggle');
      const content = document.getElementById('debugContent');
      toggle.classList.toggle('collapsed');
      content.classList.toggle('collapsed');
    };

    // Handle frame selection change
    document.getElementById('frameSelect').addEventListener('change', (e) => {
      const frameSelect = e.target;
      parent.postMessage({ 
        pluginMessage: { 
          type: 'frame-selected',
          frameId: frameSelect.value || null
        } 
      }, '*');
    });

    document.getElementById('refresh').onclick = () => {
      const apiKeyInput = document.getElementById('apiKey');
      const frameSelect = document.getElementById('frameSelect');
      const apiKey = apiKeyInput.value.trim();
      const frameId = frameSelect.value || null;
      
      if (!apiKey) {
        alert('Please enter your OpenAI API key first');
        return;
      }
      
      if (!frameId) {
        alert('Please select a frame first');
        return;
      }
      
      parent.postMessage({ 
        pluginMessage: { 
          type: 'refresh-description',
          apiKey: apiKey,
          frameId: frameId
        } 
      }, '*');
    };

    document.getElementById('generate').onclick = () => {
      const apiKeyInput = document.getElementById('apiKey');
      const promptInput = document.getElementById('prompt');
      const frameSelect = document.getElementById('frameSelect');
      
      const apiKey = apiKeyInput.value.trim();
      const prompt = promptInput.value.trim();
      const frameId = frameSelect.value || null;
      
      if (!apiKey) {
        alert('Please enter your OpenAI API key');
        return;
      }
      
      if (!frameId) {
        alert('Please select a frame first');
        return;
      }
      
      if (!prompt) {
        alert('Please enter a design prompt');
        return;
      }
      
      parent.postMessage({ 
        pluginMessage: { 
          type: 'generate', 
          prompt: prompt,
          apiKey: apiKey,
          frameId: frameId
        } 
      }, '*');
    };

    document.getElementById('cancel').onclick = () => {
      parent.postMessage({ pluginMessage: { type: 'cancel' } }, '*');
    };

    // Save API key when it changes
    document.getElementById('apiKey').addEventListener('blur', () => {
      const apiKeyInput = document.getElementById('apiKey');
      parent.postMessage({ 
        pluginMessage: { 
          type: 'save-api-key', 
          apiKey: apiKeyInput.value.trim()
        } 
      }, '*');
    });
  </script>
</body>
</html>
`;
// Main execution
(() => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Show UI first
        figma.showUI(uiHtml, { width: 450, height: 700 });
        // Load all frames and send to UI
        const allFrames = yield getAllFrames();
        const savedFrameId = yield figma.clientStorage.getAsync('selected-frame-id');
        figma.ui.postMessage({
            type: 'frames-loaded',
            frames: allFrames,
            selectedFrameId: savedFrameId || null
        });
        // Load and send API key to UI
        const savedApiKey = yield figma.clientStorage.getAsync('openai-api-key');
        if (savedApiKey) {
            figma.ui.postMessage({ type: 'api-key-loaded', apiKey: savedApiKey });
        }
        // Store current state
        let currentDescription = 'Select a frame and click Refresh to generate description';
        let currentDomRep = null;
        let currentVectors = [];
        let currentFrame = null;
        let selectedFrameId = savedFrameId || null;
        // Load vectors for selected frame if available
        if (selectedFrameId) {
            const result = yield findVectorsOnFrame(selectedFrameId);
            currentVectors = result.vectors;
            currentFrame = result.frame;
            if (currentVectors.length > 0) {
                currentDomRep = getShapesDOMRepresentation(currentVectors, currentFrame);
            }
        }
        // Function to refresh description
        const refreshDescription = (apiKey, frameId) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                if (!frameId) {
                    figma.notify('Please select a frame first');
                    return;
                }
                figma.ui.postMessage({ type: 'description-loading' });
                // Re-find vectors in case they changed
                const result = yield findVectorsOnFrame(frameId);
                currentVectors = result.vectors;
                currentFrame = result.frame;
                if (currentVectors.length === 0) {
                    figma.ui.postMessage({
                        type: 'description-updated',
                        description: 'No vectors found in the selected frame.'
                    });
                    return;
                }
                currentDomRep = getShapesDOMRepresentation(currentVectors, currentFrame);
                // Generate new description with debug callback
                console.log('Generating semantic description...');
                try {
                    currentDescription = yield generateSemanticDescription(apiKey, currentDomRep, (request, response) => {
                        try {
                            // Sanitize data to ensure it's serializable
                            const sanitizedRequest = JSON.parse(JSON.stringify(request));
                            const sanitizedResponse = JSON.parse(JSON.stringify(response));
                            figma.ui.postMessage({
                                type: 'api-debug',
                                request: sanitizedRequest,
                                response: sanitizedResponse
                            });
                        }
                        catch (debugError) {
                            console.error('Error sending debug message:', debugError);
                            // Try sending a simplified version
                            try {
                                const req = request;
                                const res = response;
                                figma.ui.postMessage({
                                    type: 'api-debug',
                                    request: { url: req.url || '', method: req.method || '' },
                                    response: { status: res.status || 0, statusText: res.statusText || '' }
                                });
                            }
                            catch (fallbackError) {
                                console.error('Error sending fallback debug message:', fallbackError);
                            }
                        }
                    });
                    console.log('Description generated:', currentDescription);
                    if (!currentDescription || currentDescription.trim() === '') {
                        console.warn('Empty description received from API');
                        try {
                            figma.ui.postMessage({
                                type: 'description-updated',
                                description: 'Received empty description from API. Please try again.'
                            });
                        }
                        catch (msgError) {
                            console.error('Error sending empty description message:', msgError);
                        }
                        return;
                    }
                    console.log('Sending description-updated message to UI, description length:', currentDescription.length);
                    try {
                        figma.ui.postMessage({
                            type: 'description-updated',
                            description: currentDescription
                        });
                        console.log('Message sent to UI successfully');
                    }
                    catch (msgError) {
                        console.error('Error sending description-updated message:', msgError);
                        throw msgError;
                    }
                }
                catch (genError) {
                    console.error('Error in generateSemanticDescription:', genError);
                    throw genError;
                }
            }
            catch (error) {
                console.error('Error refreshing description:', error);
                console.error('Error details:', error instanceof Error ? error.stack : error);
                figma.notify(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
                figma.ui.postMessage({
                    type: 'description-updated',
                    description: `Error generating description: ${error instanceof Error ? error.message : 'Unknown error'}. Please check the console and try again.`
                });
            }
        });
        // Generate initial description if API key and frame are available
        if (savedApiKey && selectedFrameId) {
            yield refreshDescription(savedApiKey, selectedFrameId);
        }
        figma.ui.onmessage = (msg) => __awaiter(void 0, void 0, void 0, function* () {
            if (msg.type === 'cancel') {
                // Don't close plugin, just return
                return;
            }
            if (msg.type === 'save-api-key' && msg.apiKey) {
                yield figma.clientStorage.setAsync('openai-api-key', msg.apiKey);
                return;
            }
            if (msg.type === 'load-api-key') {
                const apiKey = yield figma.clientStorage.getAsync('openai-api-key');
                figma.ui.postMessage({ type: 'api-key-loaded', apiKey: apiKey || '' });
                return;
            }
            if (msg.type === 'frame-selected') {
                selectedFrameId = msg.frameId || null;
                yield figma.clientStorage.setAsync('selected-frame-id', selectedFrameId || '');
                // Update vectors for the selected frame
                if (selectedFrameId) {
                    const result = yield findVectorsOnFrame(selectedFrameId);
                    currentVectors = result.vectors;
                    currentFrame = result.frame;
                    if (currentVectors.length > 0) {
                        currentDomRep = getShapesDOMRepresentation(currentVectors, currentFrame);
                        // Auto-refresh description if API key is available
                        const apiKey = yield figma.clientStorage.getAsync('openai-api-key');
                        if (apiKey) {
                            yield refreshDescription(apiKey, selectedFrameId);
                        }
                        else {
                            figma.ui.postMessage({
                                type: 'description-updated',
                                description: `Found ${currentVectors.length} vector(s). Enter API key and click Refresh to generate description.`
                            });
                        }
                    }
                    else {
                        figma.ui.postMessage({
                            type: 'description-updated',
                            description: 'No vectors found in the selected frame.'
                        });
                    }
                }
                return;
            }
            if (msg.type === 'refresh-description' && msg.apiKey && msg.frameId) {
                yield refreshDescription(msg.apiKey, msg.frameId);
                return;
            }
            if (msg.type === 'generate' && msg.prompt && msg.apiKey && msg.frameId) {
                try {
                    // Save API key and frame ID
                    yield figma.clientStorage.setAsync('openai-api-key', msg.apiKey);
                    yield figma.clientStorage.setAsync('selected-frame-id', msg.frameId);
                    figma.notify('Generating design with AI...');
                    // Re-find vectors to get latest state
                    const result = yield findVectorsOnFrame(msg.frameId);
                    currentVectors = result.vectors;
                    currentFrame = result.frame;
                    if (currentVectors.length === 0) {
                        figma.notify('No vectors found in the selected frame.');
                        return;
                    }
                    currentDomRep = getShapesDOMRepresentation(currentVectors, currentFrame);
                    const latestVectorDescriptions = currentVectors.map(describeShape).join('\n');
                    // Build the completion prompt with both description and DOM representation
                    const domString = JSON.stringify(currentDomRep, null, 2);
                    const completionPrompt = prompts.completionPrompt
                        .replace('{userPrompt}', msg.prompt)
                        .replace('{vectorDescription}', currentDescription || latestVectorDescriptions)
                        .replace('{domRepresentation}', domString);
                    console.log('Completion prompt:', completionPrompt);
                    // Call OpenAI API with debug callback
                    const response = yield callOpenAI(msg.apiKey, prompts.systemPrompt, completionPrompt, (request, response) => {
                        try {
                            // Sanitize data to ensure it's serializable
                            const sanitizedRequest = JSON.parse(JSON.stringify(request));
                            const sanitizedResponse = JSON.parse(JSON.stringify(response));
                            figma.ui.postMessage({
                                type: 'api-debug',
                                request: sanitizedRequest,
                                response: sanitizedResponse
                            });
                        }
                        catch (debugError) {
                            console.error('Error sending debug message:', debugError);
                            // Try sending a simplified version
                            try {
                                const req = request;
                                const res = response;
                                figma.ui.postMessage({
                                    type: 'api-debug',
                                    request: { url: req.url || '', method: req.method || '' },
                                    response: { status: res.status || 0, statusText: res.statusText || '' }
                                });
                            }
                            catch (fallbackError) {
                                console.error('Error sending fallback debug message:', fallbackError);
                            }
                        }
                    });
                    console.log('OpenAI response:', response);
                    // Use the selected frame
                    const parentFrame = currentFrame || undefined;
                    // Parse and create vectors
                    parseAndCreateVectors(response, parentFrame);
                    figma.notify('Design generation complete!');
                    // Don't close plugin - keep it open for further use
                }
                catch (error) {
                    console.error('Error generating design:', error);
                    figma.notify(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
        });
    }
    catch (error) {
        console.error('Error initializing plugin:', error);
        figma.notify(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Don't close plugin on initialization error - let user see the error
    }
}))();
