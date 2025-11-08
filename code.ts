// Picasso - AI Native Design Plugin
// Prompt by Action: Match style from context frame to canvas frame using LLM

figma.showUI(__html__, { width: 350, height: 400 });

let contextFrameId: string | null = null;
let canvasFrameId: string | null = null;

// Load saved data from clientStorage and send to UI
(async () => {
    // Load API key
    const apiKey = await figma.clientStorage.getAsync('openai_api_key');
    if (apiKey) {
        figma.ui.postMessage({
            type: 'api-key-loaded',
            apiKey: apiKey as string,
        });
    }
    
    // Load context frame
    const savedContextFrameId = await figma.clientStorage.getAsync('context_frame_id');
    if (savedContextFrameId) {
        try {
            const frame = await figma.getNodeByIdAsync(savedContextFrameId as string);
            if (frame && frame.type === 'FRAME') {
                contextFrameId = frame.id;
                figma.ui.postMessage({
                    type: 'context-selected',
                    frameId: contextFrameId,
                    frameName: frame.name,
                });
            }
        } catch (e) {
            console.log('Could not load context frame:', e);
            // Frame might have been deleted, clear it from storage
            await figma.clientStorage.deleteAsync('context_frame_id');
        }
    }
    
    // Load canvas frame
    const savedCanvasFrameId = await figma.clientStorage.getAsync('canvas_frame_id');
    if (savedCanvasFrameId) {
        try {
            const frame = await figma.getNodeByIdAsync(savedCanvasFrameId as string);
            if (frame && frame.type === 'FRAME') {
                canvasFrameId = frame.id;
                figma.ui.postMessage({
                    type: 'canvas-selected',
                    frameId: canvasFrameId,
                    frameName: frame.name,
                });
            }
        } catch (e) {
            console.log('Could not load canvas frame:', e);
            // Frame might have been deleted, clear it from storage
            await figma.clientStorage.deleteAsync('canvas_frame_id');
        }
    }
})();

// Serialize a Figma node to a text description for LLM
async function serializeNodeToText(node: SceneNode, depth: number = 0): Promise<string> {
    const indent = '  '.repeat(depth);
    let description = '';

    // Load fonts if needed
    if (node.type === 'TEXT') {
        const textNode = node as TextNode;
        if (textNode.fontName !== figma.mixed) {
            try {
                await figma.loadFontAsync(textNode.fontName);
            } catch (e) {
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
            } else if (fill.type === 'GRADIENT_LINEAR') {
                description += `${indent}    - linear gradient\n`;
            } else if (fill.type === 'GRADIENT_RADIAL') {
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
            } else if (effect.type === 'INNER_SHADOW') {
                description += `${indent}    - inner shadow\n`;
            } else if (effect.type === 'LAYER_BLUR') {
                description += `${indent}    - layer blur: ${effect.radius}\n`;
            } else if (effect.type === 'BACKGROUND_BLUR') {
                description += `${indent}    - background blur: ${effect.radius}\n`;
            }
        });
    }

    // Typography (for text nodes)
    if (node.type === 'TEXT') {
        const textNode = node as TextNode;
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
                } else if (typeof textNode.lineHeight === 'number') {
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
        } catch (e) {
            description += `${indent}  text: (could not read text)\n`;
        }
    }

    // Layout properties (for frames)
    if (node.type === 'FRAME') {
        const frame = node as FrameNode;
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
            description += await serializeNodeToText(child, depth + 1);
        }
    }

    return description;
}

// Serialize a Figma node to JSON for LLM
function serializeNodeToJSON(node: SceneNode): Record<string, unknown> {
    const json: Record<string, unknown> = {
        type: node.type,
        name: node.name,
        x: Math.round(node.x),
        y: Math.round(node.y),
        width: Math.round(node.width),
        height: Math.round(node.height),
        visible: node.visible,
    };

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
        const textNode = node as TextNode;
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
                } else if (typeof textNode.lineHeight === 'number') {
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
        } catch (e) {
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

// Step 1: Generate style description from context frame
async function generateStyleDescription(
    contextDescription: string,
    apiKey: string
): Promise<string> {
    const prompt = `Analyze the visual style of this Figma design. Focus on the LOOK and FEEL, not specific element positions.

CONTEXT FRAME:
${contextDescription}

Provide a concise style description covering:
- Colors: List the main colors used (RGB values)
- Typography: Font families, sizes, weights if text exists
- Corners: Corner radius values
- Effects: Shadows, blurs, gradients
- Overall aesthetic: Brief description (e.g., "minimalist", "bold", "soft")

Keep it concise and factual. Avoid verbose explanations.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
                    content: 'You are a design expert. Provide concise, factual style descriptions. Focus on visual appearance, not element positions or verbose explanations.',
                },
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            temperature: 0.3,
            max_tokens: 800,
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'LLM API error');
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || 'No response from LLM';
}

// Step 2: Generate JSON representation of elements to create/modify
async function generateElementJSON(
    styleDescription: string,
    contextJSON: string,
    canvasJSON: string,
    apiKey: string
): Promise<string> {
    const prompt = `You are analyzing two Figma designs. The context frame has the target style. The canvas frame needs to be modified to match.

TARGET STYLE:
${styleDescription}

CONTEXT FRAME (reference - JSON):
${contextJSON}

CANVAS FRAME (current - JSON):
${canvasJSON}

Return a JSON array of elements that need to be created or modified in the canvas frame. Each element should be a JSON object with:
- type: element type (ELLIPSE, RECTANGLE, TEXT, etc.)
- x, y: position
- width, height: dimensions
- fills: array of fill objects with color (r, g, b) and opacity
- strokes: array of stroke objects (optional)
- strokeWeight: number (optional)
- cornerRadius: number (optional)
- effects: array of effect objects (optional)
- font: object with family and style (for TEXT)
- fontSize: number (for TEXT)
- text: string (for TEXT)
- opacity: number (optional)

Include ALL elements from the context frame that are missing in the canvas, plus modifications for existing elements. Return ONLY valid JSON, no other text.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
                    content: 'You are a design expert. Provide concise, specific instructions for applying styles. Focus on visual appearance matching.',
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
        const error = await response.json();
        throw new Error(error.error?.message || 'LLM API error');
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || '{}';
    
    // Try to extract JSON if it's wrapped in markdown code blocks
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/```\s*([\s\S]*?)\s*```/);
    const jsonString = jsonMatch ? jsonMatch[1] : content;
    
    return jsonString;
}

// Apply elements from JSON representation
async function applyElementsFromJSON(elements: any[], canvasFrame: FrameNode): Promise<void> {
    for (const elementData of elements) {
        try {
            let newElement: SceneNode | null = null;

            // Create element based on type
            if (elementData.type === 'ELLIPSE') {
                const ellipse = figma.createEllipse();
                ellipse.resize(elementData.width || 100, elementData.height || 100);
                newElement = ellipse;
            } else if (elementData.type === 'RECTANGLE') {
                const rect = figma.createRectangle();
                rect.resize(elementData.width || 100, elementData.height || 100);
                newElement = rect;
            } else if (elementData.type === 'POLYGON') {
                const polygon = figma.createPolygon();
                polygon.resize(elementData.width || 100, elementData.height || 100);
                newElement = polygon;
            } else if (elementData.type === 'STAR') {
                const star = figma.createStar();
                star.resize(elementData.width || 100, elementData.height || 100);
                newElement = star;
            } else if (elementData.type === 'TEXT') {
                if (elementData.font) {
                    await figma.loadFontAsync({ family: elementData.font.family, style: elementData.font.style });
                    const text = figma.createText();
                    text.fontName = { family: elementData.font.family, style: elementData.font.style };
                    text.fontSize = elementData.fontSize || 12;
                    text.characters = elementData.text || 'Text';
                    newElement = text;
                }
            }

            if (newElement) {
                // Set position
                newElement.x = elementData.x || 0;
                newElement.y = elementData.y || 0;
                newElement.name = elementData.name || newElement.type;

                // Apply fills
                if (elementData.fills && Array.isArray(elementData.fills)) {
                    newElement.fills = elementData.fills.map((fill: any) => {
                        if (fill.type === 'SOLID' && fill.color) {
                            return {
                                type: 'SOLID',
                                color: { r: fill.color.r, g: fill.color.g, b: fill.color.b },
                                opacity: fill.opacity !== undefined ? fill.opacity : 1,
                            };
                        }
                        return fill;
                    });
                }

                // Apply strokes
                if (elementData.strokes && Array.isArray(elementData.strokes)) {
                    newElement.strokes = elementData.strokes.map((stroke: any) => {
                        if (stroke.type === 'SOLID' && stroke.color) {
                            return {
                                type: 'SOLID',
                                color: { r: stroke.color.r, g: stroke.color.g, b: stroke.color.b },
                            };
                        }
                        return stroke;
                    });
                    if (elementData.strokeWeight !== undefined) {
                        newElement.strokeWeight = elementData.strokeWeight;
                    }
                }

                // Apply corner radius
                if (elementData.cornerRadius !== undefined && 'cornerRadius' in newElement) {
                    try {
                        (newElement as any).cornerRadius = elementData.cornerRadius;
                    } catch (e) {
                        // Some node types don't support cornerRadius
                    }
                }

                // Apply effects
                if (elementData.effects && Array.isArray(elementData.effects)) {
                    newElement.effects = elementData.effects.map((effect: any) => {
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
                if (elementData.opacity !== undefined) {
                    newElement.opacity = elementData.opacity;
                }

                // Apply typography for text
                if (newElement.type === 'TEXT' && elementData.fontSize) {
                    const textNode = newElement as TextNode;
                    if (elementData.fontSize) textNode.fontSize = elementData.fontSize;
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

                canvasFrame.appendChild(newElement);
                console.log(`Created ${elementData.type} element from JSON`);
            }
        } catch (e) {
            console.log('Error creating element from JSON:', e, elementData);
        }
    }
}

// Create missing elements and apply styles from context frame to canvas frame (legacy function, kept for fallback)
async function _createAndApplyElements(contextFrame: FrameNode, canvasFrame: FrameNode): Promise<void> {
    // Extract all elements from both frames
    function getAllElements(node: SceneNode): SceneNode[] {
        const elements: SceneNode[] = [];
        if ('children' in node) {
            node.children.forEach((child) => {
                elements.push(child);
                elements.push(...getAllElements(child));
            });
        }
        return elements;
    }

    const contextElements = getAllElements(contextFrame);
    const canvasElements = getAllElements(canvasFrame);

    // Group elements by type
    const contextByType = new Map<string, SceneNode[]>();
    const canvasByType = new Map<string, SceneNode[]>();

    contextElements.forEach(el => {
        if (!contextByType.has(el.type)) {
            contextByType.set(el.type, []);
        }
        contextByType.get(el.type)!.push(el);
    });

    canvasElements.forEach(el => {
        if (!canvasByType.has(el.type)) {
            canvasByType.set(el.type, []);
        }
        canvasByType.get(el.type)!.push(el);
    });

    // Create missing elements
    for (const [type, contextEls] of contextByType) {
        const canvasEls = canvasByType.get(type) || [];
        const missingCount = contextEls.length - canvasEls.length;
        
        if (missingCount > 0) {
            // Create missing elements based on context elements
            for (let i = canvasEls.length; i < contextEls.length; i++) {
                const contextEl = contextEls[i];
                let newElement: SceneNode | null = null;
                
                try {
                    if (type === 'ELLIPSE') {
                        const ellipse = figma.createEllipse();
                        ellipse.resize(contextEl.width, contextEl.height);
                        newElement = ellipse;
                    } else if (type === 'RECTANGLE') {
                        const rect = figma.createRectangle();
                        rect.resize(contextEl.width, contextEl.height);
                        newElement = rect;
                    } else if (type === 'POLYGON') {
                        const polygon = figma.createPolygon();
                        polygon.resize(contextEl.width, contextEl.height);
                        newElement = polygon;
                    } else if (type === 'STAR') {
                        const star = figma.createStar();
                        star.resize(contextEl.width, contextEl.height);
                        newElement = star;
                    } else if (type === 'VECTOR') {
                        // For vectors, we'll create a rectangle as a placeholder
                        // Full vector path recreation would be complex
                        const rect = figma.createRectangle();
                        rect.resize(contextEl.width, contextEl.height);
                        newElement = rect;
                    } else if (type === 'TEXT') {
                        const contextText = contextEl as TextNode;
                        if (contextText.fontName !== figma.mixed) {
                            await figma.loadFontAsync(contextText.fontName);
                            const text = figma.createText();
                            text.fontName = contextText.fontName;
                            text.fontSize = contextText.fontSize !== figma.mixed ? contextText.fontSize : 12;
                            text.characters = contextText.characters || 'Text';
                            newElement = text;
                        }
                    }
                    
                    if (newElement) {
                        // Position based on context element's position
                        // This maintains the relative positioning from the context frame
                        newElement.x = contextEl.x;
                        newElement.y = contextEl.y;
                        
                        // Apply styles from context element
                        await applyStylesToElement(contextEl, newElement);
                        
                        // Add to canvas frame
                        canvasFrame.appendChild(newElement);
                        
                        console.log(`Created ${type} element`);
                    }
                } catch (e) {
                    console.log(`Could not create ${type} element:`, e);
                }
            }
        }
    }
    
    // Now apply styles to existing elements
    await applyStylesFromContext(contextFrame, canvasFrame);
}

// Apply styles from a context element to a canvas element
async function applyStylesToElement(contextEl: SceneNode, canvasEl: SceneNode): Promise<void> {
    // Load fonts if needed
    if (contextEl.type === 'TEXT') {
        const textNode = contextEl as TextNode;
        if (textNode.fontName !== figma.mixed) {
            try {
                await figma.loadFontAsync(textNode.fontName);
            } catch (e) {
                console.log('Could not load font:', e);
            }
        }
    }
    
    // Apply fills
    if ('fills' in contextEl && 'fills' in canvasEl) {
        if (contextEl.fills !== figma.mixed && canvasEl.fills !== figma.mixed) {
            canvasEl.fills = contextEl.fills;
        }
    }
    
    // Apply strokes
    if ('strokes' in contextEl && 'strokes' in canvasEl) {
        if (Array.isArray(contextEl.strokes) && Array.isArray(canvasEl.strokes)) {
            canvasEl.strokes = contextEl.strokes;
        }
        if ('strokeWeight' in contextEl && 'strokeWeight' in canvasEl && typeof contextEl.strokeWeight === 'number') {
            canvasEl.strokeWeight = contextEl.strokeWeight;
        }
    }
    
    // Apply corner radius
    if ('cornerRadius' in contextEl && 'cornerRadius' in canvasEl) {
        if (typeof contextEl.cornerRadius === 'number') {
            try {
                const canvasWithRadius = canvasEl as FrameNode | RectangleNode | ComponentNode | InstanceNode;
                if ('cornerRadius' in canvasWithRadius && typeof canvasWithRadius.cornerRadius === 'number') {
                    canvasWithRadius.cornerRadius = contextEl.cornerRadius;
                }
            } catch (e) {
                // Some node types don't support cornerRadius
            }
        }
    }
    
    // Apply effects
    if ('effects' in contextEl && 'effects' in canvasEl) {
        canvasEl.effects = contextEl.effects;
    }
    
    // Apply typography (for text nodes)
    if (contextEl.type === 'TEXT' && canvasEl.type === 'TEXT') {
        const contextText = contextEl as TextNode;
        const canvasText = canvasEl as TextNode;
        
        try {
            if (contextText.fontName !== figma.mixed) {
                canvasText.fontName = contextText.fontName;
            }
            if (contextText.fontSize !== figma.mixed) {
                canvasText.fontSize = contextText.fontSize;
            }
            if (contextText.lineHeight !== figma.mixed) {
                canvasText.lineHeight = contextText.lineHeight;
            }
            if (contextText.letterSpacing !== figma.mixed) {
                canvasText.letterSpacing = contextText.letterSpacing;
            }
            if (contextText.textAlignHorizontal) {
                canvasText.textAlignHorizontal = contextText.textAlignHorizontal;
            }
        } catch (e) {
            console.log('Could not apply typography:', e);
        }
    }
    
    // Apply opacity
    if ('opacity' in contextEl && 'opacity' in canvasEl) {
        if (typeof contextEl.opacity === 'number') {
            canvasEl.opacity = contextEl.opacity;
        }
    }
}

// Extract and apply styles from context frame to canvas frame
async function applyStylesFromContext(contextFrame: FrameNode, canvasFrame: FrameNode): Promise<void> {
    // Extract all elements from both frames
    function getAllElements(node: SceneNode): SceneNode[] {
        const elements: SceneNode[] = [];
        if ('children' in node) {
            node.children.forEach((child) => {
                elements.push(child);
                elements.push(...getAllElements(child));
            });
        }
        return elements;
    }

    const contextElements = getAllElements(contextFrame);
    const canvasElements = getAllElements(canvasFrame);

    // Group elements by type
    const contextByType = new Map<string, SceneNode[]>();
    const canvasByType = new Map<string, SceneNode[]>();

    contextElements.forEach(el => {
        if (!contextByType.has(el.type)) {
            contextByType.set(el.type, []);
        }
        contextByType.get(el.type)!.push(el);
    });

    canvasElements.forEach(el => {
        if (!canvasByType.has(el.type)) {
            canvasByType.set(el.type, []);
        }
        canvasByType.get(el.type)!.push(el);
    });

    // Apply styles element-by-element by type and index
    for (const [type, contextEls] of contextByType) {
        const canvasEls = canvasByType.get(type) || [];
        const minCount = Math.min(contextEls.length, canvasEls.length);
        
        for (let i = 0; i < minCount; i++) {
            const contextEl = contextEls[i];
            const canvasEl = canvasEls[i];
            
            // Apply fills
            if ('fills' in contextEl && 'fills' in canvasEl) {
                if (contextEl.fills !== figma.mixed && canvasEl.fills !== figma.mixed) {
                    canvasEl.fills = contextEl.fills;
                }
            }
            
            // Apply strokes
            if ('strokes' in contextEl && 'strokes' in canvasEl) {
                if (Array.isArray(contextEl.strokes) && Array.isArray(canvasEl.strokes)) {
                    canvasEl.strokes = contextEl.strokes;
                }
                if ('strokeWeight' in contextEl && 'strokeWeight' in canvasEl && typeof contextEl.strokeWeight === 'number') {
                    canvasEl.strokeWeight = contextEl.strokeWeight;
                }
            }
            
            // Apply corner radius
            if ('cornerRadius' in contextEl && 'cornerRadius' in canvasEl) {
                if (typeof contextEl.cornerRadius === 'number') {
                    try {
                        const canvasWithRadius = canvasEl as FrameNode | RectangleNode | ComponentNode | InstanceNode;
                        if ('cornerRadius' in canvasWithRadius && typeof canvasWithRadius.cornerRadius === 'number') {
                            canvasWithRadius.cornerRadius = contextEl.cornerRadius;
                        }
                    } catch (e) {
                        // Some node types don't support cornerRadius
                    }
                }
            }
            
            // Apply effects
            if ('effects' in contextEl && 'effects' in canvasEl) {
                canvasEl.effects = contextEl.effects;
            }
            
            // Apply typography (for text nodes)
            if (contextEl.type === 'TEXT' && canvasEl.type === 'TEXT') {
                const contextText = contextEl as TextNode;
                const canvasText = canvasEl as TextNode;
                
                try {
                    // Load font first
                    if (contextText.fontName !== figma.mixed) {
                        await figma.loadFontAsync(contextText.fontName);
                        canvasText.fontName = contextText.fontName;
                    }
                    if (contextText.fontSize !== figma.mixed) {
                        canvasText.fontSize = contextText.fontSize;
                    }
                    if (contextText.lineHeight !== figma.mixed) {
                        canvasText.lineHeight = contextText.lineHeight;
                    }
                    if (contextText.letterSpacing !== figma.mixed) {
                        canvasText.letterSpacing = contextText.letterSpacing;
                    }
                    if (contextText.textAlignHorizontal) {
                        canvasText.textAlignHorizontal = contextText.textAlignHorizontal;
                    }
                } catch (e) {
                    console.log('Could not apply typography:', e);
                }
            }
            
            // Apply opacity
            if ('opacity' in contextEl && 'opacity' in canvasEl) {
                if (typeof contextEl.opacity === 'number') {
                    canvasEl.opacity = contextEl.opacity;
                }
            }
        }
    }
}

// Handle messages from UI
figma.ui.onmessage = async (msg) => {
    console.log('Plugin received message:', msg);
    
    if (msg.type === 'save-api-key') {
        await figma.clientStorage.setAsync('openai_api_key', msg.apiKey);
        console.log('API key saved to clientStorage');
    } else if (msg.type === 'get-api-key') {
        const apiKey = await figma.clientStorage.getAsync('openai_api_key');
        figma.ui.postMessage({
            type: 'api-key-loaded',
            apiKey: apiKey as string || '',
        });
    } else if (msg.type === 'select-context') {
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
            console.log('Selection is not a FRAME, it is:', selection[0].type);
            figma.ui.postMessage({
                type: 'error',
                message: 'Please select a frame to use as context',
            });
            return;
        }
        
        contextFrameId = selection[0].id;
        console.log('Context frame selected:', contextFrameId, selection[0].name);
        
        // Save to storage
        await figma.clientStorage.setAsync('context_frame_id', contextFrameId);
        
        figma.ui.postMessage({
            type: 'context-selected',
            frameId: contextFrameId,
            frameName: selection[0].name,
        });
    } else if (msg.type === 'select-canvas') {
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
        await figma.clientStorage.setAsync('canvas_frame_id', canvasFrameId);
        
        figma.ui.postMessage({
            type: 'canvas-selected',
            frameId: canvasFrameId,
            frameName: selection[0].name,
        });
    } else if (msg.type === 'match-style') {
        if (!contextFrameId || !canvasFrameId) {
            figma.ui.postMessage({
                type: 'error',
                message: 'Please select both context and canvas frames',
            });
            return;
        }

        if (!msg.apiKey) {
            figma.ui.postMessage({
                type: 'error',
                message: 'Please enter your OpenAI API key',
            });
            return;
        }

        const contextFrame = await figma.getNodeByIdAsync(contextFrameId) as FrameNode;
        const canvasFrame = await figma.getNodeByIdAsync(canvasFrameId) as FrameNode;

        if (!contextFrame || !canvasFrame) {
            figma.ui.postMessage({
                type: 'error',
                message: 'Could not find selected frames',
            });
            return;
        }

        try {
            figma.ui.postMessage({
                type: 'processing',
                message: 'Analyzing styles...',
            });

            // Serialize frames to text (for style description)
            const contextDescription = await serializeNodeToText(contextFrame);

            // Step 1: Generate style description from context frame
            figma.ui.postMessage({
                type: 'processing',
                message: 'Analyzing context frame style...',
            });

            const styleDescription = await generateStyleDescription(
                contextDescription,
                msg.apiKey
            );

            // Send style description to UI for display
            figma.ui.postMessage({
                type: 'style-description-generated',
                styleDescription: styleDescription,
            });

            // Step 2: Serialize frames to JSON
            const contextJSON = JSON.stringify(serializeNodeToJSON(contextFrame), null, 2);
            const canvasJSON = JSON.stringify(serializeNodeToJSON(canvasFrame), null, 2);

            // Step 3: Generate JSON representation of elements to create/modify
            figma.ui.postMessage({
                type: 'processing',
                message: 'Generating element JSON...',
            });

            const elementJSON = await generateElementJSON(
                styleDescription,
                contextJSON,
                canvasJSON,
                msg.apiKey
            );

            // Send JSON to UI for display
            figma.ui.postMessage({
                type: 'modification-instructions-generated',
                modificationInstructions: elementJSON,
            });

            // Parse and apply JSON
            try {
                const elements = JSON.parse(elementJSON);
                const elementsArray = Array.isArray(elements) ? elements : (elements.elements || []);
                await applyElementsFromJSON(elementsArray, canvasFrame);
            } catch (e) {
                console.log('Could not parse or apply JSON:', e);
                figma.notify('Generated JSON but could not apply it. Check the output.');
            }

            // JSON-based creation is handled above

            figma.ui.postMessage({
                type: 'processing',
                message: 'Complete!',
            });

            figma.notify('Styles applied!');
        } catch (error) {
            figma.ui.postMessage({
                type: 'error',
                message: error instanceof Error ? error.message : 'Failed to match styles',
            });
            figma.notify('Error: ' + (error instanceof Error ? error.message : 'Unknown error'));
        }
    }
};

