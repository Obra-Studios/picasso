// Frame Serialization - Converts Figma frames to JSON for LLM processing

/**
 * Serialize a Figma node to JSON for LLM processing
 * Captures all relevant visual and structural properties
 */
export function serializeNodeToJSON(node: SceneNode): Record<string, unknown> {
    // Positions are already relative to the frame (absolute in frame coordinates)
    const json: Record<string, unknown> = {
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

    // Children (recursively serialize)
    if ('children' in node && node.children.length > 0) {
        json.children = node.children.map((child) => serializeNodeToJSON(child));
    }

    return json;
}

/**
 * Serialize a Figma frame to JSON
 * Main entry point for frame serialization
 */
export function serializeFrame(frame: FrameNode): Record<string, unknown> {
    return serializeNodeToJSON(frame);
}

