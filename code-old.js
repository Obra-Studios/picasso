"use strict";
// Picasso - AI Native Design Plugin
// Prompt by Action: Match style from context frame to canvas frame using LLM
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
figma.showUI(__html__, { width: 400, height: 600 });
let contextFrameId = null;
let canvasFrameId = null;
let apiKey = null;
let isProcessing = false;
// Track recently changed elements to avoid duplicate processing
const recentlyProcessed = new Set();
// Track previous canvas frame state to detect changes
let previousCanvasHash = null;
// Load saved data from clientStorage and send to UI
(() => __awaiter(void 0, void 0, void 0, function* () {
    // Load API key
    const savedApiKey = yield figma.clientStorage.getAsync('openai_api_key');
    if (savedApiKey) {
        apiKey = savedApiKey;
        figma.ui.postMessage({
            type: 'api-key-loaded',
            apiKey: apiKey,
        });
    }
    // Load context frame
    const savedContextFrameId = yield figma.clientStorage.getAsync('context_frame_id');
    if (savedContextFrameId) {
        try {
            const frame = yield figma.getNodeByIdAsync(savedContextFrameId);
            if (frame && frame.type === 'FRAME') {
                contextFrameId = frame.id;
                figma.ui.postMessage({
                    type: 'context-selected',
                    frameId: contextFrameId,
                    frameName: frame.name,
                });
                // Generate context description on startup if API key is available
                if (apiKey) {
                    yield generateAndStoreContextDescription(frame, apiKey);
                }
            }
        }
        catch (e) {
            console.log('Could not load context frame:', e);
            // Frame might have been deleted, clear it from storage
            yield figma.clientStorage.deleteAsync('context_frame_id');
        }
    }
    // Load canvas frame
    const savedCanvasFrameId = yield figma.clientStorage.getAsync('canvas_frame_id');
    if (savedCanvasFrameId) {
        try {
            const frame = yield figma.getNodeByIdAsync(savedCanvasFrameId);
            if (frame && frame.type === 'FRAME') {
                canvasFrameId = frame.id;
                // Initialize canvas hash for change detection
                previousCanvasHash = yield getFrameHash(frame);
                figma.ui.postMessage({
                    type: 'canvas-selected',
                    frameId: canvasFrameId,
                    frameName: frame.name,
                });
            }
        }
        catch (e) {
            console.log('Could not load canvas frame:', e);
            // Frame might have been deleted, clear it from storage
            yield figma.clientStorage.deleteAsync('canvas_frame_id');
        }
    }
}))();
// Serialize a Figma node to a text description for LLM
function serializeNodeToText(node_1) {
    return __awaiter(this, arguments, void 0, function* (node, depth = 0) {
        const indent = '  '.repeat(depth);
        let description = '';
        // Load fonts if needed
        if (node.type === 'TEXT') {
            const textNode = node;
            if (textNode.fontName !== figma.mixed) {
                try {
                    yield figma.loadFontAsync(textNode.fontName);
                }
                catch (e) {
                    // Font loading failed, continue
                }
            }
        }
        // Node type and name
        description += `${indent}${node.type}: "${node.name}"\n`;
        // Position and size
        description += `${indent}  position: (${Math.round(node.x)}, ${Math.round(node.y)})\n`;
        description += `${indent}  size: ${Math.round(node.width)} × ${Math.round(node.height)}\n`;
        // Visibility
        if (!node.visible) {
            description += `${indent}  visible: false\n`;
        }
        // Fills (colors, gradients, etc.)
        if ('fills' in node && node.fills !== figma.mixed && node.fills.length > 0) {
            description += `${indent}  fills:\n`;
            node.fills.forEach((fill) => {
                if (fill.type === 'SOLID' && fill.color) {
                    const r = Math.round(fill.color.r * 255);
                    const g = Math.round(fill.color.g * 255);
                    const b = Math.round(fill.color.b * 255);
                    const opacity = fill.opacity !== undefined ? fill.opacity : 1;
                    description += `${indent}    - solid color: rgb(${r}, ${g}, ${b}) opacity: ${opacity}\n`;
                }
                else if (fill.type === 'GRADIENT_LINEAR') {
                    description += `${indent}    - linear gradient\n`;
                }
                else if (fill.type === 'GRADIENT_RADIAL') {
                    description += `${indent}    - radial gradient\n`;
                }
            });
        }
        // Strokes
        if ('strokes' in node && Array.isArray(node.strokes) && node.strokes.length > 0) {
            description += `${indent}  strokes:\n`;
            node.strokes.forEach((stroke) => {
                if (stroke.type === 'SOLID' && stroke.color) {
                    const r = Math.round(stroke.color.r * 255);
                    const g = Math.round(stroke.color.g * 255);
                    const b = Math.round(stroke.color.b * 255);
                    description += `${indent}    - solid color: rgb(${r}, ${g}, ${b})\n`;
                }
            });
            if ('strokeWeight' in node && typeof node.strokeWeight === 'number') {
                description += `${indent}  strokeWeight: ${node.strokeWeight}\n`;
            }
        }
        // Corner radius
        if ('cornerRadius' in node && typeof node.cornerRadius === 'number') {
            description += `${indent}  cornerRadius: ${node.cornerRadius}\n`;
        }
        // Effects (shadows, blurs)
        if ('effects' in node && node.effects.length > 0) {
            description += `${indent}  effects:\n`;
            node.effects.forEach((effect) => {
                if (effect.type === 'DROP_SHADOW') {
                    description += `${indent}    - drop shadow: offset (${effect.offset.x}, ${effect.offset.y}), radius: ${effect.radius}, color: rgb(${Math.round(effect.color.r * 255)}, ${Math.round(effect.color.g * 255)}, ${Math.round(effect.color.b * 255)}), opacity: ${effect.color.a}\n`;
                }
                else if (effect.type === 'INNER_SHADOW') {
                    description += `${indent}    - inner shadow\n`;
                }
                else if (effect.type === 'LAYER_BLUR') {
                    description += `${indent}    - layer blur: ${effect.radius}\n`;
                }
                else if (effect.type === 'BACKGROUND_BLUR') {
                    description += `${indent}    - background blur: ${effect.radius}\n`;
                }
            });
        }
        // Typography (for text nodes)
        if (node.type === 'TEXT') {
            const textNode = node;
            try {
                if (textNode.fontName !== figma.mixed) {
                    description += `${indent}  font: ${textNode.fontName.family} ${textNode.fontName.style}\n`;
                }
                if (textNode.fontSize !== figma.mixed) {
                    description += `${indent}  fontSize: ${textNode.fontSize}\n`;
                }
                if (textNode.lineHeight !== figma.mixed) {
                    if (typeof textNode.lineHeight === 'object' && textNode.lineHeight.unit === 'PIXELS') {
                        description += `${indent}  lineHeight: ${textNode.lineHeight.value}px\n`;
                    }
                    else if (typeof textNode.lineHeight === 'number') {
                        description += `${indent}  lineHeight: ${textNode.lineHeight}px\n`;
                    }
                }
                if (textNode.letterSpacing !== figma.mixed) {
                    if (typeof textNode.letterSpacing === 'object') {
                        description += `${indent}  letterSpacing: ${textNode.letterSpacing.value}${textNode.letterSpacing.unit === 'PIXELS' ? 'px' : '%'}\n`;
                    }
                }
                if (textNode.textAlignHorizontal !== 'LEFT') {
                    description += `${indent}  textAlign: ${textNode.textAlignHorizontal}\n`;
                }
                description += `${indent}  text: "${textNode.characters.substring(0, 100)}${textNode.characters.length > 100 ? '...' : ''}"\n`;
            }
            catch (e) {
                description += `${indent}  text: (could not read text)\n`;
            }
        }
        // Layout properties (for frames)
        if (node.type === 'FRAME') {
            const frame = node;
            description += `${indent}  layoutMode: ${frame.layoutMode || 'NONE'}\n`;
            if (frame.paddingLeft !== undefined) {
                description += `${indent}  padding: ${frame.paddingLeft}px\n`;
            }
            if (frame.itemSpacing !== undefined) {
                description += `${indent}  itemSpacing: ${frame.itemSpacing}px\n`;
            }
        }
        // Opacity
        if ('opacity' in node && node.opacity !== undefined && node.opacity !== 1) {
            description += `${indent}  opacity: ${node.opacity}\n`;
        }
        // Children
        if ('children' in node && node.children.length > 0) {
            description += `${indent}  children:\n`;
            for (const child of node.children) {
                description += yield serializeNodeToText(child, depth + 1);
            }
        }
        return description;
    });
}
// Serialize a Figma node to JSON for LLM
function serializeNodeToJSON(node) {
    // Positions are already relative to the frame (absolute in frame coordinates)
    const json = {
        type: node.type,
        name: node.name,
        x: Math.round(node.x), // Position relative to frame
        y: Math.round(node.y), // Position relative to frame
        width: Math.round(node.width),
        height: Math.round(node.height),
        visible: node.visible,
    };
    // Include parent info if available
    if (node.parent && 'name' in node.parent) {
        json.parentName = node.parent.name;
        if ('x' in node.parent && 'y' in node.parent) {
            json.parentX = Math.round(node.parent.x);
            json.parentY = Math.round(node.parent.y);
        }
    }
    // Rotation
    if ('rotation' in node && typeof node.rotation === 'number') {
        json.rotation = node.rotation;
    }
    // Fills
    if ('fills' in node && node.fills !== figma.mixed && node.fills.length > 0) {
        json.fills = node.fills.map((fill) => {
            if (fill.type === 'SOLID' && fill.color) {
                return {
                    type: 'SOLID',
                    color: {
                        r: fill.color.r,
                        g: fill.color.g,
                        b: fill.color.b,
                    },
                    opacity: fill.opacity !== undefined ? fill.opacity : 1,
                };
            }
            return { type: fill.type };
        });
    }
    // Strokes
    if ('strokes' in node && Array.isArray(node.strokes) && node.strokes.length > 0) {
        json.strokes = node.strokes.map((stroke) => {
            if (stroke.type === 'SOLID' && stroke.color) {
                return {
                    type: 'SOLID',
                    color: {
                        r: stroke.color.r,
                        g: stroke.color.g,
                        b: stroke.color.b,
                    },
                };
            }
            return { type: stroke.type };
        });
        if ('strokeWeight' in node && typeof node.strokeWeight === 'number') {
            json.strokeWeight = node.strokeWeight;
        }
    }
    // Corner radius
    if ('cornerRadius' in node && typeof node.cornerRadius === 'number') {
        json.cornerRadius = node.cornerRadius;
    }
    // Effects
    if ('effects' in node && node.effects.length > 0) {
        json.effects = node.effects.map((effect) => {
            if (effect.type === 'DROP_SHADOW') {
                return {
                    type: 'DROP_SHADOW',
                    offset: { x: effect.offset.x, y: effect.offset.y },
                    radius: effect.radius,
                    color: {
                        r: effect.color.r,
                        g: effect.color.g,
                        b: effect.color.b,
                        a: effect.color.a,
                    },
                };
            }
            return {
                type: effect.type,
                radius: 'radius' in effect ? effect.radius : undefined,
            };
        });
    }
    // Typography (for text nodes)
    if (node.type === 'TEXT') {
        const textNode = node;
        try {
            if (textNode.fontName !== figma.mixed) {
                json.font = {
                    family: textNode.fontName.family,
                    style: textNode.fontName.style,
                };
            }
            if (textNode.fontSize !== figma.mixed) {
                json.fontSize = textNode.fontSize;
            }
            if (textNode.lineHeight !== figma.mixed) {
                if (typeof textNode.lineHeight === 'object' && textNode.lineHeight.unit === 'PIXELS') {
                    json.lineHeight = { value: textNode.lineHeight.value, unit: 'PIXELS' };
                }
                else if (typeof textNode.lineHeight === 'number') {
                    json.lineHeight = { value: textNode.lineHeight, unit: 'PIXELS' };
                }
            }
            if (textNode.letterSpacing !== figma.mixed) {
                if (typeof textNode.letterSpacing === 'object') {
                    json.letterSpacing = {
                        value: textNode.letterSpacing.value,
                        unit: textNode.letterSpacing.unit,
                    };
                }
            }
            if (textNode.textAlignHorizontal !== 'LEFT') {
                json.textAlignHorizontal = textNode.textAlignHorizontal;
            }
            json.text = textNode.characters.substring(0, 200);
        }
        catch (e) {
            json.text = '(could not read)';
        }
    }
    // Opacity
    if ('opacity' in node && node.opacity !== undefined && node.opacity !== 1) {
        json.opacity = node.opacity;
    }
    // Children
    if ('children' in node && node.children.length > 0) {
        json.children = node.children.map((child) => serializeNodeToJSON(child));
    }
    return json;
}
// Generate a more robust hash of frame content to detect changes
function getFrameHash(frame) {
    return __awaiter(this, void 0, void 0, function* () {
        const json = serializeNodeToJSON(frame);
        const jsonString = JSON.stringify(json);
        // Create a more robust hash that includes:
        // - Number of children
        // - Frame dimensions
        // - A hash of the JSON content (using a simple hash function)
        let hash = 0;
        for (let i = 0; i < jsonString.length; i++) {
            const char = jsonString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return `${frame.children.length}_${Math.round(frame.width)}_${Math.round(frame.height)}_${hash}`;
    });
}
// Generate and store context description (with caching)
function generateAndStoreContextDescription(frame, apiKey) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Check if we have a cached description
            const cachedHash = yield figma.clientStorage.getAsync('context_frame_hash');
            const cachedDescription = yield figma.clientStorage.getAsync('context_description');
            const currentHash = yield getFrameHash(frame);
            // If frame hasn't changed and we have a cached description, use it
            if (cachedHash === currentHash && cachedDescription) {
                console.log('Using cached context description');
                figma.ui.postMessage({
                    type: 'style-description-generated',
                    styleDescription: cachedDescription,
                });
                return;
            }
            // Show processing status in context description box
            figma.ui.postMessage({
                type: 'processing',
                message: 'Analyzing context frame...',
            });
            // Generate new description
            const contextDescription = yield serializeNodeToText(frame);
            const styleDescription = yield generateStyleDescription(contextDescription, frame, apiKey);
            // Store the description and hash
            yield figma.clientStorage.setAsync('context_frame_hash', currentHash);
            yield figma.clientStorage.setAsync('context_description', styleDescription);
            // Send to UI
            figma.ui.postMessage({
                type: 'style-description-generated',
                styleDescription: styleDescription,
            });
            console.log('Generated and stored context description');
        }
        catch (e) {
            console.log('Error generating context description:', e);
            figma.notify('Could not generate context description');
        }
    });
}
// Export a frame as a base64 image
function exportFrameAsImage(frame) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Export the frame as PNG
            const imageBytes = yield frame.exportAsync({
                format: 'PNG',
                constraint: { type: 'SCALE', value: 2 }, // 2x scale for better quality
            });
            // Convert Uint8Array to base64
            // Use a simple base64 encoding function since btoa might not be available
            const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
            let result = '';
            let i = 0;
            const bytes = new Uint8Array(imageBytes);
            while (i < bytes.length) {
                const a = bytes[i++];
                const b = i < bytes.length ? bytes[i++] : 0;
                const c = i < bytes.length ? bytes[i++] : 0;
                const bitmap = (a << 16) | (b << 8) | c;
                result += base64Chars.charAt((bitmap >> 18) & 63);
                result += base64Chars.charAt((bitmap >> 12) & 63);
                result += i - 2 < bytes.length ? base64Chars.charAt((bitmap >> 6) & 63) : '=';
                result += i - 1 < bytes.length ? base64Chars.charAt(bitmap & 63) : '=';
            }
            return result;
        }
        catch (e) {
            console.log('Error exporting frame as image:', e);
            return '';
        }
    });
}
// Step 1: Generate style description from context frame
function generateStyleDescription(contextDescription, contextFrame, apiKey) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        // Export context frame as image
        const contextImageBase64 = yield exportFrameAsImage(contextFrame);
        const prompt = `Analyze this Figma design frame. First, identify WHAT the design represents (e.g., "a smiley face", "a button with text", "a card layout", "a navigation bar"). Then describe the visual style.

CONTEXT FRAME (text description):
${contextDescription}

Provide a description in two parts:

1. COMPOSITION & MEANING: What does this design represent? What are the elements and how do they work together? For example:
   - "A smiley face made of a circle with two smaller circles for eyes and a curved line for a mouth"
   - "A button with centered text and rounded corners"
   - "A card containing an image, title, and description text"
   - "A navigation bar with multiple menu items"
   - There may color palettes, inspiration images, or other elements that inform the context.

There may be multiple groups of elements on the frame that represent different things. If things are not grouped, they are probably different assets and are not related to each other.

2. VISUAL STYLE: Describe the visual appearance:
   - Colors: Main colors used (RGB values)
   - Typography: Font families, sizes, weights if text exists
   - Corners: Corner radius values
   - Effects: Shadows, blurs, gradients
   - Overall aesthetic: Brief description (e.g., "minimalist", "bold", "soft")

Be specific about what the elements represent and how they compose into a recognizable design. Keep it concise and factual.`;
        // Build messages with image
        const messages = [
            {
                role: 'system',
                content: 'You are a design expert. Provide concise, factual style descriptions.',
            },
        ];
        // Add user message with image if available
        if (contextImageBase64) {
            messages.push({
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: prompt,
                    },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/png;base64,${contextImageBase64}`,
                        },
                    },
                ],
            });
        }
        else {
            messages.push({
                role: 'user',
                content: prompt,
            });
        }
        const response = yield fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini', // gpt-4o-mini supports vision
                messages: messages,
                temperature: 0.3,
                max_tokens: 800,
            }),
        });
        if (!response.ok) {
            const error = yield response.json();
            throw new Error(((_a = error.error) === null || _a === void 0 ? void 0 : _a.message) || 'LLM API error');
        }
        const data = yield response.json();
        return ((_c = (_b = data.choices[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) || 'No response from LLM';
    });
}
// Serialize canvas elements with unique keys for LLM reference
// Step 1: Identify user intent from an action (returns intent and autocomplete suggestions)
function identifyIntent(changedElement, contextFrame, canvasFrame, contextDescription, apiKey) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        console.log(`Identifying intent for ${changedElement.type} element`);
        // Serialize the changed element
        const changedElementJSON = serializeNodeToJSON(changedElement);
        const contextJSON = serializeNodeToJSON(contextFrame);
        const canvasJSON = serializeNodeToJSON(canvasFrame);
        // Get parent info
        const parent = changedElement.parent;
        let parentInfo = null;
        if (parent && 'x' in parent && 'y' in parent) {
            parentInfo = {
                type: parent.type,
                name: parent.name,
                x: Math.round(parent.x),
                y: Math.round(parent.y),
                width: 'width' in parent ? Math.round(parent.width) : undefined,
                height: 'height' in parent ? Math.round(parent.height) : undefined,
            };
        }
        else if (parent) {
            parentInfo = {
                type: parent.type,
                name: parent.name,
            };
        }
        // Export canvas frame as image
        const canvasImageBase64 = yield exportFrameAsImage(canvasFrame);
        const contextDescText = contextDescription
            ? `\n\nCONTEXT DESCRIPTION (what the context frame represents):\n${contextDescription}`
            : '';
        const prompt = `A user just created or modified an element in their Figma canvas. Identify their intent by comparing it to the context frame.

CHANGED ELEMENT (what the user just created/modified):
${JSON.stringify(changedElementJSON, null, 2)}

Parent: ${parentInfo ? JSON.stringify(parentInfo, null, 2) : 'Root'}

CONTEXT FRAME (reference design - JSON):
${contextJSON}${contextDescText}

CANVAS FRAME (current state - JSON):
${canvasJSON}

Your task: 
1. Look at the changed element and compare it to elements in the CONTEXT FRAME
2. Use the CONTEXT DESCRIPTION to understand what the context frame represents
3. Identify if the user is trying to recreate or match something from the context frame
4. If there's a similar element or pattern in the context, describe the intent in relation to that specific element/pattern from the context
5. If no clear match, describe what they're trying to create based on the element type and position

Focus on relating the user's action to elements in the context frame when possible. Use the context description to understand the semantic meaning of what's in the context. Compare the canvas frame structure to the context frame structure to identify what's missing.

After identifying the intent, provide an AUTOCOMPLETE suggestion:
- If the design is complete or the user is just modifying existing elements, suggest "No changes needed"
- If the user is in the process of creating something, look at the CONTEXT FRAME and CONTEXT DESCRIPTION to see what elements are missing. Suggest adding the specific elements that exist in the context frame but are missing from the canvas, matching the exact structure and composition from the context.
- Assume that the user is drawing a higher-level element. For example, they might be drawing the background of a card or the outline of a button. Then, suggest adding the missing children.
- CRITICAL - BE SPECIFIC: Be as specific as possible in your suggestion. You must output: the exact type of element, including shape, color, size, rotation, and position. These styles (namely color and position) are very important. They must match the context frame exactly.

Return a JSON object with two keys:
{
  "intent": "brief description of the intent (1-4 sentences)",
  "autocomplete": "suggestion for what to add or modify next, or 'No changes needed' if complete"
}

Return ONLY valid JSON, no other text.`;
        // Build messages with image
        const messages = [
            {
                role: 'system',
                content: 'You are a design assistant that identifies user intent and suggests autocomplete actions. Return only valid JSON.',
            },
        ];
        // Add user message with image if available
        if (canvasImageBase64) {
            messages.push({
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: prompt,
                    },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/png;base64,${canvasImageBase64}`,
                        },
                    },
                ],
            });
        }
        else {
            messages.push({
                role: 'user',
                content: prompt,
            });
        }
        const response = yield fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini', // gpt-4o-mini supports vision
                messages: messages,
                temperature: 0.3,
                max_tokens: 400,
                response_format: { type: 'json_object' },
            }),
        });
        if (!response.ok) {
            const error = yield response.json();
            throw new Error(((_a = error.error) === null || _a === void 0 ? void 0 : _a.message) || 'LLM API error');
        }
        const data = yield response.json();
        const content = ((_c = (_b = data.choices[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) || '{}';
        try {
            const parsed = JSON.parse(content);
            const intent = parsed.intent || 'Unknown intent';
            const autocomplete = parsed.autocomplete || 'No changes needed';
            console.log('Identified intent:', intent);
            console.log('Autocomplete suggestion:', autocomplete);
            return { intent: intent.trim(), autocomplete: autocomplete.trim() };
        }
        catch (e) {
            // Fallback if JSON parsing fails
            console.log('Error parsing intent JSON, using fallback:', e);
            return {
                intent: content.trim() || 'Unknown intent',
                autocomplete: 'No changes needed'
            };
        }
    });
}
// Step 2: Generate modification instructions based on autocomplete suggestion
function generateModificationsFromAutocomplete(autocomplete, intent, changedElement, contextFrame, canvasFrame, contextDescription, apiKey) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        console.log(`Generating modifications from autocomplete: ${autocomplete}`);
        // Serialize the changed element and context
        const changedElementJSON = serializeNodeToJSON(changedElement);
        const contextJSON = serializeNodeToJSON(contextFrame);
        const canvasJSON = serializeNodeToJSON(canvasFrame);
        const contextDescText = contextDescription
            ? `\n\nCONTEXT DESCRIPTION (what the context frame represents):\n${contextDescription}`
            : '';
        const prompt = `Based on the autocomplete suggestion, generate instructions for elements to modify and elements to add to complete the design.

USER INTENT:
${intent}

CHANGED ELEMENT (what the user just created/modified):
${JSON.stringify(changedElementJSON, null, 2)}

CONTEXT FRAME (reference design - JSON):
${contextJSON}${contextDescText}

CANVAS FRAME (current state - JSON):
${canvasJSON}

AUTOCOMPLETE SUGGESTION:
${autocomplete}

CRITICAL PRIORITY ORDER: MODIFY EXISTING ELEMENTS FIRST - Always prefer modifying existing elements over adding new ones.

Your task:
1. Based on the autocomplete suggestion, determine what needs to be modified or added
2. If the autocomplete suggests "No changes needed", return empty arrays
3. STEP 1 - CHECK FOR EXISTING ELEMENTS TO MODIFY:
   - FIRST, examine the CANVAS FRAME JSON structure carefully
   - For each element in the context frame that should be in the canvas, check if a similar element already exists in the canvas
   - When comparing, look for elements with:
     * Same or similar element type (ELLIPSE, RECTANGLE, TEXT, POLYGON, STAR)
     * Similar position (within ~30 pixels of x, y coordinates)
     * Similar size (within ~30 pixels of width, height)
   - If you find a matching or similar element, you MUST modify it (add to "modify" array) rather than adding a new one
   - Only if NO similar element exists should you consider adding a new element
4. STEP 2 - STRICT DUPLICATION PREVENTION FOR ADDITIONS:
   - Before adding ANY element to the "add" array, you MUST verify it does NOT already exist
   - Search through ALL elements in the canvas frame JSON (including nested children at all levels)
   - Check element type, approximate position (within ~30 pixels), and approximate size (within ~30 pixels)
   - If ANY element matches these criteria, DO NOT add it - instead, modify the existing one
5. MODIFICATION PREFERENCE RULES:
   - If the context frame has an element and the canvas has a similar element (same type, similar position/size), ALWAYS modify the existing one
   - Only use "add" for elements that are genuinely absent from the canvas
6. If it suggests modifying elements, create modification instructions based on the context frame
7. If it suggests adding elements, create instructions for those elements based on the context frame
8. Remember: The canvas frame JSON shows ALL existing elements at all nesting levels. Use it exhaustively to prevent duplicates.

Return a JSON object with:
{
  "modify": [
    {
      "key": "canvas_X" (the key of the element to modify - you'll need to infer this from the changed element),
      "fills": array of fill objects (type "SOLID", color {r, g, b}, opacity),
      "strokes": array of stroke objects (optional),
      "strokeWeight": number (optional),
      "cornerRadius": number (optional),
      "effects": array of effect objects (optional),
      "font": object with family and style (for TEXT),
      "fontSize": number (for TEXT),
      "text": string (for TEXT),
      "opacity": number (optional),
      "rotation": number (rotation in degrees, optional)
    }
  ],
  "add": [
    {
      "type": element type (ELLIPSE, RECTANGLE, TEXT, POLYGON, STAR),
      "name": element name (optional),
      "x": absolute x position (number),
      "y": absolute y position (number),
      "width": width (number),
      "height": height (number),
      "fills": array of fill objects,
      "strokes": array of stroke objects (optional),
      "strokeWeight": number (optional),
      "cornerRadius": number (optional),
      "effects": array of effect objects (optional),
      "font": object with family and style (for TEXT, required),
      "fontSize": number (for TEXT),
      "text": string (for TEXT),
      "opacity": number (optional),
      "rotation": number (rotation in degrees, optional),
      "parentKey": canvas element key if this should be a child (optional)
    }
  ]
}

IMPORTANT RULES:
- Only include changes suggested by the autocomplete
- CRITICAL - MODIFY BEFORE ADD: Always check if an element exists before adding. If a similar element exists (same type, similar position/size), modify it instead of adding a new one.
- CRITICAL - NO DUPLICATES: You must prevent duplicates by exhaustively examining the CANVAS FRAME JSON. For every element you consider adding:
  * Search through ALL elements in the canvas frame at ALL nesting levels (including nested children, grandchildren, etc.)
  * Check if there's already an element of the same type at a similar position (within ~30 pixels)
  * Check if there's already an element with similar size (within ~30 pixels width/height)
  * If ANY matching element exists, DO NOT add it - instead, modify the existing element
  * Only add elements that are completely absent from the canvas
- PREFERENCE: When the context frame has an element that should be in the canvas, first check if a similar element exists. If yes, modify it. Only add if no similar element exists.
- Color values (r, g, b) must be between 0 and 1
- Use exact absolute positions (x, y) from the context frame for new elements - these are absolute coordinates relative to the canvas frame
- Return ONLY valid JSON, no other text.`;
        const response = yield fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a design assistant that generates style modifications. CRITICAL: Always prefer modifying existing elements over adding new ones. Never duplicate elements. Return only valid JSON.',
                    },
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                temperature: 0.3,
                max_tokens: 3000,
                response_format: { type: 'json_object' },
            }),
        });
        if (!response.ok) {
            const error = yield response.json();
            throw new Error(((_a = error.error) === null || _a === void 0 ? void 0 : _a.message) || 'LLM API error');
        }
        const data = yield response.json();
        const content = ((_c = (_b = data.choices[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) || '{}';
        // Try to extract JSON if it's wrapped in markdown code blocks
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/```\s*([\s\S]*?)\s*```/);
        const jsonString = jsonMatch ? jsonMatch[1] : content;
        return jsonString;
    });
}
// Apply modification instructions to the canvas
function applyModificationInstructions(instructionsJSON, changedElement, canvasFrame) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            // Parse the JSON instructions
            console.log('Parsing instructions JSON:', instructionsJSON.substring(0, 500));
            const instructions = JSON.parse(instructionsJSON);
            console.log('Parsed instructions:', {
                hasModify: !!instructions.modify,
                modifyCount: ((_a = instructions.modify) === null || _a === void 0 ? void 0 : _a.length) || 0,
                hasAdd: !!instructions.add,
                addCount: ((_b = instructions.add) === null || _b === void 0 ? void 0 : _b.length) || 0
            });
            // Create a map of canvas elements by their keys
            // First, we need to assign keys to canvas elements
            const canvasElements = getElementsWithHierarchy(canvasFrame);
            const keyToNode = new Map();
            const nodeToKey = new Map();
            // Assign keys to canvas elements (canvas_0, canvas_1, etc.)
            canvasElements.forEach((el, index) => {
                const key = `canvas_${index}`;
                keyToNode.set(key, el.node);
                nodeToKey.set(el.node, key);
            });
            console.log(`Created ${keyToNode.size} element keys`);
            console.log('Available keys:', Array.from(keyToNode.keys()));
            // Find the key for the changed element
            const changedElementKey = nodeToKey.get(changedElement);
            console.log('Changed element key:', changedElementKey, 'type:', changedElement.type, 'name:', changedElement.name);
            let modifiedCount = 0;
            let addedCount = 0;
            // Apply modifications
            if (instructions.modify && Array.isArray(instructions.modify)) {
                console.log(`Processing ${instructions.modify.length} modifications`);
                for (const modifyData of instructions.modify) {
                    console.log('Processing modify instruction:', JSON.stringify(modifyData, null, 2));
                    let targetElement = null;
                    // If key is specified, use it
                    if (modifyData.key) {
                        targetElement = keyToNode.get(modifyData.key) || null;
                        console.log(`Looking for element with key "${modifyData.key}":`, targetElement ? 'found' : 'NOT FOUND');
                    }
                    // Fallback: use the changed element if no key or key not found
                    if (!targetElement) {
                        targetElement = changedElement;
                        console.log('Using changed element as fallback');
                    }
                    if (targetElement) {
                        console.log(`Applying modifications to element: ${targetElement.type} "${targetElement.name}"`);
                        yield applyStylesToElementFromJSON(modifyData, targetElement);
                        modifiedCount++;
                        console.log(`✓ Modified element: ${modifyData.key || 'changed element'}`);
                    }
                    else {
                        console.log(`✗ Could not find target element for modification`);
                    }
                }
            }
            else {
                console.log('No modifications to apply');
            }
            // Apply additions
            if (instructions.add && Array.isArray(instructions.add)) {
                for (const addData of instructions.add) {
                    // Determine parent: use parentKey if specified, otherwise use canvas frame
                    let targetParent = canvasFrame;
                    if (addData.parentKey) {
                        const parentElement = keyToNode.get(addData.parentKey);
                        if (parentElement && ('children' in parentElement)) {
                            targetParent = parentElement;
                        }
                    }
                    try {
                        const newElement = yield createElementFromJSON(addData, targetParent);
                        if (newElement) {
                            // Set position if provided
                            // The LLM outputs absolute coordinates, which we use directly for canvas frame children
                            // For nested elements, we need to convert absolute to relative
                            if (addData.x !== undefined && addData.y !== undefined) {
                                if (targetParent === canvasFrame) {
                                    // Canvas frame is at (0,0) in its own coordinate system, so absolute = relative
                                    newElement.x = addData.x;
                                    newElement.y = addData.y;
                                }
                                else {
                                    // Convert frame-relative coordinates to parent-relative coordinates for nested elements
                                    // Positions are relative to frame, so subtract parent's frame-relative position
                                    const parentX = 'x' in targetParent ? targetParent.x : 0;
                                    const parentY = 'y' in targetParent ? targetParent.y : 0;
                                    newElement.x = addData.x - parentX;
                                    newElement.y = addData.y - parentY;
                                }
                            }
                            // Set rotation if provided
                            if (addData.rotation !== undefined && 'rotation' in newElement) {
                                // Convert degrees to radians if needed
                                const rotationInRadians = typeof addData.rotation === 'number'
                                    ? (addData.rotation * Math.PI / 180) // Convert degrees to radians
                                    : addData.rotation;
                                newElement.rotation = rotationInRadians;
                            }
                            addedCount++;
                            console.log(`✓ Created new ${addData.type} element at (${newElement.x}, ${newElement.y}) relative to parent`);
                        }
                    }
                    catch (e) {
                        console.log('✗ Error creating element from JSON:', e, addData);
                    }
                }
            }
            else {
                console.log('No additions to apply');
            }
            console.log(`Modification summary: ${modifiedCount} modified, ${addedCount} added`);
            return { modified: modifiedCount, added: addedCount };
        }
        catch (e) {
            console.log('✗ Error parsing or applying modification instructions:', e);
            console.log('Instructions JSON:', instructionsJSON);
            throw e;
        }
    });
}
// Main function: Identify intent (simplified - no modifications for now)
function identifyIntentAndMatch(changedElement, contextFrame, canvasFrame, apiKey) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Show toast that we're analyzing
            figma.notify('Analyzing intent...');
            // Load cached context description if available
            const contextDescription = yield figma.clientStorage.getAsync('context_description');
            // Step 1: Identify intent (text description) - now includes context frame and description
            const { intent, autocomplete } = yield identifyIntent(changedElement, contextFrame, canvasFrame, contextDescription, apiKey);
            // Display intent and autocomplete in plugin UI
            figma.ui.postMessage({
                type: 'intent-identified',
                intent: intent,
                autocomplete: autocomplete,
                elementType: changedElement.type,
                elementName: changedElement.name,
            });
            // Step 2: Generate modification instructions based on autocomplete (only if not "No changes needed")
            if (autocomplete && autocomplete.toLowerCase() !== 'no changes needed') {
                figma.ui.postMessage({
                    type: 'processing',
                    message: 'Generating modification instructions...',
                });
                let instructionsJSON = yield generateModificationsFromAutocomplete(autocomplete, intent, changedElement, contextFrame, canvasFrame, contextDescription, apiKey);
                // Send initial step with autocomplete and JSON to UI
                figma.ui.postMessage({
                    type: 'modification-step',
                    iteration: 0,
                    autocomplete: autocomplete,
                    json: instructionsJSON,
                });
                // Multi-shot: Apply modifications and verify up to 3 times
                let iteration = 0;
                const maxIterations = 1;
                let currentCanvasFrame = canvasFrame;
                while (iteration < maxIterations) {
                    iteration++;
                    console.log(`\n=== Iteration ${iteration}/${maxIterations} ===`);
                    // Apply the modifications
                    try {
                        figma.ui.postMessage({
                            type: 'processing',
                            message: iteration === 1 ? 'Applying changes...' : `Verifying and correcting (iteration ${iteration})...`,
                        });
                        const result = yield applyModificationInstructions(instructionsJSON, changedElement, currentCanvasFrame);
                        const modifyCount = result.modified || 0;
                        const addCount = result.added || 0;
                        if (modifyCount > 0 || addCount > 0) {
                            const parts = [];
                            if (modifyCount > 0)
                                parts.push(`${modifyCount} modified`);
                            if (addCount > 0)
                                parts.push(`${addCount} added`);
                            console.log(`Applied: ${parts.join(', ')}`);
                        }
                        // Wait a bit for Figma to update
                        yield new Promise(resolve => setTimeout(resolve, 500));
                        // Refresh canvas frame reference
                        currentCanvasFrame = (yield figma.getNodeByIdAsync(canvasFrame.id));
                        // Take screenshot and verify
                        if (iteration < maxIterations) {
                            const verificationResult = yield verifyAndCorrectChanges(currentCanvasFrame, contextFrame, contextDescription, autocomplete, intent, apiKey, iteration);
                            if (verificationResult.needsCorrection && verificationResult.correctionsJSON) {
                                console.log('Corrections needed, applying...');
                                // Send correction step with autocomplete and JSON to UI
                                figma.ui.postMessage({
                                    type: 'modification-step',
                                    iteration: iteration,
                                    autocomplete: verificationResult.correctionIntent || 'Applying corrections...',
                                    json: verificationResult.correctionsJSON,
                                });
                                instructionsJSON = verificationResult.correctionsJSON;
                                // Continue to next iteration
                            }
                            else {
                                console.log('Changes verified successfully!');
                                figma.notify(`Applied changes successfully (${iteration} iteration${iteration > 1 ? 's' : ''})`);
                                break; // Exit loop if verified
                            }
                        }
                        else {
                            // Last iteration, just notify
                            if (modifyCount > 0 || addCount > 0) {
                                const parts = [];
                                if (modifyCount > 0)
                                    parts.push(`${modifyCount} modified`);
                                if (addCount > 0)
                                    parts.push(`${addCount} added`);
                                figma.notify(`Applied changes: ${parts.join(', ')}`);
                            }
                            else {
                                figma.notify('No changes to apply');
                            }
                        }
                    }
                    catch (e) {
                        console.log('Error applying modifications:', e);
                        figma.notify('Could not apply modifications automatically');
                        break;
                    }
                }
            }
        }
        catch (e) {
            console.log('Error in identifyIntentAndMatch:', e);
            figma.notify('Could not process action');
        }
    });
}
// Verify if changes were applied correctly and generate corrections if needed
function verifyAndCorrectChanges(canvasFrame, contextFrame, contextDescription, autocomplete, intent, apiKey, iteration) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        try {
            console.log('Verifying changes...');
            // Export canvas frame as image
            const canvasImageBase64 = yield exportFrameAsImage(canvasFrame);
            const contextImageBase64 = yield exportFrameAsImage(contextFrame);
            const contextDescText = contextDescription
                ? `\n\nCONTEXT DESCRIPTION:\n${contextDescription}`
                : '';
            // Step 1: Generate intent description for corrections
            const intentPrompt = `You are analyzing what corrections need to be made to a design. Look at the CANVAS FRAME image and compare it to the CONTEXT FRAME image.

ORIGINAL INTENT:
${intent}

AUTOCOMPLETE SUGGESTION:
${autocomplete}${contextDescText}

Your task:
1. Compare the CANVAS FRAME (current state) to the CONTEXT FRAME (target state)
2. Identify what is wrong or missing
3. Describe in plain text what corrections need to be made

Return a JSON object with:
{
  "correct": true or false,
  "intent": "description of what corrections are needed, or 'Changes applied correctly' if no corrections needed"
}

IMPORTANT RULES:
- Only include changes suggested by the autocomplete
- CRITICAL - MODIFY BEFORE ADD: Always check if an element exists before adding. If a similar element exists (same type, similar position/size), modify it instead of adding a new one.
- CRITICAL - NO DUPLICATES: You must prevent duplicates by exhaustively examining the CANVAS FRAME JSON. For every element you consider adding:
  * Search through ALL elements in the canvas frame at ALL nesting levels (including nested children, grandchildren, etc.)
  * Check if there's already an element of the same type at a similar position (within ~30 pixels)
  * Check if there's already an element with similar size (within ~30 pixels width/height)
  * If ANY matching element exists, DO NOT add it - instead, modify the existing element
  * Only add elements that are completely absent from the canvas
- PREFERENCE: When the context frame has an element that should be in the canvas, first check if a similar element exists. If yes, modify it. Only add if no similar element exists.
- Color values (r, g, b) must be between 0 and 1
- Use exact absolute positions (x, y) from the context frame for new elements - these are absolute coordinates relative to the canvas frame
- Return ONLY valid JSON, no other text.`;
            // First, get the intent
            const intentMessages = [
                {
                    role: 'system',
                    content: 'You are a design verification assistant. Describe what corrections are needed in plain text. Return only valid JSON.',
                },
            ];
            if (canvasImageBase64 && contextImageBase64) {
                intentMessages.push({
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: `${intentPrompt}\n\n[Image 1: CANVAS FRAME - current state]\n[Image 2: CONTEXT FRAME - target/reference design]`,
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:image/png;base64,${canvasImageBase64}`,
                            },
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:image/png;base64,${contextImageBase64}`,
                            },
                        },
                    ],
                });
            }
            else {
                intentMessages.push({
                    role: 'user',
                    content: intentPrompt,
                });
            }
            const intentResponse = yield fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: intentMessages,
                    temperature: 0.3,
                    max_tokens: 500,
                    response_format: { type: 'json_object' },
                }),
            });
            let correctionIntent = 'Verifying changes...';
            let needsCorrection = false;
            if (intentResponse.ok) {
                const intentData = yield intentResponse.json();
                const intentContent = ((_b = (_a = intentData.choices[0]) === null || _a === void 0 ? void 0 : _a.message) === null || _b === void 0 ? void 0 : _b.content) || '{}';
                const intentJsonMatch = intentContent.match(/```json\s*([\s\S]*?)\s*```/) || intentContent.match(/```\s*([\s\S]*?)\s*```/);
                const intentJsonString = intentJsonMatch ? intentJsonMatch[1] : intentContent;
                const intentResult = JSON.parse(intentJsonString);
                correctionIntent = intentResult.intent || 'Verifying changes...';
                needsCorrection = intentResult.correct === false;
            }
            // Step 2: If corrections needed, generate correction JSON
            if (!needsCorrection) {
                return { needsCorrection: false, correctionIntent };
            }
            const prompt = `You are generating correction instructions for a design. Look at the CANVAS FRAME image and compare it to the CONTEXT FRAME image.

CORRECTION INTENT:
${correctionIntent}

ORIGINAL INTENT:
${intent}

AUTOCOMPLETE SUGGESTION:
${autocomplete}${contextDescText}

Your task:
1. Based on the correction intent, generate specific modification instructions
2. Check if:
   - Elements that should have been modified were actually modified (colors, styles, etc.)
   - Elements that should have been added were actually added
   - Elements are in the correct positions
   - No unwanted duplicates were created

Return a JSON object with:
{
  "modify": [...],
  "add": [...]
}

For corrections, use the same format as modification instructions:
- "modify" array: elements to modify (with "key" field - use "canvas_X" format, or omit key to modify the most recently changed element)
- "add" array: elements to add (with type, position, size, fills, etc.)

CRITICAL RULES FOR CORRECTIONS:
- Only suggest corrections for what is actually wrong or missing
- Prefer modifying existing elements over adding new ones
- Do not duplicate elements that already exist

Return ONLY valid JSON, no other text.`;
            const messages = [
                {
                    role: 'system',
                    content: 'You are a design verification assistant. Compare designs and identify what needs correction. Return only valid JSON.',
                },
            ];
            if (canvasImageBase64 && contextImageBase64) {
                messages.push({
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: prompt,
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:image/png;base64,${canvasImageBase64}`,
                            },
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:image/png;base64,${contextImageBase64}`,
                            },
                        },
                    ],
                });
            }
            else {
                messages.push({
                    role: 'user',
                    content: prompt,
                });
            }
            const response = yield fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: messages,
                    temperature: 0.3,
                    max_tokens: 2000,
                    response_format: { type: 'json_object' },
                }),
            });
            if (!response.ok) {
                const error = yield response.json();
                throw new Error(((_c = error.error) === null || _c === void 0 ? void 0 : _c.message) || 'LLM API error');
            }
            const data = yield response.json();
            const content = ((_e = (_d = data.choices[0]) === null || _d === void 0 ? void 0 : _d.message) === null || _e === void 0 ? void 0 : _e.content) || '{}';
            // Try to extract JSON if it's wrapped in markdown code blocks
            const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/```\s*([\s\S]*?)\s*```/);
            const jsonString = jsonMatch ? jsonMatch[1] : content;
            const corrections = JSON.parse(jsonString);
            console.log('✗ Corrections needed');
            // Convert corrections to the same format as modification instructions
            const correctionsJSON = JSON.stringify(corrections);
            return { needsCorrection: true, correctionsJSON, correctionIntent };
        }
        catch (e) {
            console.log('Error verifying changes:', e);
            // On error, assume changes are correct to avoid infinite loops
            return { needsCorrection: false };
        }
    });
}
// Get all elements with their parent information
function getElementsWithHierarchy(node, _parent = null, depth = 0) {
    const result = [];
    if ('children' in node) {
        node.children.forEach((child) => {
            result.push({ node: child, parent: node, depth });
            result.push(...getElementsWithHierarchy(child, node, depth + 1));
        });
    }
    return result;
}
// Create an element from JSON data and apply styles
function createElementFromJSON(elementData, parent) {
    return __awaiter(this, void 0, void 0, function* () {
        let newElement = null;
        try {
            // Create element based on type
            if (elementData.type === 'ELLIPSE') {
                const ellipse = figma.createEllipse();
                ellipse.resize(elementData.width || 100, elementData.height || 100);
                newElement = ellipse;
            }
            else if (elementData.type === 'RECTANGLE') {
                const rect = figma.createRectangle();
                rect.resize(elementData.width || 100, elementData.height || 100);
                newElement = rect;
            }
            else if (elementData.type === 'POLYGON') {
                const polygon = figma.createPolygon();
                polygon.resize(elementData.width || 100, elementData.height || 100);
                newElement = polygon;
            }
            else if (elementData.type === 'STAR') {
                const star = figma.createStar();
                star.resize(elementData.width || 100, elementData.height || 100);
                newElement = star;
            }
            else if (elementData.type === 'TEXT') {
                if (elementData.font) {
                    yield figma.loadFontAsync({ family: elementData.font.family, style: elementData.font.style });
                    const text = figma.createText();
                    text.fontName = { family: elementData.font.family, style: elementData.font.style };
                    text.fontSize = elementData.fontSize || 12;
                    text.characters = elementData.text || 'Text';
                    newElement = text;
                }
            }
            if (newElement) {
                // Set position - use exact position from context (absolute coordinates)
                newElement.x = elementData.x !== undefined ? elementData.x : 0;
                newElement.y = elementData.y !== undefined ? elementData.y : 0;
                newElement.name = elementData.name || newElement.type;
                // Apply all styles
                yield applyStylesToElementFromJSON(elementData, newElement);
                // Add to parent
                if ('children' in parent) {
                    parent.appendChild(newElement);
                }
            }
        }
        catch (e) {
            console.log('Error creating element from JSON:', e);
            return null;
        }
        return newElement;
    });
}
// Apply styles from JSON element data to an existing Figma element
function applyStylesToElementFromJSON(elementData, targetElement) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`Applying styles to ${targetElement.type} "${targetElement.name}"`);
        console.log('Style data keys:', Object.keys(elementData));
        // Apply fills - only SOLID fills are supported
        if (elementData.fills && Array.isArray(elementData.fills) && 'fills' in targetElement) {
            console.log(`Processing ${elementData.fills.length} fills`);
            const validFills = [];
            for (const fill of elementData.fills) {
                if (fill.type === 'SOLID' && fill.color &&
                    typeof fill.color.r === 'number' &&
                    typeof fill.color.g === 'number' &&
                    typeof fill.color.b === 'number') {
                    // Handle both 0-1 and 0-255 color formats
                    let r = fill.color.r;
                    let g = fill.color.g;
                    let b = fill.color.b;
                    // If values are > 1, assume they're in 0-255 format and convert
                    if (r > 1 || g > 1 || b > 1) {
                        console.log('Converting color from 0-255 to 0-1 format');
                        r = r / 255;
                        g = g / 255;
                        b = b / 255;
                    }
                    validFills.push({
                        type: 'SOLID',
                        color: {
                            r: Math.max(0, Math.min(1, r)),
                            g: Math.max(0, Math.min(1, g)),
                            b: Math.max(0, Math.min(1, b))
                        },
                        opacity: fill.opacity !== undefined ? Math.max(0, Math.min(1, fill.opacity)) : 1,
                    });
                    console.log(`Created fill: rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`);
                }
                else {
                    console.log('Fill validation failed:', fill);
                }
            }
            if (validFills.length > 0) {
                try {
                    if (targetElement.fills === figma.mixed) {
                        console.log('⚠ Cannot apply fills to element with mixed fills');
                    }
                    else {
                        targetElement.fills = validFills;
                        console.log(`✓ Applied ${validFills.length} fill(s)`);
                    }
                }
                catch (e) {
                    console.log('✗ Error applying fills:', e);
                }
            }
            else {
                console.log('No valid fills to apply');
            }
        }
        else if (elementData.fills) {
            console.log('Fills data present but not in correct format:', elementData.fills);
        }
        // Apply strokes
        if (elementData.strokes && Array.isArray(elementData.strokes) && 'strokes' in targetElement) {
            const validStrokes = [];
            for (const stroke of elementData.strokes) {
                if (stroke.type === 'SOLID' && stroke.color &&
                    typeof stroke.color.r === 'number' &&
                    typeof stroke.color.g === 'number' &&
                    typeof stroke.color.b === 'number') {
                    validStrokes.push({
                        type: 'SOLID',
                        color: {
                            r: Math.max(0, Math.min(1, stroke.color.r)),
                            g: Math.max(0, Math.min(1, stroke.color.g)),
                            b: Math.max(0, Math.min(1, stroke.color.b))
                        },
                        opacity: stroke.opacity !== undefined ? Math.max(0, Math.min(1, stroke.opacity)) : 1,
                    });
                }
            }
            if (validStrokes.length > 0 && Array.isArray(targetElement.strokes)) {
                targetElement.strokes = validStrokes;
            }
            if (elementData.strokeWeight !== undefined && typeof elementData.strokeWeight === 'number' && 'strokeWeight' in targetElement) {
                targetElement.strokeWeight = Math.max(0, elementData.strokeWeight);
            }
        }
        // Apply corner radius
        if (elementData.cornerRadius !== undefined && 'cornerRadius' in targetElement) {
            try {
                targetElement.cornerRadius = elementData.cornerRadius;
            }
            catch (e) {
                // Some node types don't support cornerRadius
            }
        }
        // Apply effects
        if (elementData.effects && Array.isArray(elementData.effects) && 'effects' in targetElement) {
            targetElement.effects = elementData.effects.map((effect) => {
                if (effect.type === 'DROP_SHADOW') {
                    return {
                        type: 'DROP_SHADOW',
                        offset: effect.offset,
                        radius: effect.radius,
                        color: effect.color,
                        visible: true,
                        blendMode: 'NORMAL',
                    };
                }
                return effect;
            });
        }
        // Apply opacity
        if (elementData.opacity !== undefined && 'opacity' in targetElement) {
            targetElement.opacity = Math.max(0, Math.min(1, elementData.opacity));
        }
        // Apply rotation
        if (elementData.rotation !== undefined && 'rotation' in targetElement) {
            // Convert degrees to radians if needed, or use as-is if already in radians
            // Figma uses radians for rotation
            const rotationInRadians = typeof elementData.rotation === 'number'
                ? (elementData.rotation * Math.PI / 180) // Convert degrees to radians
                : elementData.rotation;
            targetElement.rotation = rotationInRadians;
        }
        // Apply typography for text
        if (targetElement.type === 'TEXT' && elementData.fontSize) {
            const textNode = targetElement;
            try {
                if (elementData.font) {
                    yield figma.loadFontAsync({ family: elementData.font.family, style: elementData.font.style });
                    textNode.fontName = { family: elementData.font.family, style: elementData.font.style };
                }
                if (elementData.fontSize)
                    textNode.fontSize = elementData.fontSize;
                if (elementData.lineHeight) {
                    textNode.lineHeight = elementData.lineHeight.unit === 'PIXELS'
                        ? { value: elementData.lineHeight.value, unit: 'PIXELS' }
                        : elementData.lineHeight.value;
                }
                if (elementData.letterSpacing) {
                    textNode.letterSpacing = elementData.letterSpacing;
                }
                if (elementData.textAlignHorizontal) {
                    textNode.textAlignHorizontal = elementData.textAlignHorizontal;
                }
            }
            catch (e) {
                console.log('Could not apply typography:', e);
            }
        }
    });
}
// Apply elements from JSON representation - modify existing elements by key, create new ones
// Handle messages from UI
figma.ui.onmessage = (msg) => __awaiter(void 0, void 0, void 0, function* () {
    console.log('Plugin received message:', msg);
    if (msg.type === 'save-api-key') {
        apiKey = msg.apiKey;
        yield figma.clientStorage.setAsync('openai_api_key', msg.apiKey);
        // If context frame exists, generate description now that we have API key
        if (contextFrameId && apiKey) {
            try {
                const frame = yield figma.getNodeByIdAsync(contextFrameId);
                if (frame) {
                    yield generateAndStoreContextDescription(frame, apiKey);
                }
            }
            catch (e) {
                console.log('Could not generate context description after API key save:', e);
            }
        }
    }
    else if (msg.type === 'get-api-key') {
        const apiKey = yield figma.clientStorage.getAsync('openai_api_key');
        figma.ui.postMessage({
            type: 'api-key-loaded',
            apiKey: apiKey || '',
        });
    }
    else if (msg.type === 'select-context') {
        const selection = figma.currentPage.selection;
        console.log('Selection:', selection);
        console.log('Selection length:', selection.length);
        if (selection.length === 0) {
            console.log('No selection found');
            figma.ui.postMessage({
                type: 'error',
                message: 'Please select a frame to use as context',
            });
            return;
        }
        console.log('Selected node type:', selection[0].type);
        if (selection[0].type !== 'FRAME') {
            figma.ui.postMessage({
                type: 'error',
                message: 'Please select a frame to use as context',
            });
            return;
        }
        contextFrameId = selection[0].id;
        console.log('Context frame selected:', contextFrameId, selection[0].name);
        // Save to storage
        yield figma.clientStorage.setAsync('context_frame_id', contextFrameId);
        figma.ui.postMessage({
            type: 'context-selected',
            frameId: contextFrameId,
            frameName: selection[0].name,
        });
        // Generate context description immediately
        if (apiKey) {
            yield generateAndStoreContextDescription(selection[0], apiKey);
        }
    }
    else if (msg.type === 'select-canvas') {
        const selection = figma.currentPage.selection;
        console.log('Canvas selection:', selection);
        if (selection.length === 0) {
            console.log('No selection found for canvas');
            figma.ui.postMessage({
                type: 'error',
                message: 'Please select a frame to use as canvas',
            });
            return;
        }
        if (selection[0].type !== 'FRAME') {
            console.log('Canvas selection is not a FRAME, it is:', selection[0].type);
            figma.ui.postMessage({
                type: 'error',
                message: 'Please select a frame to use as canvas',
            });
            return;
        }
        canvasFrameId = selection[0].id;
        console.log('Canvas frame selected:', canvasFrameId, selection[0].name);
        // Save to storage
        yield figma.clientStorage.setAsync('canvas_frame_id', canvasFrameId);
        // Initialize canvas hash for change detection
        try {
            const canvasFrame = selection[0];
            previousCanvasHash = yield getFrameHash(canvasFrame);
        }
        catch (e) {
            console.log('Error initializing canvas hash:', e);
        }
        figma.ui.postMessage({
            type: 'canvas-selected',
            frameId: canvasFrameId,
            frameName: selection[0].name,
        });
    }
});
// Load all pages (required for documentchange handler)
figma.loadAllPagesAsync();
// Listen for document changes to detect context frame modifications
let contextChangeTimeout = null;
figma.on('documentchange', () => __awaiter(void 0, void 0, void 0, function* () {
    if (!contextFrameId || !apiKey) {
        return;
    }
    // Check if context frame was modified
    try {
        const contextFrame = yield figma.getNodeByIdAsync(contextFrameId);
        if (contextFrame) {
            // Debounce to avoid too many checks
            if (contextChangeTimeout) {
                clearTimeout(contextChangeTimeout);
            }
            contextChangeTimeout = setTimeout(() => __awaiter(void 0, void 0, void 0, function* () {
                if (!apiKey)
                    return;
                const currentHash = yield getFrameHash(contextFrame);
                const cachedHash = yield figma.clientStorage.getAsync('context_frame_hash');
                // If hash changed, regenerate description
                if (cachedHash !== currentHash) {
                    console.log('Context frame modified, regenerating description');
                    yield generateAndStoreContextDescription(contextFrame, apiKey);
                }
            }), 2000); // Wait 2 seconds after last change
        }
    }
    catch (e) {
        // Context frame might have been deleted
        console.log('Error checking context frame:', e);
    }
}));
let canvasChangeTimeout = null;
// Listen for document changes to detect canvas frame modifications (prompt by action)
// This only triggers when actual changes are made, not just when selection changes
figma.on('documentchange', () => __awaiter(void 0, void 0, void 0, function* () {
    if (!canvasFrameId || !contextFrameId || !apiKey || isProcessing) {
        return;
    }
    // Debounce changes
    if (canvasChangeTimeout) {
        clearTimeout(canvasChangeTimeout);
    }
    canvasChangeTimeout = setTimeout(() => __awaiter(void 0, void 0, void 0, function* () {
        try {
            if (!canvasFrameId || !contextFrameId || !apiKey) {
                return;
            }
            const canvasFrame = yield figma.getNodeByIdAsync(canvasFrameId);
            const contextFrame = yield figma.getNodeByIdAsync(contextFrameId);
            if (!canvasFrame || !contextFrame) {
                return;
            }
            // FIRST: Check if selection is within canvas frame (early exit if not)
            const selection = figma.currentPage.selection;
            if (selection.length === 0) {
                return;
            }
            // Check if selection is within canvas frame
            let selectedElement = null;
            for (const node of selection) {
                // Check if node is within canvas frame
                let current = node;
                while (current) {
                    if (current.id === canvasFrame.id) {
                        selectedElement = node;
                        break;
                    }
                    current = current.parent;
                }
                if (selectedElement)
                    break;
            }
            // If selection is not in canvas frame, skip entirely
            if (!selectedElement) {
                return;
            }
            // Skip if we recently processed this element
            if (recentlyProcessed.has(selectedElement.id)) {
                return;
            }
            // NOW check if canvas frame content actually changed
            const currentHash = yield getFrameHash(canvasFrame);
            if (previousCanvasHash === null) {
                // First time, just store the hash
                previousCanvasHash = currentHash;
                return;
            }
            if (previousCanvasHash === currentHash) {
                // No changes detected, skip
                console.log('Canvas frame hash unchanged, skipping');
                return;
            }
            console.log('Canvas frame hash changed, processing change');
            // Update hash for next check
            previousCanvasHash = currentHash;
            // Mark as processed
            recentlyProcessed.add(selectedElement.id);
            // Clear after 5 seconds to allow re-processing if needed
            setTimeout(() => recentlyProcessed.delete(selectedElement.id), 5000);
            isProcessing = true;
            console.log(`Processing change for ${selectedElement.type} element`);
            // Show processing status in UI
            figma.ui.postMessage({
                type: 'processing',
                message: 'Analyzing intent...',
            });
            yield identifyIntentAndMatch(selectedElement, contextFrame, canvasFrame, apiKey);
            isProcessing = false;
        }
        catch (e) {
            console.log('Error processing document change:', e);
            isProcessing = false;
        }
    }), 500); // Wait 0.5 second after last change
}));
