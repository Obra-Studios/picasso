// ============================================================================
// EXECUTION AGENT
// Converts natural language action descriptions into Figma DOM modifications
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
    // Text-specific properties
    textContent?: string; // The actual text content to display
    fontSize?: number; // Font size in pixels
    textAlign?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'; // Text alignment
    textBoxId?: string; // ID or name of the text box container to overlay text into
    textBoxDescription?: string; // Alternative description to identify text box
    padding?: {
        top?: number;
        right?: number;
        bottom?: number;
        left?: number;
    }; // Padding inside text box for text positioning
    fontFamily?: string; // Font family (e.g., "Inter", "Roboto")
    fontWeight?: number; // Font weight (e.g., 400, 500, 600, 700)
}

export interface ExecutionPlan {
    operations: ExecutionOperation[];
    summary?: string;
}

// ============================================================================
// CONSTRAINT-BASED ACTION INTERFACES
// ============================================================================

export interface PositionConstraint {
    id: string;
    type: 'position';
    description: string;
    targetId: string;
    parameters: {
        containerId?: string;
        padding?: {
            top?: number;
            right?: number;
            bottom?: number;
            left?: number;
        };
        xRange?: {
            min?: number;
            max?: number;
        };
        yRange?: {
            min?: number;
            max?: number;
        };
    };
}

export interface SizeConstraint {
    id: string;
    type: 'size';
    description: string;
    targetId: string;
    parameters: {
        width?: {
            operator: 'eq' | 'min' | 'max' | 'range';
            value?: number;
            min?: number;
            max?: number;
        };
        height?: {
            operator: 'eq' | 'min' | 'max' | 'range';
            value?: number;
            min?: number;
            max?: number;
        };
    };
}

export interface SpacingConstraint {
    id: string;
    type: 'spacing';
    description: string;
    targetId: string;
    parameters: {
        referenceId: string;
        direction: 'horizontal' | 'vertical';
        distance: {
            operator: 'eq' | 'min' | 'max';
            value: number;
        };
    };
}

export interface ColorConstraint {
    id: string;
    type: 'color';
    description: string;
    targetId: string;
    parameters: {
        property: 'fill' | 'stroke';
        value: string | { r: number; g: number; b: number; a?: number };
    };
}

export type Constraint = PositionConstraint | SizeConstraint | SpacingConstraint | ColorConstraint;

export interface Action {
    id: string;
    type: 'create' | 'modify';
    description: string;
    constraints: Constraint[];
}

export interface ConstraintBasedPlan {
    actions: Action[];
    metadata?: {
        timestamp?: number;
        model?: string;
        intent?: string;
    };
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

/**
 * Legacy function - kept for backward compatibility
 * Converts natural language description to structured execution plan
 * @deprecated Use parseExecutionPlan instead, which supports both natural language and constraint-based input
 */
export async function parseExecutionPlanLegacy(
    naturalLanguageDescription: string,
    apiKey: string
): Promise<{ plan: ExecutionPlan; apiCall: APICallInfo }> {
    const { plan, apiCalls } = await parseExecutionPlan(naturalLanguageDescription, apiKey);
    return { plan, apiCall: apiCalls[0] };
}

// Old implementation removed - replaced by two-stage process above

/**
 * Converts constraint-based actions into operations that can be executed by Figma
 * NOTE: This function is kept for backward compatibility but is no longer used in the main flow.
 * The new flow uses convertConstraintsToNaturalLanguage -> parseNaturalLanguageOperations
 */
function convertConstraintsToOperations(constraintPlan: ConstraintBasedPlan): ExecutionPlan {
    const operations: ExecutionOperation[] = [];

    // Helper to find container by ID or name
    function findContainerById(id: string): SceneNode | null {
        try {
            const node = figma.getNodeById(id);
            if (node && node.type !== 'PAGE' && 'appendChild' in node) {
                return node as SceneNode;
            }
        } catch {
            // Not a valid Figma ID, will try by name
        }

        // Search by name (case-insensitive, normalized)
        const normalizeName = (n: string) => n.toLowerCase().replace(/[\s\-_]/g, '');
        const searchName = normalizeName(id);

        function searchNode(node: SceneNode): SceneNode | null {
            if (normalizeName(node.name) === searchName) {
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

        for (const node of figma.currentPage.children) {
            const found = searchNode(node);
            if (found) return found;
        }

        return null;
    }

    // Helper to find node by ID
    function findNodeById(id: string): SceneNode | null {
        try {
            return figma.getNodeById(id) as SceneNode | null;
        } catch {
            return null;
        }
    }

    // Process each action
    for (const action of constraintPlan.actions) {
        const targetId = action.constraints.length > 0 ? action.constraints[0].targetId : action.id;

        // Resolve all constraints for this action
        let resolvedX: number | undefined;
        let resolvedY: number | undefined;
        let resolvedWidth: number | undefined;
        let resolvedHeight: number | undefined;
        let resolvedContainer: string | undefined;
        let resolvedFills: Array<{ type: 'SOLID'; color: { r: number; g: number; b: number }; opacity: number }> | undefined;
        let resolvedStrokes: Array<{ type: 'SOLID'; color: { r: number; g: number; b: number }; opacity: number }> | undefined;
        let resolvedStrokeWeight: number | undefined;

        // Infer shape type from description
        let shapeType: 'circle' | 'rectangle' | 'ellipse' | 'frame' | 'text' | 'line' | 'polygon' | 'star' | 'vector' | 'arrow' = 'rectangle';
        const descLower = action.description.toLowerCase();
        if (descLower.includes('circle')) {
            shapeType = 'circle';
        } else if (descLower.includes('ellipse')) {
            shapeType = 'ellipse';
        } else if (descLower.includes('frame') || descLower.includes('container')) {
            shapeType = 'frame';
        } else if (descLower.includes('text') || descLower.includes('input') || descLower.includes('field') || descLower.includes('button')) {
            shapeType = 'rectangle'; // Buttons and inputs are typically rectangles
        } else if (descLower.includes('line') || descLower.includes('arrow')) {
            shapeType = 'line';
        } else if (descLower.includes('vector') || descLower.includes('path')) {
            shapeType = 'vector';
        }

        // Process each constraint
        for (const constraint of action.constraints) {
            if (constraint.type === 'position') {
                const params = constraint.parameters;
                if (params.containerId) {
                    resolvedContainer = params.containerId;
                }
                // Resolve position from ranges and padding
                if (params.xRange && params.yRange) {
                    const padding = params.padding || { top: 0, right: 0, bottom: 0, left: 0 };
                    // Use min values with padding as default position
                    resolvedX = (params.xRange.min ?? 0) + (padding.left ?? 0);
                    resolvedY = (params.yRange.min ?? 0) + (padding.top ?? 0);
                }
            } else if (constraint.type === 'size') {
                const params = constraint.parameters;
                if (params.width) {
                    if (params.width.operator === 'eq' && params.width.value !== undefined) {
                        resolvedWidth = params.width.value;
                    } else if (params.width.operator === 'min' && params.width.value !== undefined) {
                        resolvedWidth = params.width.value;
                    } else if (params.width.operator === 'max' && params.width.value !== undefined) {
                        resolvedWidth = params.width.value;
                    } else if (params.width.operator === 'range' && params.width.min !== undefined) {
                        resolvedWidth = params.width.min;
                    }
                }
                if (params.height) {
                    if (params.height.operator === 'eq' && params.height.value !== undefined) {
                        resolvedHeight = params.height.value;
                    } else if (params.height.operator === 'min' && params.height.value !== undefined) {
                        resolvedHeight = params.height.value;
                    } else if (params.height.operator === 'max' && params.height.value !== undefined) {
                        resolvedHeight = params.height.value;
                    } else if (params.height.operator === 'range' && params.height.min !== undefined) {
                        resolvedHeight = params.height.min;
                    }
                }
            } else if (constraint.type === 'spacing') {
                const params = constraint.parameters;
                // First check if referenceId is another operation we've already processed in this batch
                let referenceOperation = operations.find(op => op.name === params.referenceId);

                if (referenceOperation && referenceOperation.x !== undefined && referenceOperation.y !== undefined) {
                    // Reference is another operation in this batch - use its resolved position
                    const refX = referenceOperation.x;
                    const refY = referenceOperation.y;
                    const refWidth = referenceOperation.width || 0;
                    const refHeight = referenceOperation.height || 0;

                    if (params.direction === 'vertical') {
                        // Place below the reference object
                        resolvedY = refY + refHeight + params.distance.value;
                        // Align horizontally (use reference x if x not already set)
                        if (resolvedX === undefined) {
                            resolvedX = refX;
                        }
                    } else if (params.direction === 'horizontal') {
                        // Place to the right of the reference object
                        resolvedX = refX + refWidth + params.distance.value;
                        // Align vertically (use reference y if y not already set)
                        if (resolvedY === undefined) {
                            resolvedY = refY;
                        }
                    }
                } else {
                    // Try to find existing node by ID or name
                    const referenceNode = findNodeById(params.referenceId);
                    if (referenceNode && 'absoluteBoundingBox' in referenceNode && referenceNode.absoluteBoundingBox) {
                        const refBounds = referenceNode.absoluteBoundingBox;
                        if (params.direction === 'vertical') {
                            // Place below the reference object
                            resolvedY = refBounds.y + refBounds.height + params.distance.value;
                            // Align horizontally (use reference x if x not already set)
                            if (resolvedX === undefined) {
                                resolvedX = refBounds.x;
                            }
                        } else if (params.direction === 'horizontal') {
                            // Place to the right of the reference object
                            resolvedX = refBounds.x + refBounds.width + params.distance.value;
                            // Align vertically (use reference y if y not already set)
                            if (resolvedY === undefined) {
                                resolvedY = refBounds.y;
                            }
                        }
                    }
                }
            } else if (constraint.type === 'color') {
                const params = constraint.parameters;
                const color = resolveColor(params.value);
                const paint = {
                    type: 'SOLID' as const,
                    color: { r: color.r, g: color.g, b: color.b },
                    opacity: color.a
                };
                if (params.property === 'fill') {
                    resolvedFills = [paint];
                } else if (params.property === 'stroke') {
                    resolvedStrokes = [paint];
                    resolvedStrokeWeight = 1; // Default stroke weight
                }
            }
        }

        // Create the operation
        const operation: ExecutionOperation = {
            action: action.type === 'create' ? 'add' : 'modify',
            type: shapeType,
            name: targetId,
            x: resolvedX,
            y: resolvedY,
            width: resolvedWidth,
            height: resolvedHeight,
            container: resolvedContainer,
            fills: resolvedFills,
            strokes: resolvedStrokes,
            strokeWeight: resolvedStrokeWeight,
        };

        operations.push(operation);
    }

    return {
        operations,
        summary: constraintPlan.metadata?.intent
    };
}

/**
 * Resolves a color value (named color or RGB object) to RGB values
 */
function resolveColor(value: string | { r: number; g: number; b: number; a?: number }): { r: number; g: number; b: number; a: number } {
    if (typeof value === 'string') {
        // Map named colors to RGB (0-1 range)
        const colorMap: Record<string, { r: number; g: number; b: number; a: number }> = {
            'primary': { r: 0.2, g: 0.4, b: 0.8, a: 1 },
            'secondary': { r: 0.6, g: 0.6, b: 0.6, a: 1 },
            'black': { r: 0, g: 0, b: 0, a: 1 },
            'white': { r: 1, g: 1, b: 1, a: 1 },
            'red': { r: 1, g: 0, b: 0, a: 1 },
            'green': { r: 0, g: 1, b: 0, a: 1 },
            'blue': { r: 0, g: 0, b: 1, a: 1 },
            'yellow': { r: 1, g: 1, b: 0, a: 1 },
        };
        return colorMap[value.toLowerCase()] || { r: 0, g: 0, b: 0, a: 1 };
    }
    return {
        r: value.r,
        g: value.g,
        b: value.b,
        a: value.a !== undefined ? value.a : 1
    };
}

// Note: Old prompt documentation removed - constraint-based parsing is now handled by convertConstraintsToNaturalLanguage

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

        // Check if a node is a valid container (can have children)
        function isValidContainer(node: SceneNode): boolean {
            // Valid container types: FRAME, GROUP, COMPONENT, INSTANCE, SECTION
            const containerTypes = ['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'SECTION'];
            return containerTypes.indexOf(node.type) !== -1 || 'appendChild' in node;
        }

        // Search all nodes recursively
        function searchNode(node: SceneNode): SceneNode | null {
            // Only consider valid container nodes
            if (!isValidContainer(node)) {
                // Still search children even if this node isn't a container
                if ('children' in node) {
                    for (const child of node.children) {
                        const found = searchNode(child);
                        if (found) return found;
                    }
                }
                return null;
            }

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

            // Continue searching children
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
            if (nodeById && isValidContainer(nodeById as SceneNode)) {
                containerCache.set(name, nodeById as SceneNode);
                return nodeById as SceneNode;
            }
        } catch {
            // Not a valid ID, continue
        }

        // Last resort: collect all frames and try to find the best match
        const allFrames: SceneNode[] = [];
        function collectFrames(node: SceneNode) {
            if (node.type === 'FRAME' && isValidContainer(node)) {
                allFrames.push(node);
            }
            if ('children' in node) {
                for (const child of node.children) {
                    collectFrames(child);
                }
            }
        }
        for (const node of figma.currentPage.children) {
            collectFrames(node);
        }

        // Try to find best match among all frames
        const searchNameNorm = normalizeName(name);
        for (const frame of allFrames) {
            const frameNameNorm = normalizeName(frame.name);
            // Check if frame name contains the search term or vice versa
            if (frameNameNorm.includes(searchNameNorm) || searchNameNorm.includes(frameNameNorm)) {
                containerCache.set(name, frame);
                return frame;
            }
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
    const createdShapesByName = new Map<string, SceneNode>(); // Cache of shapes created in this batch

    function collectShapes(node: SceneNode) {
        const supportedTypes = ['RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'VECTOR', 'LINE', 'TEXT', 'FRAME'];
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

    function findShapeByIdOrDescription(targetId?: string, targetDescription?: string, preferredType?: string): SceneNode | null {
        if (targetId) {
            // Check if targetId looks like a Figma ID (contains ":" which is the format for Figma node IDs)
            // Figma IDs are in format like "123:456" or "I123:456;789:012"
            const isFigmaId = targetId.includes(':');

            // Try to find by ID first (Figma node ID) - prioritize this for exact matching
            const found = findNodeById(targetId);
            if (found) {
                // If preferredType is specified, verify it matches
                if (!preferredType || found.type === preferredType) {
                    return found;
                }
                // If it's a Figma ID but wrong type, don't fall back to name search
                // This ensures exact IDs are respected
                if (isFigmaId) {
                    return null; // Exact ID found but wrong type - fail rather than fuzzy match
                }
            }

            // If targetId is a Figma ID format but not found, don't try name matching
            // This prevents confusion between IDs and names
            if (isFigmaId && !found) {
                return null; // Exact ID not found - fail rather than fuzzy match
            }

            // NO FUZZY MATCHING - only allow exact name matches for newly created shapes in cache
            // This is a temporary fallback during transition - LLM should always provide exact IDs
            if (createdShapesByName.has(targetId)) {
                const shape = createdShapesByName.get(targetId)!;
                if (!preferredType || shape.type === preferredType) {
                    return shape;
                }
                return null;
            }

            // No fuzzy matching - if it's not an exact ID and not in the cache, fail
            return null;
        }

        // NO FUZZY MATCHING - targetDescription is not supported
        // The LLM should provide exact IDs from the DOM
        return null;
    }

    // Helper to find text nodes - ONLY uses exact Figma IDs, NO fuzzy matching
    function findTextNode(targetId?: string, targetDescription?: string, textBoxId?: string): TextNode | null {
        // ONLY use exact Figma ID lookups - NO fuzzy matching
        if (targetId) {
            // Check if targetId looks like a Figma ID (contains ":")
            const isFigmaId = targetId.includes(':');

            if (isFigmaId) {
                const found = findNodeById(targetId);
                if (found && found.type === 'TEXT') {
                    return found as TextNode;
                }
                // Exact ID not found or wrong type - fail
                return null;
            }

            // If targetId is not a Figma ID, check cache for newly created shapes
            if (createdShapesByName.has(targetId)) {
                const found = createdShapesByName.get(targetId)!;
                if (found.type === 'TEXT') {
                    return found as TextNode;
                }
            }
        }

        // If textBoxId is provided, try to find text nodes associated with that container
        // But only if textBoxId is a Figma ID
        if (textBoxId && textBoxId.includes(':')) {
            const container = findShapeByIdOrDescription(textBoxId);
            if (container && container.parent && 'children' in container.parent) {
                // Look for text nodes in the same parent (frame)
                // This is a fallback for when textBoxId is provided but targetId is not
                for (const child of container.parent.children) {
                    if (child.type === 'TEXT') {
                        // Return first text node found in the same parent
                        // The LLM should provide exact IDs, so this is just a fallback
                        return child as TextNode;
                    }
                }
            }
        }

        return null;
    }

    // Sort operations to ensure containers are created before text operations that reference them
    // This ensures text boxes exist before text elements try to find them
    const sortedOperations = [...plan.operations].sort((a, b) => {
        // If operation b is text and references operation a's name as textBoxId, a should come first
        if (b.type === 'text' && b.textBoxId) {
            if (a.name === b.textBoxId) {
                return -1; // a (container) comes before b (text)
            }
        }
        // If operation a is text and references operation b's name as textBoxId, b should come first
        if (a.type === 'text' && a.textBoxId) {
            if (b.name === a.textBoxId) {
                return 1; // b (container) comes before a (text)
            }
        }
        // Otherwise maintain original order
        return 0;
    });

    for (const operation of sortedOperations) {
        try {
            if (operation.action === 'add') {
                // Create new object
                if (!operation.type) {
                    results.errors.push(`ADD operation missing type: ${JSON.stringify(operation)} `);
                    continue;
                }

                const normalizedType = operation.type.toLowerCase();
                let newNode: SceneNode | null = null;
                let textBoxPositionSet = false; // Track if position was set in text box positioning block
                // Variables for text box positioning (absolute position relative to frame)
                let textBoxAbsoluteX: number | null = null;
                let textBoxAbsoluteY: number | null = null;
                let textBoxAvailableWidth: number | null = null;

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
                        // Load font BEFORE creating text node
                        const fontFamily = (operation.fontFamily && operation.fontFamily.trim() !== '') ? operation.fontFamily : 'Inter';
                        const fontWeight = (operation.fontWeight && operation.fontWeight > 0) ? operation.fontWeight : 400;
                        const fontSize = (operation.fontSize && operation.fontSize > 0) ? operation.fontSize : 16;

                        // Map numeric font weight to Figma style names
                        const weightToStyle = (weight: number): string => {
                            if (weight <= 300) return 'Light';
                            if (weight <= 400) return 'Regular';
                            if (weight <= 500) return 'Medium';
                            if (weight <= 600) return 'Semi Bold';
                            if (weight <= 700) return 'Bold';
                            return 'Extra Bold';
                        };

                        const fontStyle = weightToStyle(fontWeight);

                        // Load font - ensure at least one font is loaded before creating text node
                        // Font family should be just the name (e.g., "Inter"), not "Inter Regular"
                        let loadedFontFamily = 'Inter';
                        let loadedFontStyle = 'Regular';
                        let fontLoaded = false;

                        // Try to load the specified font
                        try {
                            const fontToLoad = { family: fontFamily, style: fontStyle };
                            await figma.loadFontAsync(fontToLoad);
                            loadedFontFamily = fontFamily;
                            loadedFontStyle = fontStyle;
                            fontLoaded = true;
                        } catch (fontError) {
                            // Try to load with Regular style if specific style fails
                            try {
                                await figma.loadFontAsync({ family: fontFamily, style: 'Regular' });
                                loadedFontFamily = fontFamily;
                                loadedFontStyle = 'Regular';
                                fontLoaded = true;
                            } catch (fallbackError) {
                                // Use Inter as fallback if specified font fails
                                try {
                                    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
                                    loadedFontFamily = 'Inter';
                                    loadedFontStyle = 'Regular';
                                    fontLoaded = true;
                                } catch (finalError) {
                                    // Last resort: try different Inter style names
                                    const interStyles = ['Regular', 'Normal', 'Book'];
                                    for (const style of interStyles) {
                                        try {
                                            await figma.loadFontAsync({ family: 'Inter', style: style });
                                            loadedFontFamily = 'Inter';
                                            loadedFontStyle = style;
                                            fontLoaded = true;
                                            break;
                                        } catch (styleError) {
                                            continue;
                                        }
                                    }

                                    if (!fontLoaded) {
                                        results.errors.push(`Failed to load font: ${fontFamily} ${fontStyle}. Cannot create text.`);
                                        continue; // Skip this operation
                                    }
                                }
                            }
                        }

                        // Double-check: verify font is actually loaded by attempting to load it again
                        // (this will not reload if already loaded, but will throw if not available)
                        if (fontLoaded) {
                            try {
                                await figma.loadFontAsync({ family: loadedFontFamily, style: loadedFontStyle });
                            } catch (verifyError) {
                                results.errors.push(`Font verification failed: ${loadedFontFamily} ${loadedFontStyle}. Error: ${verifyError instanceof Error ? verifyError.message : String(verifyError)}`);
                                continue; // Skip this operation
                            }
                        }

                        // Only create text node after font is loaded
                        if (!fontLoaded) {
                            results.errors.push(`Cannot create text without loaded font. Skipping text operation.`);
                            continue;
                        }

                        // CRITICAL: Load the font one more time RIGHT BEFORE creating the text node
                        // This ensures it's the most recent loaded font and will be used by the new text node
                        try {
                            await figma.loadFontAsync({ family: loadedFontFamily, style: loadedFontStyle });
                        } catch (finalLoadError) {
                            results.errors.push(`Failed to load font ${loadedFontFamily} ${loadedFontStyle} before creating text node. Error: ${finalLoadError instanceof Error ? finalLoadError.message : String(finalLoadError)}`);
                            continue;
                        }

                        // Now create the text node (font is loaded and will be used automatically)
                        newNode = figma.createText();
                        const textNode = newNode as TextNode;

                        // CRITICAL: Explicitly set the font on the text node to ensure it uses the loaded font
                        // This is necessary because createText() might not always use the last loaded font
                        try {
                            await figma.loadFontAsync({ family: loadedFontFamily, style: loadedFontStyle });
                            textNode.fontName = { family: loadedFontFamily, style: loadedFontStyle };
                        } catch (fontNameError) {
                            // If setting fontName fails, try to continue anyway - the font should be loaded
                            results.errors.push(`Warning: Could not set fontName on text node: ${fontNameError instanceof Error ? fontNameError.message : String(fontNameError)}`);
                        }

                        // CRITICAL ORDER: 
                        // 1. Set characters FIRST (this activates the loaded font)
                        // 2. Then set fontSize (font must be active)
                        // 3. Then set other properties
                        const textToSet = (operation.textContent && operation.textContent.trim() !== '')
                            ? operation.textContent
                            : 'Text';

                        // Set characters first - this will use the font we just set
                        try {
                            textNode.characters = textToSet;
                        } catch (charError) {
                            // If setting characters fails, try reloading the font and retrying
                            try {
                                await figma.loadFontAsync({ family: loadedFontFamily, style: loadedFontStyle });
                                textNode.fontName = { family: loadedFontFamily, style: loadedFontStyle };
                                textNode.characters = textToSet;
                            } catch (retryError) {
                                results.errors.push(`Failed to set text characters. Font may not be loaded. Error: ${charError instanceof Error ? charError.message : String(charError)}`);
                                continue;
                            }
                        }

                        // Now set font size (after characters are set, font should be active)
                        try {
                            textNode.fontSize = fontSize;
                        } catch (sizeError) {
                            results.errors.push(`Failed to set font size. Font "${loadedFontFamily} ${loadedFontStyle}" may not be properly loaded. Error: ${sizeError instanceof Error ? sizeError.message : String(sizeError)}`);
                            // Try to reload font and retry
                            try {
                                await figma.loadFontAsync({ family: loadedFontFamily, style: loadedFontStyle });
                                textNode.fontSize = fontSize;
                            } catch (retryError) {
                                results.errors.push(`Font reload failed. Cannot set fontSize.`);
                                continue;
                            }
                        }

                        // Set text alignment (default to LEFT if empty or invalid)
                        const validAlignments = ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'];
                        if (operation.textAlign && validAlignments.indexOf(operation.textAlign) !== -1) {
                            textNode.textAlignHorizontal = operation.textAlign;
                        } else {
                            textNode.textAlignHorizontal = 'LEFT';
                        }

                        // Handle text box positioning if specified (only if IDs/descriptions are not empty)
                        // Calculate absolute position relative to the frame (not relative to the text box)
                        let textBoxContainer: SceneNode | null = null;

                        if ((operation.textBoxId && operation.textBoxId.trim() !== '') ||
                            (operation.textBoxDescription && operation.textBoxDescription.trim() !== '')) {
                            // Find the text box container (rectangle)
                            textBoxContainer = findShapeByIdOrDescription(operation.textBoxId, operation.textBoxDescription);

                            if (textBoxContainer) {
                                const padding = operation.padding || { top: 0, right: 0, bottom: 0, left: 0 };

                                // Get the rectangle's position relative to its parent (the frame)
                                // Use the x, y properties which are relative to the parent
                                // Note: These should be set by the time we get here since rectangles are created first
                                let boxX = 0;
                                let boxY = 0;
                                let boxWidth = 0;

                                if ('x' in textBoxContainer) {
                                    boxX = textBoxContainer.x;
                                }
                                if ('y' in textBoxContainer) {
                                    boxY = textBoxContainer.y;
                                }
                                if ('width' in textBoxContainer) {
                                    boxWidth = textBoxContainer.width;
                                }

                                // If position is 0,0, the rectangle might not be positioned yet
                                // In that case, try to get position from absoluteBoundingBox relative to parent
                                if (boxX === 0 && boxY === 0 && 'absoluteBoundingBox' in textBoxContainer && textBoxContainer.absoluteBoundingBox) {
                                    const absBounds = textBoxContainer.absoluteBoundingBox;
                                    // If parent exists and is not the page, calculate relative position
                                    if (textBoxContainer.parent && textBoxContainer.parent.type !== 'PAGE' && 'absoluteBoundingBox' in textBoxContainer.parent && textBoxContainer.parent.absoluteBoundingBox) {
                                        const parentBounds = textBoxContainer.parent.absoluteBoundingBox;
                                        boxX = absBounds.x - parentBounds.x;
                                        boxY = absBounds.y - parentBounds.y;
                                    } else {
                                        // No parent or parent is page, use absolute coordinates
                                        boxX = absBounds.x;
                                        boxY = absBounds.y;
                                    }
                                }

                                // Calculate position: rectangle position + padding
                                // This gives us the position relative to the frame (same parent as rectangle)
                                textBoxAbsoluteX = boxX + (padding.left || 0);
                                textBoxAbsoluteY = boxY + (padding.top || 0);
                                textBoxPositionSet = true;

                                // Calculate available width for text (with padding)
                                if (boxWidth === 0 && 'absoluteBoundingBox' in textBoxContainer && textBoxContainer.absoluteBoundingBox) {
                                    boxWidth = textBoxContainer.absoluteBoundingBox.width;
                                }
                                textBoxAvailableWidth = boxWidth - (padding.left || 0) - (padding.right || 0);
                            } else {
                                results.errors.push(`Text box not found: ${operation.textBoxId || operation.textBoxDescription}. Using provided coordinates.`);
                                // Fallback: use operation.x/y if provided (will be set later)
                                if (operation.x !== undefined && operation.y !== undefined) {
                                    textBoxAbsoluteX = operation.x;
                                    textBoxAbsoluteY = operation.y;
                                    textBoxPositionSet = true;
                                }
                            }
                        }
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
                        results.errors.push(`Unsupported shape type for ADD: ${operation.type} `);
                        continue;
                }

                if (!newNode) {
                    results.errors.push(`Failed to create ${operation.type} `);
                    continue;
                }

                // Set position (skip if already set by text box positioning)
                // For text operations, position may have been set in the text box positioning block above
                // Only set position here if it hasn't been set yet
                if (normalizedType !== 'text' || !textBoxPositionSet) {
                    if (operation.x !== undefined && operation.y !== undefined) {
                        newNode.x = operation.x;
                        newNode.y = operation.y;
                    }
                }
                // If textBoxPositionSet is true, position was already set in the text box positioning block

                // Set name
                if (operation.name) {
                    newNode.name = operation.name;
                    // Cache the newly created shape by name for later lookup
                    createdShapesByName.set(operation.name, newNode);
                    // Also add to availableShapes so it can be found by search logic
                    availableShapes.push(newNode);
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
                // For text operations with textBoxId, add to the same container as the rectangle (the frame)
                // Text is placed on top of the box, not as a child of it
                let targetParent: SceneNode | null = null;
                if (normalizedType === 'text' &&
                    ((operation.textBoxId && operation.textBoxId.trim() !== '') ||
                        (operation.textBoxDescription && operation.textBoxDescription.trim() !== ''))) {
                    // Find the text box container (rectangle) to get its parent (the frame)
                    const textBoxContainer = findShapeByIdOrDescription(operation.textBoxId, operation.textBoxDescription);

                    if (textBoxContainer && textBoxContainer.parent && textBoxContainer.parent.type !== 'PAGE') {
                        // Use the same parent as the text box (the frame)
                        // Check if parent can have children
                        if ('appendChild' in textBoxContainer.parent && typeof textBoxContainer.parent.appendChild === 'function') {
                            targetParent = textBoxContainer.parent as SceneNode;
                        }
                    }

                    // If we couldn't get the parent from the rectangle, try to find the container from the operation
                    // The operation.container should be the frame name (e.g., "frame-1")
                    if (!targetParent && operation.container) {
                        targetParent = findContainer(operation.container);
                    }

                    // Last resort: if still no parent, the rectangle might be on the page
                    // In that case, we should also add text to the page, but this is not ideal
                    if (!targetParent && textBoxContainer && textBoxContainer.parent && textBoxContainer.parent.type === 'PAGE') {
                        // Both rectangle and text will be on the page - not ideal but handle it
                        targetParent = null; // Will be added to page below
                    }
                } else {
                    // For non-text or text without text box, use regular container
                    targetParent = operation.container ? findContainer(operation.container) : null;
                }

                // Add to container or page
                if (targetParent && 'appendChild' in targetParent) {
                    targetParent.appendChild(newNode);
                } else {
                    const hasTextBoxForText = normalizedType === 'text' &&
                        ((operation.textBoxId && operation.textBoxId.trim() !== '') ||
                            (operation.textBoxDescription && operation.textBoxDescription.trim() !== ''));
                    // Note: It's okay if container isn't found - we just add to page instead
                    // Only log as info, not an error, unless it was explicitly required
                    if (operation.container || hasTextBoxForText) {
                        const containerName = hasTextBoxForText
                            ? (operation.textBoxId || operation.textBoxDescription || '')
                            : operation.container;
                        // This is informational, not necessarily an error - objects can be added to page
                        // Only log if it's a text box container (which is more critical)
                        if (hasTextBoxForText) {
                            results.errors.push(`Text box container "${containerName}" not found, text added to page instead`);
                        }
                    }
                    figma.currentPage.appendChild(newNode);
                }

                // Set position for text with textBoxId (absolute position relative to frame)
                if (normalizedType === 'text' && textBoxAbsoluteX !== null && textBoxAbsoluteY !== null) {
                    newNode.x = textBoxAbsoluteX;
                    newNode.y = textBoxAbsoluteY;

                    // Set width to fit within text box (with padding) if available
                    if (textBoxAvailableWidth !== null && textBoxAvailableWidth > 0 && 'resize' in newNode) {
                        const textNode = newNode as TextNode;
                        textNode.resize(textBoxAvailableWidth, textNode.height);
                    }
                }

                results.created++;

            } else if (operation.action === 'modify') {
                // ============================================================================
                // MODIFY OPERATION - SIMPLIFIED LOGIC (REWRITTEN FROM SCRATCH)
                // ============================================================================

                // Step 1: Determine what type of node we're looking for
                const typeMap: Record<string, string> = {
                    'rectangle': 'RECTANGLE',
                    'circle': 'ELLIPSE',
                    'ellipse': 'ELLIPSE',
                    'frame': 'FRAME',
                    'text': 'TEXT',
                    'line': 'LINE',
                    'polygon': 'POLYGON',
                    'star': 'STAR',
                    'vector': 'VECTOR',
                    'arrow': 'LINE'
                };

                // Determine expected type from operation.type
                const expectedFigmaType = operation.type ? typeMap[operation.type.toLowerCase()] : null;

                // Step 2: Find the target node by name (from targetId, targetDescription, or operation.name)
                let targetNode: SceneNode | null = null;

                // Get the search name - prefer operation.name, then targetId, then targetDescription
                const searchName = operation.name || operation.targetId || operation.targetDescription || '';

                if (searchName) {
                    // First, try to find by name in the cache of newly created shapes
                    if (createdShapesByName.has(searchName)) {
                        const cached = createdShapesByName.get(searchName)!;
                        // If expectedFigmaType is specified, verify it matches
                        if (!expectedFigmaType || cached.type === expectedFigmaType) {
                            targetNode = cached;
                        }
                    }

                    // If not found in cache, search through available shapes on the page
                    if (!targetNode) {
                        // Search for exact name match first, filtering by type if specified
                        for (const shape of availableShapes) {
                            if (shape.name === searchName) {
                                // If expectedFigmaType is specified, only match if type matches
                                if (!expectedFigmaType || shape.type === expectedFigmaType) {
                                    targetNode = shape;
                                    break;
                                }
                            }
                        }

                        // If not found, try case-insensitive match
                        if (!targetNode) {
                            const searchNameLower = searchName.toLowerCase();
                            for (const shape of availableShapes) {
                                if (shape.name && shape.name.toLowerCase() === searchNameLower) {
                                    // If expectedFigmaType is specified, only match if type matches
                                    if (!expectedFigmaType || shape.type === expectedFigmaType) {
                                        targetNode = shape;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }

                // Step 3: Validate the node was found
                if (!targetNode) {
                    const targetInfo = operation.targetId || operation.targetDescription || 'unknown';
                    const typeInfo = expectedFigmaType ? ` (expected type: ${expectedFigmaType})` : '';
                    results.errors.push(`Could not find node to modify: ${targetInfo}${typeInfo}`);
                    continue;
                }

                // Step 4: Validate the node type matches expected type (if specified)
                if (expectedFigmaType && targetNode.type !== expectedFigmaType) {
                    results.errors.push(`Type mismatch: Expected ${expectedFigmaType} but found ${targetNode.type} with ID "${operation.targetId}" and name "${targetNode.name}". Skipping modification.`);
                    continue;
                }

                // Update position - only if explicitly provided (not placeholder 0,0)
                // For modify operations, when x:0, y:0, width:0, height:0 are all set,
                // it typically means "don't change position/size" (schema placeholder values)
                // Only update position if the value is non-zero (indicating a real position update)
                if (operation.x !== undefined && operation.x !== 0 && 'x' in targetNode) {
                    targetNode.x = operation.x;
                }
                if (operation.y !== undefined && operation.y !== 0 && 'y' in targetNode) {
                    targetNode.y = operation.y;
                }

                // Update size (only for nodes that support resize)
                // Only update if both width and height are provided and at least one is non-zero
                if (operation.width !== undefined && operation.height !== undefined) {
                    // If both are 0, it's likely a placeholder - don't update
                    if (operation.width !== 0 || operation.height !== 0) {
                        if ('resize' in targetNode && typeof targetNode.resize === 'function') {
                            // Use current size if one dimension is 0 (placeholder)
                            const newWidth = operation.width !== 0 ? operation.width :
                                ('width' in targetNode ? targetNode.width : operation.width);
                            const newHeight = operation.height !== 0 ? operation.height :
                                ('height' in targetNode ? targetNode.height : operation.height);
                            targetNode.resize(newWidth, newHeight);
                        }
                    }
                }

                // Update fills (only for nodes that support fills)
                // For modify operations, empty fills array typically means "don't change" (schema placeholder)
                // Only update if fills array is provided and has at least one fill
                if (operation.fills && operation.fills.length > 0 && 'fills' in targetNode) {
                    const normalizedFills: SolidPaint[] = operation.fills.map((fill) => ({
                        type: 'SOLID',
                        color: fill.color,
                        opacity: fill.opacity !== undefined ? fill.opacity : 1
                    }));
                    targetNode.fills = normalizedFills;
                }
                // Note: If fills is empty array [], we don't update (preserves existing fills)

                // Update strokes (only for nodes that support strokes)
                // Empty array [] means "don't change" (schema placeholder)
                // Only update if strokes array is provided and has at least one stroke
                if (operation.strokes && operation.strokes.length > 0 && 'strokes' in targetNode) {
                    const normalizedStrokes: SolidPaint[] = operation.strokes.map((stroke) => ({
                        type: 'SOLID',
                        color: stroke.color,
                        opacity: stroke.opacity !== undefined ? stroke.opacity : 1
                    }));
                    targetNode.strokes = normalizedStrokes;
                }
                // Note: If strokes is empty array [], we don't update (preserves existing strokes)

                // Update strokeWeight - only if explicitly provided and non-zero
                // strokeWeight: 0 in modify operations typically means "don't change" (schema placeholder)
                // Only update if strokeWeight > 0 (indicating a real stroke weight update)
                if (operation.strokeWeight !== undefined && operation.strokeWeight > 0 && 'strokeWeight' in targetNode) {
                    targetNode.strokeWeight = operation.strokeWeight;
                }
                // Note: If strokeWeight is 0, we don't update (preserves existing stroke weight)

                // Update type-specific properties
                // cornerRadius: 0 in modify operations typically means "don't change" (schema placeholder)
                // Only update if cornerRadius > 0 (indicating a real corner radius update)
                if (targetNode.type === 'RECTANGLE' && operation.cornerRadius !== undefined && operation.cornerRadius > 0) {
                    targetNode.cornerRadius = operation.cornerRadius;
                }
                // Note: If cornerRadius is 0, we don't update (preserves existing corner radius)
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

                // Update opacity - only if explicitly provided and non-zero
                // For modify operations, opacity: 0 typically means "don't change" (schema placeholder)
                // Only update if opacity is > 0 (indicating a real opacity update)
                if (operation.opacity !== undefined && operation.opacity > 0 && 'opacity' in targetNode) {
                    targetNode.opacity = operation.opacity;
                }

                // Update rotation
                if (operation.rotation !== undefined && 'rotation' in targetNode) {
                    targetNode.rotation = (operation.rotation * Math.PI) / 180;
                }

                // Update name - only if explicitly provided and not empty
                // Empty string "" means "don't change" (schema placeholder)
                if (operation.name && operation.name.trim() !== '') {
                    targetNode.name = operation.name;
                }

                // Update text-specific properties (for TEXT nodes)
                if (targetNode.type === 'TEXT') {
                    const textNode = targetNode as TextNode;

                    // CRITICAL: Load font FIRST before any text operations
                    // Get current font or use defaults
                    let loadedFontFamily = 'Inter';
                    let loadedFontStyle = 'Regular';

                    // Try to get current font from the text node
                    try {
                        const currentFont = textNode.fontName;
                        // Check if fontName is a FontName object (not a symbol)
                        if (typeof currentFont === 'object' && 'family' in currentFont && 'style' in currentFont) {
                            loadedFontFamily = currentFont.family;
                            loadedFontStyle = currentFont.style;
                        } else {
                            // If it's a symbol or can't be accessed, use defaults
                            loadedFontFamily = (operation.fontFamily && operation.fontFamily.trim() !== '') ? operation.fontFamily : 'Inter';
                            const fontWeight = (operation.fontWeight && operation.fontWeight > 0) ? operation.fontWeight : 400;

                            // Map numeric font weight to Figma style names
                            const weightToStyle = (weight: number): string => {
                                if (weight <= 300) return 'Light';
                                if (weight <= 400) return 'Regular';
                                if (weight <= 500) return 'Medium';
                                if (weight <= 600) return 'Semi Bold';
                                if (weight <= 700) return 'Bold';
                                return 'Extra Bold';
                            };
                            loadedFontStyle = weightToStyle(fontWeight);
                        }
                    } catch {
                        // If we can't get current font, use defaults
                        loadedFontFamily = (operation.fontFamily && operation.fontFamily.trim() !== '') ? operation.fontFamily : 'Inter';
                        const fontWeight = (operation.fontWeight && operation.fontWeight > 0) ? operation.fontWeight : 400;

                        // Map numeric font weight to Figma style names
                        const weightToStyle = (weight: number): string => {
                            if (weight <= 300) return 'Light';
                            if (weight <= 400) return 'Regular';
                            if (weight <= 500) return 'Medium';
                            if (weight <= 600) return 'Semi Bold';
                            if (weight <= 700) return 'Bold';
                            return 'Extra Bold';
                        };
                        loadedFontStyle = weightToStyle(fontWeight);
                    }

                    // If font family/weight is being updated, use the new values
                    if (operation.fontFamily || operation.fontWeight !== undefined) {
                        loadedFontFamily = (operation.fontFamily && operation.fontFamily.trim() !== '') ? operation.fontFamily : loadedFontFamily;
                        const fontWeight = (operation.fontWeight && operation.fontWeight > 0) ? operation.fontWeight : 400;

                        const weightToStyle = (weight: number): string => {
                            if (weight <= 300) return 'Light';
                            if (weight <= 400) return 'Regular';
                            if (weight <= 500) return 'Medium';
                            if (weight <= 600) return 'Semi Bold';
                            if (weight <= 700) return 'Bold';
                            return 'Extra Bold';
                        };
                        loadedFontStyle = weightToStyle(fontWeight);
                    }

                    // Load the font before any text operations
                    let fontLoaded = false;
                    try {
                        await figma.loadFontAsync({ family: loadedFontFamily, style: loadedFontStyle });
                        fontLoaded = true;
                    } catch (fontError) {
                        // Try fallback to Regular style
                        try {
                            await figma.loadFontAsync({ family: loadedFontFamily, style: 'Regular' });
                            loadedFontStyle = 'Regular';
                            fontLoaded = true;
                        } catch (fallbackError) {
                            // Try Inter as final fallback
                            try {
                                await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
                                loadedFontFamily = 'Inter';
                                loadedFontStyle = 'Regular';
                                fontLoaded = true;
                            } catch (finalError) {
                                // Font loading failed, but we'll still try to update text
                                // The font might already be loaded, or we can try to use existing font
                                results.errors.push(`Warning: Failed to load font: ${loadedFontFamily} ${loadedFontStyle}. Will attempt text update anyway. Error: ${finalError instanceof Error ? finalError.message : String(finalError)}`);
                                // Don't continue - try to proceed with text update anyway
                            }
                        }
                    }

                    // Set font name to ensure it's active (only if font was successfully loaded)
                    if (fontLoaded) {
                        try {
                            textNode.fontName = { family: loadedFontFamily, style: loadedFontStyle };
                        } catch (fontNameError) {
                            // Continue anyway - font should be loaded
                        }
                    } else {
                        // Try to get and use existing font if available
                        try {
                            const existingFont = textNode.fontName;
                            if (typeof existingFont === 'object' && 'family' in existingFont && 'style' in existingFont) {
                                // Use existing font - it should already be loaded
                                loadedFontFamily = existingFont.family;
                                loadedFontStyle = existingFont.style;
                            }
                        } catch {
                            // If we can't get existing font, we'll try anyway
                        }
                    }

                    // Update text content (font must be loaded first)
                    // For modify operations, only update if textContent is provided and not empty
                    // (empty string in modify operations typically means "don't change")
                    if (operation.textContent !== undefined && operation.textContent !== null && operation.textContent.trim() !== '') {
                        try {
                            // Ensure font is loaded before setting characters
                            if (!fontLoaded) {
                                // Try one more time to load the font
                                try {
                                    await figma.loadFontAsync({ family: loadedFontFamily, style: loadedFontStyle });
                                    textNode.fontName = { family: loadedFontFamily, style: loadedFontStyle };
                                    fontLoaded = true;
                                } catch {
                                    // If still fails, try with existing font or Inter
                                    try {
                                        const existingFont = textNode.fontName;
                                        if (typeof existingFont === 'object' && 'family' in existingFont && 'style' in existingFont) {
                                            await figma.loadFontAsync({ family: existingFont.family, style: existingFont.style });
                                            loadedFontFamily = existingFont.family;
                                            loadedFontStyle = existingFont.style;
                                        } else {
                                            await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
                                            loadedFontFamily = 'Inter';
                                            loadedFontStyle = 'Regular';
                                        }
                                        textNode.fontName = { family: loadedFontFamily, style: loadedFontStyle };
                                        fontLoaded = true;
                                    } catch {
                                        // Last resort - try to set anyway
                                    }
                                }
                            }

                            textNode.characters = operation.textContent;
                        } catch (charError) {
                            // Try reloading font and retrying
                            try {
                                await figma.loadFontAsync({ family: loadedFontFamily, style: loadedFontStyle });
                                textNode.fontName = { family: loadedFontFamily, style: loadedFontStyle };
                                textNode.characters = operation.textContent;
                            } catch (retryError) {
                                const errorMsg = `Failed to update text content for "${targetNode.name}": ${charError instanceof Error ? charError.message : String(charError)}`;
                                results.errors.push(errorMsg);
                            }
                        }
                    } else if (operation.textContent === '') {
                        // Empty string explicitly provided - this might be intentional, but log it
                        // Don't update if it's empty string (likely a placeholder)
                    }

                    // Update font size (font must be loaded first)
                    if (operation.fontSize !== undefined && operation.fontSize > 0) {
                        try {
                            textNode.fontSize = operation.fontSize;
                        } catch (sizeError) {
                            results.errors.push(`Failed to update font size: ${sizeError instanceof Error ? sizeError.message : String(sizeError)}`);
                        }
                    }

                    // Update text alignment (font must be loaded first)
                    if (operation.textAlign) {
                        const validAlignments = ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'];
                        if (validAlignments.indexOf(operation.textAlign) !== -1) {
                            try {
                                textNode.textAlignHorizontal = operation.textAlign;
                            } catch (alignError) {
                                // Try reloading font and retrying
                                try {
                                    await figma.loadFontAsync({ family: loadedFontFamily, style: loadedFontStyle });
                                    textNode.fontName = { family: loadedFontFamily, style: loadedFontStyle };
                                    textNode.textAlignHorizontal = operation.textAlign;
                                } catch (retryError) {
                                    results.errors.push(`Failed to update text alignment: ${alignError instanceof Error ? alignError.message : String(alignError)}`);
                                }
                            }
                        }
                    }
                }

                results.modified++;
            }
        } catch (error) {
            results.success = false;
            results.errors.push(
                `Error executing operation: ${error instanceof Error ? error.message : String(error)} `
            );
        }
    }

    return results;
}

/**
 * Main execution function - parses and executes in one call
 */
export async function executeNaturalLanguage(
    input: string | ConstraintBasedPlan,
    apiKey: string
): Promise<{
    success: boolean;
    created: number;
    modified: number;
    errors: string[];
    summary?: string;
    apiCalls: APICallInfo[];
}> {
    try {
        // Step 1: Parse input (natural language or constraint-based) to structured plan
        const { plan, apiCalls } = await parseExecutionPlan(input, apiKey);

        // Step 2: Execute the plan
        const results = await executePlan(plan);

        return {
            ...results,
            summary: plan.summary,
            apiCalls: apiCalls,
        };
    } catch (error) {
        return {
            success: false,
            created: 0,
            modified: 0,
            errors: [error instanceof Error ? error.message : String(error)],
            apiCalls: [],
        };
    }
}

