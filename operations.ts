// ============================================================================
// OPERATIONS
// Converts constraint-based actions into structured JSON operations
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
    const prompt = `You are an expert at converting constraint-based design actions into clear, detailed natural language descriptions of operations.

The user has provided constraint-based actions (similar to CSS constraints) that specify design operations. Your task is to convert these constraints into natural language descriptions that specify exactly what properties each object must have, including:
- Exact positions (x, y coordinates)
- Exact sizes (width, height)
- Colors (fill and stroke)
- Container relationships
- Any other properties needed

**CONSTRAINT-BASED ACTIONS:**
${JSON.stringify(constraintPlan, null, 2)}

**CRITICAL: TEXT BOX DETECTION**
When analyzing actions, detect if a text box is needed based on:
1. **Action description keywords**: "text box", "input", "input field", "text field", "button", "label", "text area", "textarea"
2. **Intent keywords**: If metadata.intent mentions "text", "input", "label", "button", "field"
3. **Constraint types**: If an action has a "content" constraint type (text content), it needs a text box
4. **Action patterns**: If an action creates a rectangle/frame AND has a follow-up action that creates text inside it

**When a text box is detected:**
- ALWAYS create TWO separate operations in your description:
  1. First: Create the container/box (rectangle or frame) with position, size, fills, strokes, corner radius
  2. Second: Create the text element that goes inside the box
- Specify that the text should be placed inside the container with appropriate padding
- Extract the actual text content from constraints or descriptions

**REQUIREMENTS:**
1. For each action, analyze all its constraints and determine the exact properties needed
2. Resolve position constraints to specific x, y coordinates (top-left corner)
3. Resolve size constraints to specific width and height values
4. Resolve spacing constraints to specific positions relative to other objects
5. Resolve color constraints to specific RGB values (0-1 range)
6. Infer shape types from descriptions (circle, rectangle, ellipse, etc.)
7. Consider container relationships and padding
8. Calculate positions based on spacing constraints relative to other objects
9. **DETECT TEXT BOX REQUIREMENTS**: If an action or intent suggests a text box is needed, explicitly describe creating both the box and the text inside it

**IMPORTANT:**
- All coordinates are in Figma's coordinate system (top-left origin, y increases downward)
- x, y coordinates represent the TOP-LEFT corner of the object, not the center
- If a position constraint specifies an anchor point (like "center"), calculate the top-left position
- RGB values must be in 0-1 range
- Be specific and precise - calculate exact values, don't use ranges or approximations
- For spacing constraints, calculate the exact position based on the reference object's position and size
- **For text boxes**: Always describe creating the container first, then the text element with its content, padding, alignment, and styling

**OUTPUT FORMAT:**
Return a clear, structured natural language description. For each action, specify:
1. Action type: "ADD" or "MODIFY"
2. Object type: circle, rectangle, ellipse, frame, text, line, polygon, star, vector, arrow
3. Name: the targetId or a descriptive name
4. Position: exact x, y coordinates (top-left corner)
5. Size: exact width and height (or radius for circles)
6. Container: parent container name/ID
7. Colors: fill color (RGB 0-1) and stroke color if specified
8. Other properties: corner radius, stroke weight, etc.
9. **For text boxes**: Text content, font size, alignment, padding, font family, font weight

Format your response as a clear, numbered list of operations with all specific values calculated.`;

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

    const prompt = `You are an expert at converting natural language operation descriptions into structured JSON operations for a Figma plugin.

The user has provided natural language descriptions of design operations with exact calculated values. Your task is to convert this into a structured JSON format that specifies exactly what objects to ADD or MODIFY.

**CURRENT FIGMA PAGE DOM (for exact node identification):**
The following is a list of all nodes currently on the Figma page. Use the exact "id" field for targetId when modifying existing nodes. This ensures precise node identification instead of fuzzy name matching.

${domInfo}

**NATURAL LANGUAGE OPERATIONS:**
${naturalLanguageOperations}

**CRITICAL: TEXT BOX AND TEXT PLACEMENT RULES**
When a box, container, input field, or any shape that should contain text is being created:
1. **ALWAYS create TWO operations**:
   a. First operation: Create the container/box (rectangle, frame, etc.) with its position, size, fills, strokes
      - Give it a clear, simple name (e.g., "text-box", "email-input", "button-container")
      - This name will be used to reference it in the text operation
   b. Second operation: Create a TEXT element that will be placed INSIDE that container
   
2. **For the TEXT operation**:
   - **CRITICAL**: Set textBoxId to EXACTLY match the name from the first operation (case-sensitive, exact match)
     * If container name is "text-box", then textBoxId must be "text-box" (not "Text Box" or "text box")
     * Alternatively, use textBoxDescription to match the container's description
   - **CRITICAL**: Calculate position (x, y) RELATIVE TO THE CONTAINER BOX, NOT absolute page coordinates
     * x = padding.left (typically 12-16px)
     * y = padding.top (typically 8-12px)
     * These are coordinates RELATIVE to the container's top-left corner (0, 0), NOT the page
   - Set appropriate padding (typically 8-16px for top/bottom, 12-16px for left/right)
   - Set textAlign based on context (LEFT for most inputs, CENTER for buttons/centered text)
   - Set fontSize appropriate for the context (typically 14-16px for inputs, 12-14px for labels)
   - Extract actual text content from the description (e.g., "email input" → textContent: "Email" or placeholder text)

3. **Positioning Calculation - CRITICAL EXAMPLES**:
   - Example 1: Container at page position (x: 100, y: 200) with name "text-box" and padding {left: 16, top: 12}
     * Text operation: x = 16, y = 12 (NOT 116, 212!)
     * textBoxId = "text-box" (exact match)
     * container = "text-box" (same as textBoxId)
   - Example 2: Container at page position (x: 50, y: 300) with name "email-field" and padding {left: 12, top: 8}
     * Text operation: x = 12, y = 8 (NOT 62, 308!)
     * textBoxId = "email-field" (exact match)
     * container = "email-field" (same as textBoxId)
   - **REMEMBER**: When textBoxId is set, the x, y coordinates are AUTOMATICALLY relative to that container
   - **DO NOT** add the container's page position to the text coordinates
   - **ALWAYS** set container to the same value as textBoxId for text operations
   - **WRONG**: Container at (100, 100), text at (116, 112) with padding {left: 16, top: 12}
   - **CORRECT**: Container at (100, 100), text at (16, 12) with padding {left: 16, top: 12}, textBoxId = container name

4. **Typography**:
   - Use appropriate fontFamily (typically "Inter" for modern UIs)
   - Use appropriate fontWeight (400 for body text, 500-600 for emphasis)
   - Ensure text fits within the container width minus padding

**CRITICAL: MODIFY OPERATIONS - EXACT NODE IDENTIFICATION (NO FUZZY MATCHING)**
When modifying existing nodes, you MUST identify the exact node using the DOM information above. Fuzzy matching is NOT allowed.

**STEP-BY-STEP NODE IDENTIFICATION PROCESS:**

1. **Analyze the operation requirements**:
   - What type of node needs to be modified? (RECTANGLE, TEXT, ELLIPSE, etc.)
   - What is the target name or description from the constraints?
   - What is the use case? (button box, button text, input field, label, etc.)

2. **Search the DOM for matching nodes**:
   - Filter nodes by TYPE first (e.g., if modifying a button box, look for RECTANGLE nodes)
   - Then filter by NAME (match the targetId/description from constraints)
   - Consider PARENT relationships (e.g., button text is usually a child of the button rectangle's parent frame)
   - Consider POSITION relationships (e.g., button text is usually positioned near/inside the button rectangle)
   - Consider CONTEXT clues:
     * "button box" or "background" → RECTANGLE type
     * "button text" or "label" → TEXT type
     * "input field" → RECTANGLE type (the container)
     * "placeholder" or "input text" → TEXT type (the text inside)

3. **Identify the exact node**:
   - Once you've found the matching node in the DOM, use its EXACT "id" field value for targetId
   - Example: To modify "login-button" rectangle:
     * Search DOM for type: "RECTANGLE"
     * Find node with name: "login-button"
     * Verify it's the button box (not text) by checking type and context
     * Use exact id: "9:38" (from the DOM)
   - Example: To modify "login-button" text:
     * Search DOM for type: "TEXT"
     * Find node with name containing "login" and "button" (e.g., "Login Button Text")
     * Verify it's text by checking type and textContent
     * Use exact id: "9:39" (from the DOM)

4. **CRITICAL RULES**:
   - **ALWAYS use exact node IDs from the DOM** - never use names for targetId in modify operations
   - **Match by TYPE first** - if modifying a rectangle, only consider RECTANGLE nodes
   - **Match by CONTEXT** - "button box" = RECTANGLE, "button text" = TEXT
   - **Check PARENT relationships** - related nodes often share the same parent
   - **Verify with POSITION** - text nodes are usually positioned near their container rectangles
   - **NO FUZZY MATCHING** - if you can't find an exact match, the node may not exist or the description is unclear
   
2. **For text content modifications**:
   - Set textContent to the new text value
   - Keep other text properties (fontSize, textAlign, fontFamily, fontWeight) unless they need to change
   - If only textContent is changing, set other text properties to 0 or empty string (as per schema requirements)
   
3. **For text property modifications**:
   - Update fontSize, textAlign, fontFamily, fontWeight as specified
   - If textContent is not changing, set it to empty string (as per schema requirements)

5. **IMPORTANT: What NOT to modify as text**:
   - **Semantic roles, accessibility properties, or metadata** are NOT text nodes and should NOT be modified as text operations
   - These are properties of the container/shape itself, not separate text elements
   - If a constraint mentions "semantic role", "role", "accessibility", or similar metadata, DO NOT create a text modification operation for it
   - Only create text modifications for actual visible text content (labels, placeholders, button text, etc.)

**CRITICAL: WHEN TO CREATE MULTIPLE VS SINGLE MODIFY OPERATIONS**
- **Create SEPARATE modify operations** when modifying DIFFERENT nodes (different targetId or targetDescription)
  * Example: Modifying "email-input-label" text AND "email-input" placeholder text → 2 separate operations (different targetIds)
  * Example: Modifying "button-1" text AND "button-2" text → 2 separate operations (different targetIds)
- **Create ONE modify operation** when modifying the SAME node with multiple properties
  * Example: Modifying "email-input-label" text content AND fontSize → 1 operation (same targetId, multiple properties)
  * Example: Modifying "button-1" text content AND textAlign → 1 operation (same targetId, multiple properties)
- **DO NOT create modify operations** for semantic roles, accessibility properties, or metadata (these are not text nodes)
- **Summary**: One operation per unique targetId/targetDescription. If multiple constraints target the same node, combine them into one operation.

**REQUIREMENTS:**
1. Parse all ADD operations - these create new objects
2. Parse all MODIFY operations - these modify existing objects (identified by targetId or targetDescription)
3. For each operation, extract:
   - Action: "add" or "modify"
   - Type: "circle", "rectangle", "ellipse", "polygon", "star", "line", "vector", "arrow", "text" (required for add)
   - Position: x, y coordinates (top-left corner)
   - Size: width, height in pixels (or radius for circles)
   - Fills: array of color objects with type "SOLID", color {r, g, b}, and opacity
   - Strokes: array of color objects with type "SOLID", color {r, g, b}, and opacity
   - Stroke weight (if specified)
   - Container/parent name (if specified)
   - Type-specific properties (cornerRadius for rectangles, pointCount for polygons/stars, innerRadius for stars, vectorPaths array for vectors)
   - For MODIFY: targetId or targetDescription to identify the shape to modify
   - **For TEXT operations**: 
     * textContent: The actual text string to display (extract from description - NEVER leave empty for text boxes)
     * fontSize: Font size in pixels (14-16px for inputs, 12-14px for labels)
     * textAlign: "LEFT" (for inputs), "CENTER" (for buttons/centered text), "RIGHT" (for right-aligned)
     * textBoxId or textBoxDescription: MUST reference the container box that was created (use the name from the container operation)
     * padding: {top, right, bottom, left} - reasonable padding (8-16px typical, all values required)
     * fontFamily: Font family name (e.g., "Inter", "Roboto") - default to "Inter"
     * fontWeight: Font weight number (400 for normal, 500-600 for medium/bold) - default to 400
     * Position: Calculate x, y coordinates RELATIVE TO THE TEXT BOX CONTAINER (x = padding.left, y = padding.top)

**IMPORTANT:**
- All coordinates are in Figma's coordinate system (top-left origin, y increases downward)
- x, y coordinates represent the TOP-LEFT corner of the object, not the center
- RGB values must be in 0-1 range (divide by 255 if given as 0-255)
- Fills and strokes should be arrays with objects: [{"type": "SOLID", "color": {"r": 1, "g": 0, "b": 0}, "opacity": 1}]
- Use the exact values from the natural language description
- Always include a name for new objects

**OUTPUT FORMAT:**
Return a JSON object with this structure (matching Figma API properties):

Example for text box with text:
{
  "operations": [
    {
      "action": "add",
      "type": "rectangle",
      "name": "text-box",
      "x": 100,
      "y": 200,
      "width": 400,
      "height": 120,
      "fills": [{"type": "SOLID", "color": {"r": 0.95, "g": 0.95, "b": 0.95}, "opacity": 1}],
      "strokes": [],
      "strokeWeight": 0,
      "container": "content-area",
      "cornerRadius": 8,
      "textContent": "",
      "fontSize": 0,
      "textAlign": "LEFT",
      "textBoxId": "",
      "textBoxDescription": "",
      "padding": {"top": 0, "right": 0, "bottom": 0, "left": 0},
      "fontFamily": "",
      "fontWeight": 0
    },
    {
      "action": "add",
      "type": "text",
      "name": "Text Content",
      "x": 16,
      "y": 12,
      "width": 368,
      "height": 96,
      "fills": [{"type": "SOLID", "color": {"r": 0, "g": 0, "b": 0}, "opacity": 1}],
      "strokes": [],
      "strokeWeight": 0,
      "container": "text-box",
      "textContent": "Hello, world!",
      "fontSize": 16,
      "textAlign": "CENTER",
      "textBoxId": "text-box",
      "textBoxDescription": "",
      "padding": {"top": 12, "right": 16, "bottom": 12, "left": 16},
      "fontFamily": "Inter",
      "fontWeight": 500
    }
  ],
  "summary": "Create text box with centered text"
}

Note: The text operation has x=16, y=12 (relative to container), textBoxId="text-box" (matches container name), and container="text-box" (same as textBoxId).

Note: Properties match Figma API exactly - use only the properties relevant to each shape type.

**IMPORTANT SCHEMA REQUIREMENTS:**
- ALL properties listed above are REQUIRED in the JSON output (strict schema mode)
- For properties that don't apply to a specific operation, use appropriate default/empty values:
  * Strings: Use empty string "" (e.g., textContent: "", textBoxId: "", textBoxDescription: "", fontFamily: "")
  * Numbers: Use 0 (e.g., fontSize: 0, fontWeight: 0, padding values: 0)
  * Arrays: Use empty array [] (e.g., fills: [], strokes: [], vectorPaths: [])
  * Objects: Use object with all required properties set to defaults (e.g., padding: {top: 0, right: 0, bottom: 0, left: 0})
  * Enums: Use the first enum value as default (e.g., textAlign: "LEFT")
- For text operations, provide actual values for textContent, fontSize, textAlign, etc.
- For non-text operations, use the default/empty values listed above for text-related properties.

Be precise and extract all operations from the natural language description.`;

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

