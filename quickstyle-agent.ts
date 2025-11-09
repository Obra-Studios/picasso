// ============================================================================
// QUICKSTYLE AGENT
// Quickly applies styling to new elements based on context patterns
// ============================================================================

import { fetchWithRetry } from './api-utils';

export interface QuickStyleSuggestion {
    // Fill colors (empty array if not applicable)
    fills: Array<{
        type: 'SOLID';
        color: { r: number; g: number; b: number };
        opacity: number;
    }>;
    
    // Stroke colors (empty array if not applicable)
    strokes: Array<{
        type: 'SOLID';
        color: { r: number; g: number; b: number };
        opacity: number;
    }>;
    strokeWeight: number | null;
    
    // Border radius (null if not applicable)
    cornerRadius: number | null;
    
    // Text properties (null if not text element)
    fontSize: number | null;
    fontFamily: string | null;
    fontWeight: number | null;
    
    // Reasoning for the suggestion
    reasoning: string;
    
    // Confidence level
    confidence: 'high' | 'medium' | 'low';
}

/**
 * Analyzes a newly added element and suggests styling to match context patterns
 */
export async function suggestQuickStyle(
    addedElement: {
        id: string;
        name: string;
        type: string;
        x: number;
        y: number;
        width: number;
        height: number;
    },
    contextJSON: Record<string, unknown>,
    apiKey: string
): Promise<QuickStyleSuggestion> {
    const prompt = `You are a quick styling agent. A user just added a new element to their canvas. Your task is to suggest styling that matches similar elements in the context frame.

**NEWLY ADDED ELEMENT:**
Type: ${addedElement.type}
Name: ${addedElement.name}
Size: ${addedElement.width}×${addedElement.height}

**CONTEXT FRAME (reference design with existing elements):**
${JSON.stringify(contextJSON, null, 2)}

**YOUR TASK:**
1. Find the MOST SIMILAR element in the context frame based on:
   - Element type (e.g., TEXT matches TEXT, RECTANGLE matches RECTANGLE)
   - Element name (e.g., "button" matches other buttons, "input" matches inputs)
   - Element size (similar dimensions suggest similar purpose)

2. Extract styling properties from the most similar element:
   - **Fills**: Copy the fill colors (array of {type, color: {r, g, b}, opacity})
   - **Strokes**: Copy stroke colors and strokeWeight
   - **Corner Radius**: For rectangles, copy cornerRadius
   - **Fonts**: For text, copy fontSize, fontFamily, fontWeight

3. Return ONLY the styling properties that are relevant to this element type:
   - Use empty array [] for fills/strokes if not applicable
   - Use null for fontSize, fontFamily, fontWeight if not a text element
   - Use null for cornerRadius if not applicable
   - Use null for strokeWeight if no strokes

4. Provide reasoning explaining which element you matched and why

**IMPORTANT:**
- Colors are in 0-1 range (r: 0.5 = 128 in 0-255 range)
- Use empty arrays [] for fills/strokes when not applicable
- Use null for number/string properties that don't apply to this element type
- Be conservative: only suggest styles you're confident about
- Confidence should be 'high' if there's a clear match, 'medium' if it's a good guess, 'low' if uncertain

**EXAMPLES:**
- Added element: RECTANGLE named "submit-button" 100×40
  Match: RECTANGLE "login-button" in context with similar size
  → Copy its fills (primary color), cornerRadius (8), strokes
  
- Added element: TEXT named "Email" 14px
  Match: TEXT "Username" in context
  → Copy fontSize (14), fontFamily ("Inter"), fontWeight (400)

Return your suggestion in the response format.`;

    const responseSchema = {
        type: "object",
        properties: {
            fills: {
                type: "array",
                description: "Fill colors for the element",
                items: {
                    type: "object",
                    properties: {
                        type: {
                            type: "string",
                            enum: ["SOLID"],
                        },
                        color: {
                            type: "object",
                            properties: {
                                r: { type: "number" },
                                g: { type: "number" },
                                b: { type: "number" },
                            },
                            required: ["r", "g", "b"],
                            additionalProperties: false,
                        },
                        opacity: {
                            type: "number",
                            description: "Opacity from 0 to 1, defaults to 1.0 if not specified",
                        },
                    },
                    required: ["type", "color", "opacity"],
                    additionalProperties: false,
                },
            },
            strokes: {
                type: "array",
                description: "Stroke colors for the element",
                items: {
                    type: "object",
                    properties: {
                        type: {
                            type: "string",
                            enum: ["SOLID"],
                        },
                        color: {
                            type: "object",
                            properties: {
                                r: { type: "number" },
                                g: { type: "number" },
                                b: { type: "number" },
                            },
                            required: ["r", "g", "b"],
                            additionalProperties: false,
                        },
                        opacity: {
                            type: "number",
                            description: "Opacity from 0 to 1, defaults to 1.0 if not specified",
                        },
                    },
                    required: ["type", "color", "opacity"],
                    additionalProperties: false,
                },
            },
            strokeWeight: {
                type: ["number", "null"],
                description: "Stroke weight in pixels, or null if not applicable",
            },
            cornerRadius: {
                type: ["number", "null"],
                description: "Corner radius in pixels (for rectangles), or null if not applicable",
            },
            fontSize: {
                type: ["number", "null"],
                description: "Font size in pixels (for text elements), or null if not applicable",
            },
            fontFamily: {
                type: ["string", "null"],
                description: "Font family name (for text elements), or null if not applicable",
            },
            fontWeight: {
                type: ["number", "null"],
                description: "Font weight (for text elements), or null if not applicable",
            },
            reasoning: {
                type: "string",
                description: "Explanation of which element was matched and why",
            },
            confidence: {
                type: "string",
                enum: ["high", "medium", "low"],
                description: "Confidence level in the suggestion",
            },
        },
        required: ["fills", "strokes", "strokeWeight", "cornerRadius", "fontSize", "fontFamily", "fontWeight", "reasoning", "confidence"],
        additionalProperties: false,
    };

    const response = await fetchWithRetry({
        url: 'https://api.openai.com/v1/chat/completions',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: 'gpt-4o-2024-08-06',
            messages: [
                {
                    role: 'system',
                    content: 'You are a design styling expert that helps match new elements to existing design patterns.',
                },
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "quickstyle_suggestion",
                    strict: true,
                    schema: responseSchema
                }
            },
            temperature: 0.3,
        }),
    });

    if (!response.ok) {
        const error = await response.json() as { error?: { message?: string } };
        throw new Error(error.error?.message || 'Quickstyle API error');
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
        throw new Error('No content in quickstyle response');
    }

    return JSON.parse(content);
}

/**
 * Applies quick styling suggestions to a Figma node
 */
export async function applyQuickStyle(
    nodeId: string,
    suggestion: QuickStyleSuggestion
): Promise<{ success: boolean; applied: string[] }> {
    const applied: string[] = [];
    
    try {
        const node = await figma.getNodeByIdAsync(nodeId);
        
        if (!node) {
            return { success: false, applied: [] };
        }
        
        // Apply fills
        if (suggestion.fills && suggestion.fills.length > 0 && 'fills' in node) {
            (node as MinimalFillsMixin).fills = suggestion.fills;
            applied.push('fills');
        }
        
        // Apply strokes
        if (suggestion.strokes && suggestion.strokes.length > 0 && 'strokes' in node) {
            (node as MinimalStrokesMixin).strokes = suggestion.strokes;
            applied.push('strokes');
        }
        
        if (suggestion.strokeWeight !== undefined && suggestion.strokeWeight !== null && 'strokeWeight' in node) {
            (node as MinimalStrokesMixin).strokeWeight = suggestion.strokeWeight;
            applied.push('strokeWeight');
        }
        
        // Apply corner radius
        if (suggestion.cornerRadius !== undefined && suggestion.cornerRadius !== null && 'cornerRadius' in node) {
            (node as RectangleNode).cornerRadius = suggestion.cornerRadius;
            applied.push('cornerRadius');
        }
        
        // Apply text properties
        if (node.type === 'TEXT') {
            const textNode = node as TextNode;
            
            if (suggestion.fontSize !== undefined && suggestion.fontSize !== null) {
                await figma.loadFontAsync(textNode.fontName as FontName);
                textNode.fontSize = suggestion.fontSize;
                applied.push('fontSize');
            }
            
            if ((suggestion.fontFamily !== undefined && suggestion.fontFamily !== null) || 
                (suggestion.fontWeight !== undefined && suggestion.fontWeight !== null)) {
                const family = suggestion.fontFamily || (textNode.fontName as FontName).family;
                const weight = suggestion.fontWeight || 400;
                
                // Map weight to style
                const weightToStyle = (w: number): string => {
                    if (w <= 300) return 'Light';
                    if (w <= 400) return 'Regular';
                    if (w <= 500) return 'Medium';
                    if (w <= 600) return 'Semi Bold';
                    if (w <= 700) return 'Bold';
                    return 'Extra Bold';
                };
                
                const style = weightToStyle(weight);
                
                try {
                    await figma.loadFontAsync({ family, style });
                    textNode.fontName = { family, style };
                    applied.push('fontFamily');
                } catch {
                    // Try with Regular if the specific weight doesn't exist
                    try {
                        await figma.loadFontAsync({ family, style: 'Regular' });
                        textNode.fontName = { family, style: 'Regular' };
                        applied.push('fontFamily');
                    } catch {
                        console.log(`Could not load font: ${family} ${style}`);
                    }
                }
            }
        }
        
        return { success: true, applied };
    } catch (error) {
        console.error('Error applying quickstyle:', error);
        return { success: false, applied };
    }
}

