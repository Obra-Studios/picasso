// ============================================================================
// EXECUTION AGENT
// Converts natural language action descriptions into Figma DOM modifications
// ============================================================================
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
/**
 * Converts natural language description to structured execution plan
 */
export function parseExecutionPlan(naturalLanguageDescription, apiKey) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
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
        const response = yield fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestBody),
        });
        const responseData = yield response.json();
        const apiCall = {
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
            throw new Error(((_a = responseData.error) === null || _a === void 0 ? void 0 : _a.message) || 'Failed to parse execution plan');
        }
        const content = ((_c = (_b = responseData.choices[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) || '{"operations":[]}';
        const plan = JSON.parse(content);
        return { plan, apiCall };
    });
}
/**
 * Executes the plan by creating/modifying objects in Figma
 */
export function executePlan(plan) {
    return __awaiter(this, void 0, void 0, function* () {
        const results = {
            success: true,
            created: 0,
            modified: 0,
            errors: [],
        };
        // Find containers by name (cache for efficiency)
        const containerCache = new Map();
        function findContainer(name) {
            if (containerCache.has(name)) {
                return containerCache.get(name);
            }
            // Search all nodes recursively
            function searchNode(node) {
                if (node.name === name) {
                    return node;
                }
                if ('children' in node) {
                    for (const child of node.children) {
                        const found = searchNode(child);
                        if (found)
                            return found;
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
            return null;
        }
        function findNodeById(id) {
            try {
                return figma.getNodeById(id);
            }
            catch (_a) {
                return null;
            }
        }
        // Get all available shapes for finding by description
        const availableShapes = [];
        function collectShapes(node) {
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
        function findShapeByIdOrDescription(targetId, targetDescription) {
            if (targetId) {
                // Try to find by ID first
                const found = findNodeById(targetId);
                if (found)
                    return found;
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
                    let newNode = null;
                    // Create the appropriate shape
                    switch (normalizedType) {
                        case 'circle':
                            newNode = figma.createEllipse();
                            if (operation.radius !== undefined) {
                                newNode.resize(operation.radius * 2, operation.radius * 2);
                            }
                            else if (operation.width !== undefined && operation.height !== undefined) {
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
                                    windingRule: (path.windingRule || 'NONZERO'),
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
                        const normalizedFills = operation.fills.map((fill) => ({
                            type: 'SOLID',
                            color: fill.color,
                            opacity: fill.opacity !== undefined ? fill.opacity : 1
                        }));
                        newNode.fills = normalizedFills;
                    }
                    else {
                        newNode.fills = [];
                    }
                    // Set strokes
                    if (operation.strokes && operation.strokes.length > 0) {
                        const normalizedStrokes = operation.strokes.map((stroke) => ({
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
                    }
                    else {
                        if (operation.container) {
                            results.errors.push(`Container "${operation.container}" not found, added to page instead`);
                        }
                        figma.currentPage.appendChild(newNode);
                    }
                    results.created++;
                }
                else if (operation.action === 'modify') {
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
                        const normalizedFills = operation.fills.map((fill) => ({
                            type: 'SOLID',
                            color: fill.color,
                            opacity: fill.opacity !== undefined ? fill.opacity : 1
                        }));
                        targetNode.fills = normalizedFills;
                    }
                    // Update strokes (only for nodes that support strokes)
                    if (operation.strokes && operation.strokes.length > 0 && 'strokes' in targetNode) {
                        const normalizedStrokes = operation.strokes.map((stroke) => ({
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
                            windingRule: (path.windingRule || 'NONZERO'),
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
            }
            catch (error) {
                results.success = false;
                results.errors.push(`Error executing operation: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        return results;
    });
}
/**
 * Main execution function - parses and executes in one call
 */
export function executeNaturalLanguage(naturalLanguageDescription, apiKey) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Step 1: Parse natural language to structured plan
            const { plan, apiCall } = yield parseExecutionPlan(naturalLanguageDescription, apiKey);
            // Step 2: Execute the plan
            const results = yield executePlan(plan);
            return Object.assign(Object.assign({}, results), { summary: plan.summary, apiCalls: [apiCall] });
        }
        catch (error) {
            return {
                success: false,
                created: 0,
                modified: 0,
                errors: [error instanceof Error ? error.message : String(error)],
            };
        }
    });
}
