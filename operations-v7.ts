// ============================================================================
// OPERATIONS V7
// Converts constraint-based actions into structured JSON operations
// Uses: gpt-4o-2024-08-06 with temperature 0.2
// OPTIMIZATION: Shortened prompts - Removed verbose explanations, examples, and detailed instructions
// This reduces token count significantly, potentially speeding up API calls
// ============================================================================

import { ExecutionPlan, ExecutionOperation, APICallInfo, ConstraintBasedPlan } from './execution';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Collects current Figma page DOM information for LLM context
 */
function collectFigmaDOMInfo(): string {
    const nodes: Array<{
        id: string;
        name: string;
        type: string;
        parent?: string;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        textContent?: string;
    }> = [];

    function collectNodeInfo(node: SceneNode, parentName?: string) {
        const nodeInfo: any = {
            id: node.id,
            name: node.name,
            type: node.type,
        };

        if (parentName) {
            nodeInfo.parent = parentName;
        }

        if ('x' in node && 'y' in node) {
            nodeInfo.x = node.x;
            nodeInfo.y = node.y;
        }

        if ('width' in node && 'height' in node) {
            nodeInfo.width = node.width;
            nodeInfo.height = node.height;
        }

        // For text nodes, include text content
        if (node.type === 'TEXT') {
            const textNode = node as TextNode;
            try {
                nodeInfo.textContent = textNode.characters;
            } catch {
                // Font may not be loaded
            }
        }

        nodes.push(nodeInfo);

        // Recursively collect children
        if ('children' in node) {
            for (const child of node.children) {
                collectNodeInfo(child, node.name);
            }
        }
    }

    // Collect all nodes from current page
    for (const node of figma.currentPage.children) {
        collectNodeInfo(node);
    }

    return JSON.stringify(nodes, null, 2);
}

// ============================================================================
// CONSTRAINT TO NATURAL LANGUAGE
// ============================================================================

/**
 * Converts constraint-based actions to natural language operations
 */
export async function convertConstraintsToNaturalLanguage(
    constraintPlan: ConstraintBasedPlan,
    apiKey: string
): Promise<{ naturalLanguageOperations: string; apiCall: APICallInfo }> {
    const prompt = `Convert constraint-based design actions to natural language operations with exact values.

**CONSTRAINT-BASED ACTIONS:**
${JSON.stringify(constraintPlan, null, 2)}

**RULES:**
- Resolve constraints to exact x, y, width, height, RGB (0-1 range)
- For text boxes: create container first, then text inside with padding
- Coordinates: top-left corner, Figma system (y increases downward)
- Calculate exact values, no approximations

**OUTPUT:** Numbered list of operations with action (ADD/MODIFY), type, name, position, size, colors, container, and text properties if applicable.`;

    const requestBody = {
        model: 'gpt-4o-2024-08-06',
        messages: [
            {
                role: 'system',
                content: 'You are a design reasoning assistant that converts constraint-based actions into precise natural language operation descriptions with exact calculated values.'
            },
            {
                role: 'user',
                content: prompt
            }
        ],
        temperature: 0.2, // V1: Standard temperature for balanced creativity and determinism
    };

    const requestHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.substring(0, 7)}...`, // Mask API key in logs
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
    });

    const responseData = await response.json();

    const apiCall: APICallInfo = {
        request: {
            url: 'https://api.openai.com/v1/chat/completions',
            method: 'POST',
            headers: requestHeaders,
            body: requestBody,
        },
        response: {
            status: response.status,
            statusText: response.statusText,
            body: responseData,
        },
        timestamp: Date.now(),
    };

    if (!response.ok) {
        throw new Error(responseData.error?.message || 'Failed to convert constraints to natural language');
    }

    const naturalLanguageOperations = responseData.choices[0]?.message?.content || '';

    return { naturalLanguageOperations, apiCall };
}

// ============================================================================
// NATURAL LANGUAGE TO JSON OPERATIONS
// ============================================================================

/**
 * Converts natural language operations to structured execution plan (JSON)
 */
export async function parseNaturalLanguageOperations(
    naturalLanguageOperations: string,
    apiKey: string
): Promise<{ plan: ExecutionPlan; apiCall: APICallInfo }> {
    // Collect current Figma DOM information for exact node ID matching
    const domInfo = collectFigmaDOMInfo();

    const prompt = `Convert natural language operations to JSON for Figma.

**DOM:**
${domInfo}

**OPERATIONS:**
${naturalLanguageOperations}

**TEXT BOX RULES:**
- Create container first, then text inside
- textBoxId matches container name exactly
- Text position (x, y) is relative to container (x = padding.left, y = padding.top)
- Padding: 8-16px top/bottom, 12-16px left/right
- fontSize: 14-16px inputs, 12-14px labels
- textAlign: LEFT inputs, CENTER buttons

**MODIFY OPERATIONS:**
- Use exact node ID from DOM for targetId
- Match by type first, then name
- One operation per unique targetId

**REQUIREMENTS:**
- Action: "add" or "modify"
- Type, name, position (x, y top-left), size (width, height), fills, strokes, container
- For text: textContent, fontSize, textAlign, textBoxId, padding, fontFamily, fontWeight
- RGB 0-1 range, coordinates top-left corner
- All schema properties required (use defaults for unused fields)

**SCHEMA:** All properties required. Use empty strings/0/[] for unused fields.`;

    const schema = {
        type: "object",
        properties: {
            operations: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        action: {
                            type: "string",
                            enum: ["add", "modify"],
                            description: "Operation action: 'add' to create new shape, 'modify' to change existing shape"
                        },
                        type: {
                            type: "string",
                            enum: ["circle", "ellipse", "rectangle", "frame", "text", "line", "polygon", "star", "vector", "arrow"],
                            description: "Type of object (required for add operations, can be empty string for modify operations)"
                        },
                        name: {
                            type: "string",
                            description: "Name of the object"
                        },
                        x: {
                            type: "number",
                            description: "Top-left x coordinate relative to parent container"
                        },
                        y: {
                            type: "number",
                            description: "Top-left y coordinate relative to parent container"
                        },
                        width: {
                            type: "number",
                            description: "Width in pixels"
                        },
                        height: {
                            type: "number",
                            description: "Height in pixels"
                        },
                        radius: {
                            type: "number",
                            description: "Radius for circles (alternative to width/height)"
                        },
                        fills: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    type: { type: "string", enum: ["SOLID"] },
                                    color: {
                                        type: "object",
                                        properties: {
                                            r: { type: "number", minimum: 0, maximum: 1 },
                                            g: { type: "number", minimum: 0, maximum: 1 },
                                            b: { type: "number", minimum: 0, maximum: 1 }
                                        },
                                        required: ["r", "g", "b"],
                                        additionalProperties: false
                                    },
                                    opacity: { type: "number", minimum: 0, maximum: 1 }
                                },
                                required: ["type", "color", "opacity"],
                                additionalProperties: false
                            },
                            description: "Fill colors array. Opacity defaults to 1 if not specified."
                        },
                        strokes: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    type: { type: "string", enum: ["SOLID"] },
                                    color: {
                                        type: "object",
                                        properties: {
                                            r: { type: "number", minimum: 0, maximum: 1 },
                                            g: { type: "number", minimum: 0, maximum: 1 },
                                            b: { type: "number", minimum: 0, maximum: 1 }
                                        },
                                        required: ["r", "g", "b"],
                                        additionalProperties: false
                                    },
                                    opacity: { type: "number", minimum: 0, maximum: 1 }
                                },
                                required: ["type", "color", "opacity"],
                                additionalProperties: false
                            },
                            description: "Stroke colors array. Opacity defaults to 1 if not specified."
                        },
                        strokeWeight: {
                            type: "number",
                            description: "Stroke weight in pixels"
                        },
                        container: {
                            type: "string",
                            description: "Name or ID of parent container"
                        },
                        targetId: {
                            type: "string",
                            description: "ID of object to modify (for modify operations)"
                        },
                        targetDescription: {
                            type: "string",
                            description: "Description to identify shape to modify (alternative to targetId)"
                        },
                        cornerRadius: {
                            type: "number",
                            description: "Corner radius for rectangles"
                        },
                        pointCount: {
                            type: "number",
                            description: "Number of points for polygon or star"
                        },
                        innerRadius: {
                            type: "number",
                            description: "Inner radius for stars (0-1 range)"
                        },
                        vectorPaths: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    windingRule: {
                                        type: "string",
                                        enum: ["NONZERO", "EVENODD"],
                                        description: "Winding rule for the vector path (defaults to NONZERO if not specified)"
                                    },
                                    data: {
                                        type: "string",
                                        description: "SVG path data string"
                                    }
                                },
                                required: ["windingRule", "data"],
                                additionalProperties: false
                            },
                            description: "Vector paths array for vector shapes (Figma API structure). WindingRule defaults to NONZERO if not specified."
                        },
                        rotation: {
                            type: "number",
                            description: "Rotation in degrees"
                        },
                        opacity: {
                            type: "number",
                            minimum: 0,
                            maximum: 1,
                            description: "Opacity (0-1)"
                        },
                        textContent: {
                            type: "string",
                            description: "Text content to display (for text operations)"
                        },
                        fontSize: {
                            type: "number",
                            description: "Font size in pixels (for text operations)"
                        },
                        textAlign: {
                            type: "string",
                            enum: ["LEFT", "CENTER", "RIGHT", "JUSTIFIED"],
                            description: "Text alignment (for text operations)"
                        },
                        textBoxId: {
                            type: "string",
                            description: "ID or name of text box container to overlay text into"
                        },
                        textBoxDescription: {
                            type: "string",
                            description: "Description to identify text box container"
                        },
                        padding: {
                            type: "object",
                            properties: {
                                top: {
                                    type: "number",
                                    description: "Top padding in pixels"
                                },
                                right: {
                                    type: "number",
                                    description: "Right padding in pixels"
                                },
                                bottom: {
                                    type: "number",
                                    description: "Bottom padding in pixels"
                                },
                                left: {
                                    type: "number",
                                    description: "Left padding in pixels"
                                }
                            },
                            required: ["top", "right", "bottom", "left"],
                            additionalProperties: false,
                            description: "Padding inside text box for text positioning. All values are required but can be 0."
                        },
                        fontFamily: {
                            type: "string",
                            description: "Font family name (e.g., 'Inter', 'Roboto')"
                        },
                        fontWeight: {
                            type: "number",
                            description: "Font weight (e.g., 400, 500, 600, 700)"
                        }
                    },
                    required: [
                        "action",
                        "type",
                        "name",
                        "x",
                        "y",
                        "width",
                        "height",
                        "radius",
                        "fills",
                        "strokes",
                        "strokeWeight",
                        "container",
                        "targetId",
                        "targetDescription",
                        "cornerRadius",
                        "pointCount",
                        "innerRadius",
                        "vectorPaths",
                        "rotation",
                        "opacity",
                        "textContent",
                        "fontSize",
                        "textAlign",
                        "textBoxId",
                        "textBoxDescription",
                        "padding",
                        "fontFamily",
                        "fontWeight"
                    ],
                    additionalProperties: false
                }
            },
            summary: {
                type: "string",
                description: "Brief summary of operations"
            }
        },
        required: ["operations", "summary"],
        additionalProperties: false
    };

    const requestBody = {
        model: 'gpt-4o-2024-08-06',
        messages: [
            {
                role: 'system',
                content: 'You are a design execution assistant that converts natural language operation descriptions into precise JSON operations for Figma.'
            },
            {
                role: 'user',
                content: prompt
            }
        ],
        response_format: {
            type: 'json_schema',
            json_schema: {
                name: 'execution_plan',
                strict: true,
                schema: schema
            }
        },
        temperature: 0.2, // V1: Standard temperature for balanced creativity and determinism
    };

    const requestHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.substring(0, 7)}...`, // Mask API key in logs
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
    });

    const responseData = await response.json();

    const apiCall: APICallInfo = {
        request: {
            url: 'https://api.openai.com/v1/chat/completions',
            method: 'POST',
            headers: requestHeaders,
            body: requestBody,
        },
        response: {
            status: response.status,
            statusText: response.statusText,
            body: responseData,
        },
        timestamp: Date.now(),
    };

    if (!response.ok) {
        throw new Error(responseData.error?.message || 'Failed to parse natural language operations');
    }

    const content = responseData.choices[0]?.message?.content || '{"operations":[]}';
    const plan = JSON.parse(content) as ExecutionPlan;

    return { plan, apiCall };
}

// ============================================================================
// ORCHESTRATOR
// ============================================================================

/**
 * Converts constraint-based actions or natural language description to structured execution plan
 * If input is constraint-based JSON, it first converts to natural language, then to operations
 */
export async function parseExecutionPlan(
    input: string | ConstraintBasedPlan,
    apiKey: string
): Promise<{ plan: ExecutionPlan; apiCalls: APICallInfo[] }> {
    const apiCalls: APICallInfo[] = [];

    // Check if input is constraint-based JSON or natural language string
    if (typeof input === 'object' && 'actions' in input) {
        // Input is constraint-based JSON - two-stage conversion
        // Stage 1: Convert constraints to natural language
        const { naturalLanguageOperations, apiCall: apiCall1 } = await convertConstraintsToNaturalLanguage(
            input as ConstraintBasedPlan,
            apiKey
        );
        apiCalls.push(apiCall1);

        // Stage 2: Convert natural language to operations JSON
        const { plan, apiCall: apiCall2 } = await parseNaturalLanguageOperations(
            naturalLanguageOperations,
            apiKey
        );
        apiCalls.push(apiCall2);

        return { plan, apiCalls };
    } else {
        // Input is natural language string - single-stage conversion
        const { plan, apiCall } = await parseNaturalLanguageOperations(
            input as string,
            apiKey
        );
        apiCalls.push(apiCall);

        return { plan, apiCalls };
    }
}

