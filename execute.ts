// ============================================================================
// EXECUTE
// Executes structured JSON operations in Figma
// ============================================================================

import { ExecutionPlan, ExecutionOperation, APICallInfo, ConstraintBasedPlan, parseExecutionPlan } from './operations';

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
            const isFigmaId = targetId.includes(':');

            // Try to find by ID first (Figma node ID) - prioritize this for exact matching
            const found = findNodeById(targetId);
            if (found) {
                // If preferredType is specified, verify it matches
                if (!preferredType || found.type === preferredType) {
                    return found;
                }
                // If it's a Figma ID but wrong type, don't fall back to name search
                if (isFigmaId) {
                    return null; // Exact ID found but wrong type - fail rather than fuzzy match
                }
            }

            // If targetId is a Figma ID format but not found, don't try name matching
            if (isFigmaId && !found) {
                return null; // Exact ID not found - fail rather than fuzzy match
            }

            // NO FUZZY MATCHING - only allow exact name matches for newly created shapes in cache
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
        return null;
    }

    // Sort operations to ensure containers are created before text operations that reference them
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
                let textBoxPositionSet = false;
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

                        // Double-check: verify font is actually loaded
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
                        try {
                            await figma.loadFontAsync({ family: loadedFontFamily, style: loadedFontStyle });
                            textNode.fontName = { family: loadedFontFamily, style: loadedFontStyle };
                        } catch (fontNameError) {
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

                        // Handle text box positioning if specified
                        let textBoxContainer: SceneNode | null = null;

                        if ((operation.textBoxId && operation.textBoxId.trim() !== '') ||
                            (operation.textBoxDescription && operation.textBoxDescription.trim() !== '')) {
                            // Find the text box container (rectangle)
                            textBoxContainer = findShapeByIdOrDescription(operation.textBoxId, operation.textBoxDescription);

                            if (textBoxContainer) {
                                const padding = operation.padding || { top: 0, right: 0, bottom: 0, left: 0 };

                                // Get the rectangle's position relative to its parent (the frame)
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
                if (normalizedType !== 'text' || !textBoxPositionSet) {
                    if (operation.x !== undefined && operation.y !== undefined) {
                        newNode.x = operation.x;
                        newNode.y = operation.y;
                    }
                }

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
                let targetParent: SceneNode | null = null;
                if (normalizedType === 'text' &&
                    ((operation.textBoxId && operation.textBoxId.trim() !== '') ||
                        (operation.textBoxDescription && operation.textBoxDescription.trim() !== ''))) {
                    // Find the text box container (rectangle) to get its parent (the frame)
                    const textBoxContainer = findShapeByIdOrDescription(operation.textBoxId, operation.textBoxDescription);

                    if (textBoxContainer && textBoxContainer.parent && textBoxContainer.parent.type !== 'PAGE') {
                        // Use the same parent as the text box (the frame)
                        if ('appendChild' in textBoxContainer.parent && typeof textBoxContainer.parent.appendChild === 'function') {
                            targetParent = textBoxContainer.parent as SceneNode;
                        }
                    }

                    // If we couldn't get the parent from the rectangle, try to find the container from the operation
                    if (!targetParent && operation.container) {
                        targetParent = findContainer(operation.container);
                    }

                    // Last resort: if still no parent, the rectangle might be on the page
                    if (!targetParent && textBoxContainer && textBoxContainer.parent && textBoxContainer.parent.type === 'PAGE') {
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
                    if (operation.container || hasTextBoxForText) {
                        const containerName = hasTextBoxForText
                            ? (operation.textBoxId || operation.textBoxDescription || '')
                            : operation.container;
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

                // Step 2: Find the target node by name
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
                if (operation.x !== undefined && operation.x !== 0 && 'x' in targetNode) {
                    targetNode.x = operation.x;
                }
                if (operation.y !== undefined && operation.y !== 0 && 'y' in targetNode) {
                    targetNode.y = operation.y;
                }

                // Update size (only for nodes that support resize)
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
                if (operation.fills && operation.fills.length > 0 && 'fills' in targetNode) {
                    const normalizedFills: SolidPaint[] = operation.fills.map((fill) => ({
                        type: 'SOLID',
                        color: fill.color,
                        opacity: fill.opacity !== undefined ? fill.opacity : 1
                    }));
                    targetNode.fills = normalizedFills;
                }

                // Update strokes (only for nodes that support strokes)
                // Empty array [] means "don't change" (schema placeholder)
                if (operation.strokes && operation.strokes.length > 0 && 'strokes' in targetNode) {
                    const normalizedStrokes: SolidPaint[] = operation.strokes.map((stroke) => ({
                        type: 'SOLID',
                        color: stroke.color,
                        opacity: stroke.opacity !== undefined ? stroke.opacity : 1
                    }));
                    targetNode.strokes = normalizedStrokes;
                }

                // Update strokeWeight - only if explicitly provided and non-zero
                if (operation.strokeWeight !== undefined && operation.strokeWeight > 0 && 'strokeWeight' in targetNode) {
                    targetNode.strokeWeight = operation.strokeWeight;
                }

                // Update type-specific properties
                // cornerRadius: 0 in modify operations typically means "don't change" (schema placeholder)
                if (targetNode.type === 'RECTANGLE' && operation.cornerRadius !== undefined && operation.cornerRadius > 0) {
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

                // Update opacity - only if explicitly provided and non-zero
                if (operation.opacity !== undefined && operation.opacity > 0 && 'opacity' in targetNode) {
                    targetNode.opacity = operation.opacity;
                }

                // Update rotation
                if (operation.rotation !== undefined && 'rotation' in targetNode) {
                    targetNode.rotation = (operation.rotation * Math.PI) / 180;
                }

                // Update name - only if explicitly provided and not empty
                if (operation.name && operation.name.trim() !== '') {
                    targetNode.name = operation.name;
                }

                // Update text-specific properties (for TEXT nodes)
                if (targetNode.type === 'TEXT') {
                    const textNode = targetNode as TextNode;

                    // CRITICAL: Load font FIRST before any text operations
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
                                results.errors.push(`Warning: Failed to load font: ${loadedFontFamily} ${loadedFontStyle}. Will attempt text update anyway. Error: ${finalError instanceof Error ? finalError.message : String(finalError)}`);
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

