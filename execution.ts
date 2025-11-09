// ============================================================================
// EXECUTION AGENT
// Converts natural language action descriptions into Figma DOM modifications
// ============================================================================

export interface ExecutionOperation {
    action: 'add' | 'modify';
    type?: 'circle' | 'rectangle' | 'ellipse' | 'frame' | 'text' | 'line' | 'polygon' | 'star' | 'vector' | 'arrow';
    name?: string;
    x?: number; // Top-left x coordinate
    y?: number; // Top-left y coordinate
    width?: number;
    height?: number;
    radius?: number; // For circles
    fills?: Array<{
        type: 'SOLID';
        color: { r: number; g: number; b: number };
        opacity?: number;
    }>;
    strokes?: Array<{
        type: 'SOLID';
        color: { r: number; g: number; b: number };
        opacity?: number;
    }>;
    strokeWeight?: number;
    container?: string; // Name or ID of parent container
    targetId?: string; // For MODIFY operations - ID of object to modify
    targetDescription?: string; // Alternative for MODIFY - description to identify shape
    cornerRadius?: number; // For rectangles
    pointCount?: number; // For polygon/star
    innerRadius?: number; // For star
    vectorPaths?: Array<{
        windingRule?: 'NONZERO' | 'EVENODD';
        data: string;
    }>; // For vector shapes - matches Figma API
    rotation?: number;
    opacity?: number;
}

export interface ExecutionPlan {
    operations: ExecutionOperation[];
    summary?: string;
}

export interface APICallInfo {
    request: {
        url: string;
        method: string;
        headers: Record<string, string>;
        body: any;
    };
    response: {
        status: number;
        statusText: string;
        body: any;
    };
    timestamp: number;
}

/**
 * Converts natural language description to structured execution plan
 */
export async function parseExecutionPlan(
    naturalLanguageDescription: string,
    apiKey: string
): Promise<{ plan: ExecutionPlan; apiCall: APICallInfo }> {
    const prompt = `You are an expert at converting natural language design instructions into structured JSON operations for a Figma plugin.

The user has provided a natural language description of design modifications. Your task is to convert this into a structured JSON format that specifies exactly what objects to ADD or MODIFY.

**INPUT DESCRIPTION:**
${naturalLanguageDescription}

**REQUIREMENTS:**
1. Parse all ADD operations - these create new objects
2. Parse all MODIFY operations - these modify existing objects (identified by targetId or targetDescription)
3. For each operation, extract:
   - Action: "add" or "modify"
   - Type: "circle", "rectangle", "ellipse", "polygon", "star", "line", "vector", "arrow" (required for add)
   - Position: x, y coordinates (top-left corner)
   - Size: width, height in pixels (or radius for circles)
   - Fills: array of color objects with type "SOLID", color {r, g, b}, and opacity
   - Strokes: array of color objects with type "SOLID", color {r, g, b}, and opacity
   - Stroke weight (if specified)
   - Container/parent name (if specified)
   - Type-specific properties (cornerRadius for rectangles, pointCount for polygons/stars, innerRadius for stars, vectorPaths array for vectors)
   - For MODIFY: targetId or targetDescription to identify the shape to modify

**IMPORTANT:**
- All coordinates are in Figma's coordinate system (top-left origin, y increases downward)
- x, y coordinates represent the TOP-LEFT corner of the object, not the center
- RGB values must be in 0-1 range (divide by 255 if given as 0-255)
- Fills and strokes should be arrays with objects: [{"type": "SOLID", "color": {"r": 1, "g": 0, "b": 0}, "opacity": 1}]
- If position is calculated (e.g., "midpoint between X and Y"), calculate the exact coordinates
- If size is specified as a single value (e.g., "10px"), use it for both width and height for circles
- For circles, you can use either radius (which will create diameter = radius * 2) or width/height
- Always include a name for new objects if one is mentioned

**OUTPUT FORMAT:**
Return a JSON object with this structure (matching Figma API properties):
{
  "operations": [
    {
      "action": "add" | "modify",
      "type": "circle" | "rectangle" | "ellipse" | "polygon" | "star" | "line" | "vector" | "arrow",
      "name": "Shape Name",
      "x": 100,
      "y": 200,
      "width": 50,
      "height": 50,
      "fills": [{"type": "SOLID", "color": {"r": 1, "g": 0, "b": 0}, "opacity": 1}],
      "strokes": [{"type": "SOLID", "color": {"r": 0, "g": 0, "b": 0}, "opacity": 1}],
      "strokeWeight": 0,
      "opacity": 1,
      "rotation": 0,
      "cornerRadius": 0,
      "pointCount": 5,
      "innerRadius": 0.5,
      "vectorPaths": [{"windingRule": "NONZERO", "data": "M 0 0 L 100 100"}],
      "container": "Frame 1",
      "targetId": "shape-id" (for modify operations)
    }
  ],
  "summary": "Brief summary of what will be executed"
}

Note: Properties match Figma API exactly - use only the properties relevant to each shape type.

Be precise and extract all operations from the description.`;

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
                        "opacity"
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
                content: 'You are an expert at parsing natural language design instructions and converting them to structured JSON operations for Figma. Be precise and extract all operations accurately.',
            },
            {
                role: 'user',
                content: prompt,
            }
        ],
        response_format: {
            type: "json_schema",
            json_schema: {
                name: "execution_plan",
                strict: true,
                schema: schema
            }
        },
        temperature: 0.2,
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
        throw new Error(responseData.error?.message || 'Failed to parse execution plan');
    }

    const content = responseData.choices[0]?.message?.content || '{"operations":[]}';
    const plan = JSON.parse(content);

    return { plan, apiCall };
}

/**
 * Executes the plan by creating/modifying objects in Figma
 */
export async function executePlan(plan: ExecutionPlan): Promise<{
    success: boolean;
    created: number;
    modified: number;
    errors: string[];
}> {
    const results = {
        success: true,
        created: 0,
        modified: 0,
        errors: [] as string[],
    };

    // Find containers by name (cache for efficiency)
    const containerCache = new Map<string, SceneNode>();

    function findContainer(name: string): SceneNode | null {
        if (containerCache.has(name)) {
            return containerCache.get(name)!;
        }

        // Normalize the search name (lowercase, remove spaces/dashes)
        const normalizeName = (n: string) => n.toLowerCase().replace(/[\s\-_]/g, '');

        // Search all nodes recursively
        function searchNode(node: SceneNode): SceneNode | null {
            // Try exact match first
            if (node.name === name) {
                return node;
            }

            // Try case-insensitive match
            if (node.name.toLowerCase() === name.toLowerCase()) {
                return node;
            }

            // Try normalized match (ignore spaces, dashes, underscores)
            if (normalizeName(node.name) === normalizeName(name)) {
                return node;
            }

            // Try partial match (name contains the search term or vice versa)
            const nodeNameNorm = normalizeName(node.name);
            const searchNameNorm = normalizeName(name);
            if (nodeNameNorm.includes(searchNameNorm) || searchNameNorm.includes(nodeNameNorm)) {
                return node;
            }

            if ('children' in node) {
                for (const child of node.children) {
                    const found = searchNode(child);
                    if (found) return found;
                }
            }
            return null;
        }

        // Search from current page
        for (const node of figma.currentPage.children) {
            const found = searchNode(node);
            if (found) {
                containerCache.set(name, found);
                return found;
            }
        }

        // Also try to find by ID if name looks like an ID
        try {
            const nodeById = figma.getNodeById(name);
            if (nodeById && nodeById.type !== 'PAGE' && 'appendChild' in nodeById) {
                containerCache.set(name, nodeById as SceneNode);
                return nodeById as SceneNode;
            }
        } catch {
            // Not a valid ID, continue
        }

        return null;
    }

    function findNodeById(id: string): SceneNode | null {
        try {
            return figma.getNodeById(id) as SceneNode | null;
        } catch {
            return null;
        }
    }

    // Get all available shapes for finding by description
    const availableShapes: SceneNode[] = [];
    function collectShapes(node: SceneNode) {
        const supportedTypes = ['RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'VECTOR', 'LINE'];
        if (supportedTypes.indexOf(node.type) !== -1) {
            availableShapes.push(node);
        }
        if ('children' in node) {
            for (const child of node.children) {
                collectShapes(child);
            }
        }
    }
    for (const node of figma.currentPage.children) {
        collectShapes(node);
    }

    function findShapeByIdOrDescription(targetId?: string, targetDescription?: string): SceneNode | null {
        if (targetId) {
            // Try to find by ID first
            const found = findNodeById(targetId);
            if (found) return found;
        }
        if (targetDescription) {
            // Try to find by description (match name or type)
            const descLower = targetDescription.toLowerCase();
            for (const shape of availableShapes) {
                const nameMatch = shape.name && shape.name.toLowerCase().includes(descLower);
                const typeMatch = shape.type.toLowerCase().includes(descLower);
                if (nameMatch || typeMatch) {
                    return shape;
                }
            }
        }
        return null;
    }

    for (const operation of plan.operations) {
        try {
            if (operation.action === 'add') {
                // Create new object
                if (!operation.type) {
                    results.errors.push(`ADD operation missing type: ${JSON.stringify(operation)}`);
                    continue;
                }

                const normalizedType = operation.type.toLowerCase();
                let newNode: SceneNode | null = null;

                // Create the appropriate shape
                switch (normalizedType) {
                    case 'circle':
                        newNode = figma.createEllipse();
                        if (operation.radius !== undefined) {
                            newNode.resize(operation.radius * 2, operation.radius * 2);
                        } else if (operation.width !== undefined && operation.height !== undefined) {
                            newNode.resize(operation.width, operation.height);
                        }
                        break;

                    case 'ellipse':
                        newNode = figma.createEllipse();
                        if (operation.width !== undefined && operation.height !== undefined) {
                            newNode.resize(operation.width, operation.height);
                        }
                        break;

                    case 'rectangle':
                        newNode = figma.createRectangle();
                        if (operation.width !== undefined && operation.height !== undefined) {
                            newNode.resize(operation.width, operation.height);
                        }
                        if (operation.cornerRadius !== undefined) {
                            newNode.cornerRadius = operation.cornerRadius;
                        }
                        break;

                    case 'frame':
                        newNode = figma.createFrame();
                        if (operation.width !== undefined && operation.height !== undefined) {
                            newNode.resize(operation.width, operation.height);
                        }
                        break;

                    case 'text':
                        newNode = figma.createText();
                        // Note: Text content would need to be set separately
                        break;

                    case 'line':
                        newNode = figma.createLine();
                        if (operation.width !== undefined) {
                            newNode.resize(operation.width, 0);
                        }
                        break;

                    case 'polygon':
                        newNode = figma.createPolygon();
                        if (operation.pointCount !== undefined) {
                            newNode.pointCount = operation.pointCount;
                        }
                        if (operation.width !== undefined && operation.height !== undefined) {
                            newNode.resize(operation.width, operation.height);
                        }
                        break;

                    case 'star':
                        newNode = figma.createStar();
                        if (operation.pointCount !== undefined) {
                            newNode.pointCount = operation.pointCount;
                        }
                        if (operation.innerRadius !== undefined) {
                            newNode.innerRadius = operation.innerRadius;
                        }
                        if (operation.width !== undefined && operation.height !== undefined) {
                            newNode.resize(operation.width, operation.height);
                        }
                        break;

                    case 'vector':
                        newNode = figma.createVector();
                        if (operation.vectorPaths && operation.vectorPaths.length > 0) {
                            newNode.vectorPaths = operation.vectorPaths.map(path => ({
                                windingRule: (path.windingRule || 'NONZERO') as 'NONZERO' | 'EVENODD',
                                data: path.data
                            }));
                        }
                        break;

                    case 'arrow':
                        // Arrows are created as lines
                        newNode = figma.createLine();
                        if (operation.width !== undefined) {
                            newNode.resize(operation.width, 0);
                        }
                        break;

                    default:
                        results.errors.push(`Unsupported shape type for ADD: ${operation.type}`);
                        continue;
                }

                if (!newNode) {
                    results.errors.push(`Failed to create ${operation.type}`);
                    continue;
                }

                // Set position
                if (operation.x !== undefined && operation.y !== undefined) {
                    newNode.x = operation.x;
                    newNode.y = operation.y;
                }

                // Set name
                if (operation.name) {
                    newNode.name = operation.name;
                }

                // Set fills
                if (operation.fills && operation.fills.length > 0) {
                    const normalizedFills: SolidPaint[] = operation.fills.map((fill) => ({
                        type: 'SOLID',
                        color: fill.color,
                        opacity: fill.opacity !== undefined ? fill.opacity : 1
                    }));
                    newNode.fills = normalizedFills;
                } else {
                    newNode.fills = [];
                }

                // Set strokes
                if (operation.strokes && operation.strokes.length > 0) {
                    const normalizedStrokes: SolidPaint[] = operation.strokes.map((stroke) => ({
                        type: 'SOLID',
                        color: stroke.color,
                        opacity: stroke.opacity !== undefined ? stroke.opacity : 1
                    }));
                    newNode.strokes = normalizedStrokes;
                }
                if (operation.strokeWeight !== undefined) {
                    newNode.strokeWeight = operation.strokeWeight;
                }

                // Set opacity
                if (operation.opacity !== undefined) {
                    newNode.opacity = operation.opacity;
                }

                // Set rotation
                if (operation.rotation !== undefined) {
                    newNode.rotation = (operation.rotation * Math.PI) / 180;
                }

                // Add to container or page
                const targetParent = operation.container
                    ? findContainer(operation.container)
                    : null;

                if (targetParent && 'appendChild' in targetParent) {
                    targetParent.appendChild(newNode);
                } else {
                    if (operation.container) {
                        results.errors.push(`Container "${operation.container}" not found, added to page instead`);
                    }
                    figma.currentPage.appendChild(newNode);
                }

                results.created++;

            } else if (operation.action === 'modify') {
                // Modify existing object
                const targetNode = findShapeByIdOrDescription(operation.targetId, operation.targetDescription);

                if (!targetNode) {
                    results.errors.push(`Could not find shape to modify: ${operation.targetId || operation.targetDescription}`);
                    continue;
                }

                // Update position
                if (operation.x !== undefined && 'x' in targetNode) {
                    targetNode.x = operation.x;
                }
                if (operation.y !== undefined && 'y' in targetNode) {
                    targetNode.y = operation.y;
                }

                // Update size (only for nodes that support resize)
                if (operation.width !== undefined && operation.height !== undefined) {
                    if ('resize' in targetNode && typeof targetNode.resize === 'function') {
                        targetNode.resize(operation.width, operation.height);
                    }
                }

                // Update fills (only for nodes that support fills)
                if (operation.fills && operation.fills.length > 0 && 'fills' in targetNode) {
                    const normalizedFills: SolidPaint[] = operation.fills.map((fill) => ({
                        type: 'SOLID',
                        color: fill.color,
                        opacity: fill.opacity !== undefined ? fill.opacity : 1
                    }));
                    targetNode.fills = normalizedFills;
                }

                // Update strokes (only for nodes that support strokes)
                if (operation.strokes && operation.strokes.length > 0 && 'strokes' in targetNode) {
                    const normalizedStrokes: SolidPaint[] = operation.strokes.map((stroke) => ({
                        type: 'SOLID',
                        color: stroke.color,
                        opacity: stroke.opacity !== undefined ? stroke.opacity : 1
                    }));
                    targetNode.strokes = normalizedStrokes;
                }
                if (operation.strokeWeight !== undefined && 'strokeWeight' in targetNode) {
                    targetNode.strokeWeight = operation.strokeWeight;
                }

                // Update type-specific properties
                if (targetNode.type === 'RECTANGLE' && operation.cornerRadius !== undefined) {
                    targetNode.cornerRadius = operation.cornerRadius;
                }
                if (targetNode.type === 'POLYGON' && operation.pointCount !== undefined) {
                    targetNode.pointCount = operation.pointCount;
                }
                if (targetNode.type === 'STAR') {
                    if (operation.pointCount !== undefined) {
                        targetNode.pointCount = operation.pointCount;
                    }
                    if (operation.innerRadius !== undefined) {
                        targetNode.innerRadius = operation.innerRadius;
                    }
                }
                if (targetNode.type === 'VECTOR' && operation.vectorPaths && operation.vectorPaths.length > 0) {
                    targetNode.vectorPaths = operation.vectorPaths.map(path => ({
                        windingRule: (path.windingRule || 'NONZERO') as 'NONZERO' | 'EVENODD',
                        data: path.data
                    }));
                }

                // Update opacity
                if (operation.opacity !== undefined && 'opacity' in targetNode) {
                    targetNode.opacity = operation.opacity;
                }

                // Update rotation
                if (operation.rotation !== undefined && 'rotation' in targetNode) {
                    targetNode.rotation = (operation.rotation * Math.PI) / 180;
                }

                // Update name
                if (operation.name) {
                    targetNode.name = operation.name;
                }

                results.modified++;
            }
        } catch (error) {
            results.success = false;
            results.errors.push(
                `Error executing operation: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    return results;
}

/**
 * Main execution function - parses and executes in one call
 */
export async function executeNaturalLanguage(
    naturalLanguageDescription: string,
    apiKey: string
): Promise<{
    success: boolean;
    created: number;
    modified: number;
    errors: string[];
    summary?: string;
    apiCalls?: APICallInfo[];
}> {
    try {
        // Step 1: Parse natural language to structured plan
        const { plan, apiCall } = await parseExecutionPlan(naturalLanguageDescription, apiKey);

        // Step 2: Execute the plan
        const results = await executePlan(plan);

        return {
            ...results,
            summary: plan.summary,
            apiCalls: [apiCall],
        };
    } catch (error) {
        return {
            success: false,
            created: 0,
            modified: 0,
            errors: [error instanceof Error ? error.message : String(error)],
        };
    }
}

