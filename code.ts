// ============================================================================
// PICASSO - AI-Powered Layout Assistant for Figma
// Architecture: Constraint-Based Multi-Stage Pipeline
// ============================================================================

import { detectConstraints, computeConstraintDiff, Constraint, isConstraintSatisfied } from './constraints';
import { quickSolve } from './solver';

figma.showUI(__html__, { width: 350, height: 400 });

// Get API key from environment variable or plugin storage
// For Figma plugins, you should store this securely in plugin settings
const OPENAI_API_KEY = ''; // TODO: Load from secure storage

let isTracking = false;
let isSyncing = false;
let trackingInterval: number | null = null;
let previousCanvasState: CanvasState | null = null;
let previousConstraints: Constraint[] = [];

interface CanvasObject {
    id: string;
    name: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    parentId?: string;
}

interface CanvasState {
    objects: CanvasObject[];
    timestamp: number;
}

interface MovementInfo {
    objectId: string;
    objectName: string;
    from: { x: number; y: number };
    to: { x: number; y: number };
    delta: { dx: number; dy: number };
}

interface LayoutAction {
    objectId: string;
    newX: number;
    newY: number;
    reasoning: string;
}

interface LLMResponse {
    interpretation: string;
    actions: LayoutAction[];
}


function captureCanvasState(): CanvasState {
    const objects: CanvasObject[] = [];

    // Get only top-level nodes on the current page (no children)
    for (const node of figma.currentPage.children) {
        // Include all top-level objects (frames, groups, and individual shapes)
        if ('x' in node && 'y' in node && 'width' in node && 'height' in node) {
            objects.push({
                id: node.id,
                name: node.name,
                type: node.type,
                x: Math.round(node.x),
                y: Math.round(node.y),
                width: Math.round(node.width),
                height: Math.round(node.height),
            });
        }
    }

    return {
        objects,
        timestamp: Date.now(),
    };
}


function detectMovement(before: CanvasState, after: CanvasState): MovementInfo | null {
    // Find objects that moved
    for (const afterObj of after.objects) {
        const beforeObj = before.objects.find(obj => obj.id === afterObj.id);

        if (!beforeObj) continue; // New object, skip

        const dx = afterObj.x - beforeObj.x;
        const dy = afterObj.y - beforeObj.y;

        // Check if moved significantly (more than 1px)
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
            return {
                objectId: afterObj.id,
                objectName: afterObj.name,
                from: { x: beforeObj.x, y: beforeObj.y },
                to: { x: afterObj.x, y: afterObj.y },
                delta: { dx, dy },
            };
        }
    }

    return null;
}


async function captureCanvasScreenshot(): Promise<string | null> {
    try {
        // Get all nodes on the current page
        const nodes = figma.currentPage.children;

        if (nodes.length === 0) return null;

        // Export the entire page directly
        const imageBytes = await figma.currentPage.exportAsync({
            format: 'PNG',
            constraint: { type: 'SCALE', value: 1 } // 1x resolution to keep size manageable
        });

        // Convert to base64
        const base64 = figma.base64Encode(imageBytes);

        return base64;
    } catch (error) {
        console.error('Failed to capture screenshot:', error);
        return null;
    }
}


interface UserIntent {
    description: string;
    targetPattern: string;
    alignmentType: string;
    spacingRequirement: string;
    objectsToMove: string[];
    objectsToKeepFixed: string[];
    fixedObjectsReasoning: string;
    constraintsToSatisfy?: any[]; // Target constraints that should be met
}

// AGENT 1: Intent Extraction Agent
async function extractUserIntent(
    canvasState: CanvasState,
    movement: MovementInfo
): Promise<UserIntent> {
    const movedObject = canvasState.objects.find(obj => obj.id === movement.objectId);
    const screenshot = await captureCanvasScreenshot();

    const prompt = `You are an expert UI/UX intent analyzer. A user just moved an object on a canvas. Your job is to:
1. Extract the user's intent
2. Identify which objects should MOVE to satisfy the intent
3. Identify which objects should stay FIXED (anchored)

CANVAS STATE (all objects):
${JSON.stringify(canvasState.objects, null, 2)}

USER ACTION:
- Moved Object ID: "${movement.objectId}"
- Moved: "${movement.objectName}" (type: ${movedObject?.type})
- From: (${movement.from.x}, ${movement.from.y})
- To: (${movement.to.x}, ${movement.to.y})
- Movement: dx=${movement.delta.dx}, dy=${movement.delta.dy}

EXTRACT THE USER'S INTENT:

1. What is the user trying to accomplish?
   - Creating a grid layout?
   - Aligning objects vertically/horizontally?
   - Adjusting spacing between similar elements?
   - Repositioning a group of related objects?

2. What pattern are they establishing?
   - Identify similar/related objects by name, size, or type
   - Determine if they form rows, columns, or grids
   - Detect any grouping or hierarchy

3. What alignment type is intended?
   - Vertical alignment (same X coordinates)?
   - Horizontal alignment (same Y coordinates)?
   - Grid alignment (both)?
   - Specific spacing pattern?

4. CRITICAL - IDENTIFY OBJECTS TO MOVE vs KEEP FIXED:
   
   A. Objects to KEEP FIXED (anchored):
      - The moved object ALWAYS starts as fixed (it's where the user placed it)
      - Any objects that are ALREADY well-aligned and shouldn't move
      - Objects that serve as reference points for the layout
      - List their IDs in "objectsToKeepFixed"
   
   B. Objects to MOVE:
      - Objects that need to be repositioned to match the intent
      - Objects that should align with the fixed objects
      - Similar/related objects that form the same pattern
      - List their IDs in "objectsToMove"
   
   RULE: The moved object ID ("${movement.objectId}") should ALWAYS be in objectsToKeepFixed
   RULE: An object can ONLY be in ONE list - either objectsToMove OR objectsToKeepFixed

5. Spacing and Margins:
   - Identify proper padding/margins to maintain
   - Note if spacing should be uniform across similar elements

Be specific and precise. The arrangement agent will ONLY move objects in "objectsToMove".`;

    const intentSchema = {
        type: "object",
        properties: {
            description: {
                type: "string",
                description: "Clear description of what the user is trying to accomplish"
            },
            targetPattern: {
                type: "string",
                description: "The layout pattern being created (e.g., '3-column grid', 'vertical stack', 'horizontal row with equal spacing')"
            },
            alignmentType: {
                type: "string",
                description: "Type of alignment needed (e.g., 'vertical', 'horizontal', 'grid', 'none')"
            },
            spacingRequirement: {
                type: "string",
                description: "Spacing requirements including padding and margins (e.g., '20px between items with 16px padding', 'equal spacing with consistent margins')"
            },
            objectsToMove: {
                type: "array",
                items: {
                    type: "string",
                    description: "Object IDs that should be repositioned to satisfy the intent"
                }
            },
            objectsToKeepFixed: {
                type: "array",
                items: {
                    type: "string",
                    description: "Object IDs that should remain in their current positions (MUST include the moved object ID)"
                }
            },
            fixedObjectsReasoning: {
                type: "string",
                description: "Explanation of why certain objects should stay fixed"
            }
        },
        required: ["description", "targetPattern", "alignmentType", "spacingRequirement", "objectsToMove", "objectsToKeepFixed", "fixedObjectsReasoning"],
        additionalProperties: false
    };

    const messages: any[] = [
        {
            role: 'system',
            content: 'You are an expert at understanding user intent in UI/UX design. You analyze movements and extract the underlying goal.',
        },
    ];

    if (screenshot) {
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
                        url: `data:image/png;base64,${screenshot}`,
                        detail: 'high'
                    }
                }
            ]
        });
    } else {
        messages.push({
            role: 'user',
            content: prompt,
        });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: 'gpt-4o-2024-08-06',
            messages: messages,
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "user_intent",
                    strict: true,
                    schema: intentSchema
                }
            },
            temperature: 0.3,
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Intent extraction error');
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || '{"description":"","targetPattern":"","alignmentType":"none","spacingRequirement":"","affectedObjects":[]}';

    return JSON.parse(content);
}


interface ArrangementEvaluation {
    intentSatisfied: boolean;
    issues: string[];
    corrections: LayoutAction[];
}

// AGENT 2: Arrangement Agent
async function evaluateArrangement(
    canvasState: CanvasState,
    userIntent: UserIntent,
    iterationNumber: number
): Promise<ArrangementEvaluation> {
    const screenshot = await captureCanvasScreenshot();

    const prompt = `You are an expert UI/UX arrangement validator. You have been given a SPECIFIC USER INTENT that MUST be satisfied.

ITERATION: ${iterationNumber}/5

USER INTENT (THIS IS YOUR ONLY GOAL):
- Description: ${userIntent.description}
- Target Pattern: ${userIntent.targetPattern}
- Alignment Type: ${userIntent.alignmentType}
- Spacing Requirement: ${userIntent.spacingRequirement}

OBJECTS TO MOVE (you can ONLY reposition these):
${JSON.stringify(userIntent.objectsToMove)}

OBJECTS TO KEEP FIXED (NEVER touch these):
${JSON.stringify(userIntent.objectsToKeepFixed)}
Reasoning: ${userIntent.fixedObjectsReasoning}

CURRENT CANVAS STATE:
${JSON.stringify(canvasState.objects, null, 2)}

YOUR MISSION:
Evaluate if the current layout satisfies the user intent described above.

CRITICAL RULES:
1. ONLY focus on satisfying the USER INTENT - nothing else matters
2. You can ONLY move objects that are in the "objectsToMove" list
3. You MUST NEVER move objects that are in the "objectsToKeepFixed" list
4. Do NOT add your own interpretation or improvements
5. Be PRACTICAL - mark intentSatisfied=true when the intent is reasonably well satisfied

EVALUATION CRITERIA:

1. ALIGNMENT CHECK (${userIntent.alignmentType}):
   ${userIntent.alignmentType === 'vertical' ? '- Related objects should have similar X coordinates (within 5px tolerance is acceptable)' : ''}
   ${userIntent.alignmentType === 'horizontal' ? '- Related objects should have similar Y coordinates (within 5px tolerance is acceptable)' : ''}
   ${userIntent.alignmentType === 'grid' ? '- Objects should generally align in rows and columns (within 5px tolerance)' : ''}
   - Use the screenshot AND coordinate data to verify alignment
   - Minor misalignments (< 5px) are acceptable if the overall pattern is clear

2. SPACING CHECK (${userIntent.spacingRequirement}):
   - Spacing should be reasonably consistent between elements
   - Tolerance: ±5px variance is acceptable
   - The general spacing pattern should match the requirement
   - Example: "20px spacing" means gaps of 15-25px are acceptable

3. PATTERN CHECK (${userIntent.targetPattern}):
   - Verify the layout generally matches the described pattern
   - The overall structure should be recognizable
   - Minor variations are acceptable if the intent is clear

4. NO OVERLAPS:
   - Check if any objects significantly overlap (minor edge overlaps < 2px are OK)
   - Only mark as issue if overlap is visually problematic

5. PADDING CHECK:
   - Elements should have reasonable breathing room
   - Minimum 5px padding is generally acceptable
   - Elements don't need to be perfectly spaced, just not cramped

BE REASONABLE AND PRACTICAL:
- Focus on whether the intent is achieved, not pixel perfection
- If the layout looks good and serves the intent, mark intentSatisfied=true
- Only provide corrections for significant issues that clearly violate the intent
- Don't nitpick small alignment differences if the overall pattern is correct
- The goal is a good, usable layout - not mathematical perfection

If the intent is reasonably satisfied, return intentSatisfied=true with empty issues and corrections.
Only provide corrections if there are CLEAR, SIGNIFICANT issues that prevent the intent from being achieved.
IMPORTANT: Only suggest corrections for objects in the "objectsToMove" list.`;

    const evaluationSchema = {
        type: "object",
        properties: {
            intentSatisfied: {
                type: "boolean",
                description: "True only if the user intent is perfectly satisfied"
            },
            issues: {
                type: "array",
                items: {
                    type: "string",
                    description: "Specific ways the current layout fails to match the user intent"
                }
            },
            corrections: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        objectId: {
                            type: "string",
                            description: "The ID of the object to move"
                        },
                        newX: {
                            type: "number",
                            description: "New X position to satisfy the intent"
                        },
                        newY: {
                            type: "number",
                            description: "New Y position to satisfy the intent"
                        },
                        reasoning: {
                            type: "string",
                            description: "How this correction helps satisfy the user intent"
                        }
                    },
                    required: ["objectId", "newX", "newY", "reasoning"],
                    additionalProperties: false
                }
            }
        },
        required: ["intentSatisfied", "issues", "corrections"],
        additionalProperties: false
    };

    const messages: any[] = [
        {
            role: 'system',
            content: 'You are a practical UI/UX arrangement validator. You verify that layouts reasonably satisfy the user intent. Be pragmatic - focus on whether the intent is achieved, not pixel perfection. Mark intentSatisfied=true when the layout clearly serves the intended purpose, even if there are minor imperfections. Use both the screenshot AND coordinate data to evaluate.',
        },
    ];

    if (screenshot) {
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
                        url: `data:image/png;base64,${screenshot}`,
                        detail: 'high'
                    }
                }
            ]
        });
    } else {
        messages.push({
            role: 'user',
            content: prompt,
        });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: 'gpt-4o-2024-08-06',
            messages: messages,
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "arrangement_evaluation",
                    strict: true,
                    schema: evaluationSchema
                }
            },
            temperature: 0.4,
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Arrangement evaluation error');
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || '{"intentSatisfied":true,"issues":[],"corrections":[]}';

    return JSON.parse(content);
}


async function arrangeUntilIntentSatisfied(userIntent: UserIntent): Promise<void> {
    const MAX_ITERATIONS = 10;
    let iteration = 0;

    figma.ui.postMessage({
        type: 'arrangement-started',
        intent: userIntent.description,
    });

    while (iteration < MAX_ITERATIONS) {
        iteration++;

        figma.ui.postMessage({
            type: 'arrangement-iteration',
            iteration,
            maxIterations: MAX_ITERATIONS,
        });

        // Capture current state
        const currentState = captureCanvasState();

        // Evaluate if intent is satisfied
        const evaluation = await evaluateArrangement(currentState, userIntent, iteration);

        figma.ui.postMessage({
            type: 'arrangement-evaluation',
            iteration,
            intentSatisfied: evaluation.intentSatisfied,
            issues: evaluation.issues,
            correctionsCount: evaluation.corrections.length,
        });

        // Log evaluation details for debugging
        console.log(`Iteration ${iteration} Evaluation:`, {
            intentSatisfied: evaluation.intentSatisfied,
            issuesCount: evaluation.issues.length,
            issues: evaluation.issues,
            correctionsCount: evaluation.corrections.length,
        });

        if (evaluation.intentSatisfied) {
            figma.ui.postMessage({
                type: 'arrangement-complete',
                message: `✨ Intent satisfied in ${iteration} iteration(s)!`,
                iterations: iteration,
            });
            figma.notify(`✨ Intent perfectly satisfied in ${iteration} iteration(s)!`);
            return;
        }

        if (evaluation.corrections.length === 0) {
            console.log('No corrections suggested, but intent not satisfied. Issues:', evaluation.issues);
            figma.ui.postMessage({
                type: 'arrangement-complete',
                message: `⚠️ No more corrections suggested after ${iteration} iteration(s).`,
                iterations: iteration,
            });
            figma.notify(`Arrangement completed after ${iteration} iteration(s).`);
            return;
        }

        // Apply corrections to satisfy intent (with validation)
        await applyLayoutActionsWithValidation(evaluation.corrections, userIntent.objectsToKeepFixed);

        // Small delay to let Figma update
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    figma.ui.postMessage({
        type: 'arrangement-complete',
        message: `Reached maximum iterations (${MAX_ITERATIONS}).`,
        iterations: MAX_ITERATIONS,
    });
    figma.notify(`Arrangement completed after ${MAX_ITERATIONS} iterations.`);
}


// Legacy function - now replaced by two-agent system
async function interpretAndArrange(
    canvasState: CanvasState,
    movement: MovementInfo
): Promise<LLMResponse> {
    const movedObject = canvasState.objects.find(obj => obj.id === movement.objectId);

    // Capture screenshot of the canvas
    const screenshot = await captureCanvasScreenshot();

    const prompt = `You are an expert UI/UX design assistant. A user just moved an object on a canvas, and you need to interpret their intent and suggest how to arrange ALL other objects accordingly.

NOTE: You are also provided with a visual screenshot of the current canvas state to help you better understand the layout.

CANVAS STATE (all objects):
${JSON.stringify(canvasState.objects, null, 2)}

USER ACTION:
- Moved: "${movement.objectName}" (type: ${movedObject?.type})
- From: (${movement.from.x}, ${movement.from.y})
- To: (${movement.to.x}, ${movement.to.y})
- Movement: dx=${movement.delta.dx}, dy=${movement.delta.dy}

ANALYSIS GUIDELINES:
1. Look for PATTERNS in object names, sizes, and positions
   - Similar names (e.g., "Card 1", "Card 2", "Card 3")
   - Similar sizes (likely related components)
   - Current layout (horizontal/vertical alignment, grids, etc.)

2. INTERPRET THE INTENT based on the movement:
   - If moved within a similar group → apply same position change to all group members
   - If changed alignment direction (horizontal → vertical) → reflow entire layout
   - If adjusted spacing → maintain consistent spacing across similar objects
   - If repositioned in pattern → update pattern for all similar objects

3. ALIGNMENT AND SPACING REQUIREMENTS (CRITICAL):
   - Elements MUST align with consistent padding and margin
   - Elements MUST be arranged within the same grids or columns
   - ALWAYS rearrange assets so that MOST elements align vertically AND horizontally
   - When moving objects, NEVER place them in positions that break existing alignments
   - Maintain or improve alignment - if elements share the same X or Y coordinate, keep them aligned
   - Preserve vertical alignment (same X coordinates) for elements in the same column
   - Preserve horizontal alignment (same Y coordinates) for elements in the same row
   - Ensure uniform spacing between similar elements
   - Ensure visual consistency across the entire layout
   - NEVER move objects directly on top of other objects or overlapping them
   - Always maintain clear spacing between different objects to avoid collisions
   - Check object dimensions (width, height) to ensure new positions don't cause overlaps

4. SUGGEST POSITIONS for other objects that should move
   - Don't move the object the user just moved
   - Only move objects that make logical sense
   - Preserve intentional placements
   - PRIORITIZE maintaining or creating alignment over other considerations

Examples:
- User moves icon inside "Metric 2" → Move icons in "Metric 1", "Metric 3", "Metric 4" to same relative position
- User moves "Email" input below "Name" input → Stack all form inputs vertically
- User adjusts spacing in grid → Apply spacing to all grid items

Respond with your interpretation and specific position changes for other objects.`;

    const responseSchema = {
        type: "object",
        properties: {
            interpretation: {
                type: "string",
                description: "Your understanding of what the user is trying to accomplish"
            },
            actions: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        objectId: {
                            type: "string",
                            description: "The ID of the object to move"
                        },
                        newX: {
                            type: "number",
                            description: "New X position"
                        },
                        newY: {
                            type: "number",
                            description: "New Y position"
                        },
                        reasoning: {
                            type: "string",
                            description: "Why this object should be moved"
                        }
                    },
                    required: ["objectId", "newX", "newY", "reasoning"],
                    additionalProperties: false
                }
            }
        },
        required: ["interpretation", "actions"],
        additionalProperties: false
    };

    // Prepare messages with optional screenshot
    const messages: any[] = [
        {
            role: 'system',
            content: 'You are an expert UI/UX design assistant. Analyze layout patterns and user intent to suggest intelligent object arrangements.',
        },
    ];

    // Add user message with text and optional image
    if (screenshot) {
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
                        url: `data:image/png;base64,${screenshot}`,
                        detail: 'high'
                    }
                }
            ]
        });
    } else {
        messages.push({
            role: 'user',
            content: prompt,
        });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: 'gpt-4o-2024-08-06',
            messages: messages,
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "layout_response",
                    strict: true,
                    schema: responseSchema
                }
            },
            temperature: 0.7,
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'LLM API error');
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || '{"interpretation":"","actions":[]}';

    return JSON.parse(content);
}


interface ValidationResponse {
    isAligned: boolean;
    issues: string[];
    suggestions: LayoutAction[];
}

async function validateAlignment(canvasState: CanvasState, iterationNumber: number): Promise<ValidationResponse> {
    const screenshot = await captureCanvasScreenshot();

    const prompt = `You are an expert UI/UX design validator. Analyze the current layout and determine if all elements are perfectly aligned.

VALIDATION ITERATION: ${iterationNumber}

CANVAS STATE (all objects):
${JSON.stringify(canvasState.objects, null, 2)}

VALIDATION CRITERIA:
1. VERTICAL ALIGNMENT:
   - Elements in the same column MUST have identical X coordinates
   - Check if elements that should be vertically aligned share the same X position

2. HORIZONTAL ALIGNMENT:
   - Elements in the same row MUST have identical Y coordinates
   - Check if elements that should be horizontally aligned share the same Y position

3. CONSISTENT SPACING:
   - Gaps between similar elements should be uniform
   - Measure spacing between consecutive elements in rows/columns

4. NO OVERLAPS:
   - No objects should overlap or be positioned on top of each other
   - Check object boundaries (x, y, width, height)

5. GRID ALIGNMENT:
   - Similar elements should form clear grids or columns
   - Elements should maintain visual rhythm and consistency

ANALYZE THE SCREENSHOT and the object data. If ANY alignment issues exist, provide specific corrections.
Mark isAligned as true ONLY if the layout is PERFECT with no alignment issues whatsoever.`;

    const validationSchema = {
        type: "object",
        properties: {
            isAligned: {
                type: "boolean",
                description: "True only if the layout is perfectly aligned with no issues"
            },
            issues: {
                type: "array",
                items: {
                    type: "string",
                    description: "Specific alignment issues found"
                }
            },
            suggestions: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        objectId: {
                            type: "string",
                            description: "The ID of the object to move"
                        },
                        newX: {
                            type: "number",
                            description: "New X position for perfect alignment"
                        },
                        newY: {
                            type: "number",
                            description: "New Y position for perfect alignment"
                        },
                        reasoning: {
                            type: "string",
                            description: "Why this adjustment is needed"
                        }
                    },
                    required: ["objectId", "newX", "newY", "reasoning"],
                    additionalProperties: false
                }
            }
        },
        required: ["isAligned", "issues", "suggestions"],
        additionalProperties: false
    };

    const messages: any[] = [
        {
            role: 'system',
            content: 'You are an expert UI/UX design validator. You have a keen eye for perfect alignment and spacing.',
        },
    ];

    if (screenshot) {
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
                        url: `data:image/png;base64,${screenshot}`,
                        detail: 'high'
                    }
                }
            ]
        });
    } else {
        messages.push({
            role: 'user',
            content: prompt,
        });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: 'gpt-4o-2024-08-06',
            messages: messages,
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "validation_response",
                    strict: true,
                    schema: validationSchema
                }
            },
            temperature: 0.3,
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Validation API error');
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || '{"isAligned":true,"issues":[],"suggestions":[]}';

    return JSON.parse(content);
}

async function refineLayoutUntilPerfect(initialActions: LayoutAction[]): Promise<void> {
    const MAX_ITERATIONS = 5;
    let iteration = 0;

    // Apply initial changes
    await applyLayoutActions(initialActions);
    figma.ui.postMessage({
        type: 'refinement-started',
        message: 'Starting alignment refinement process...',
    });

    while (iteration < MAX_ITERATIONS) {
        iteration++;

        figma.ui.postMessage({
            type: 'validation-step',
            iteration,
            message: `Validation iteration ${iteration}/${MAX_ITERATIONS}...`,
        });

        // Capture current state
        const currentState = captureCanvasState();

        // Validate alignment
        const validation = await validateAlignment(currentState, iteration);

        figma.ui.postMessage({
            type: 'validation-result',
            iteration,
            isAligned: validation.isAligned,
            issues: validation.issues,
            suggestionsCount: validation.suggestions.length,
        });

        if (validation.isAligned) {
            figma.ui.postMessage({
                type: 'refinement-complete',
                message: `✨ Perfect alignment achieved in ${iteration} iteration(s)!`,
            });
            figma.notify(`✨ Perfect alignment achieved in ${iteration} iteration(s)!`);
            return;
        }

        if (validation.suggestions.length === 0) {
            figma.ui.postMessage({
                type: 'refinement-complete',
                message: `No more refinements suggested after ${iteration} iteration(s).`,
            });
            return;
        }

        // Apply refinement suggestions
        await applyLayoutActions(validation.suggestions);

        // Small delay to let Figma update
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    figma.ui.postMessage({
        type: 'refinement-complete',
        message: `Refinement completed after ${MAX_ITERATIONS} iterations.`,
    });
    figma.notify(`Alignment refinement completed after ${MAX_ITERATIONS} iterations.`);
}


async function applyLayoutActions(actions: LayoutAction[]): Promise<void> {
    for (const action of actions) {
        try {
            const node = await figma.getNodeByIdAsync(action.objectId);
            if (node && ('x' in node) && ('y' in node)) {
                node.x = action.newX;
                node.y = action.newY;
                console.log(`Moved ${node.name}: ${action.reasoning}`);
            }
        } catch (e) {
            console.log(`Failed to move object ${action.objectId}:`, e);
        }
    }
}

async function applyLayoutActionsWithValidation(actions: LayoutAction[], fixedObjectIds: string[]): Promise<void> {
    for (const action of actions) {
        // Validate that we're not trying to move a fixed object
        if (fixedObjectIds.indexOf(action.objectId) !== -1) {
            console.warn(`⚠️ Skipping move for fixed object ${action.objectId}`);
            figma.ui.postMessage({
                type: 'error',
                message: `Warning: Attempted to move fixed object (${action.objectId}). Skipped.`,
            });
            continue;
        }

        try {
            const node = await figma.getNodeByIdAsync(action.objectId);
            if (node && ('x' in node) && ('y' in node)) {
                node.x = action.newX;
                node.y = action.newY;
                console.log(`Moved ${node.name}: ${action.reasoning}`);
            }
        } catch (e) {
            console.log(`Failed to move object ${action.objectId}:`, e);
        }
    }
}


let lastKnownState: CanvasState | null = null;
let hasMovedSinceLastCheck = false;

async function startTracking() {
    if (isTracking) return;

    // Capture initial state
    previousCanvasState = captureCanvasState();
    lastKnownState = previousCanvasState;
    hasMovedSinceLastCheck = false;
    isSyncing = false;

    isTracking = true;
    figma.ui.postMessage({ type: 'tracking-started' });

    // Poll for changes every 300ms
    trackingInterval = setInterval(async () => {
        if (!isTracking) {
            if (trackingInterval) {
                clearInterval(trackingInterval);
                trackingInterval = null;
            }
            return;
        }

        const currentState = captureCanvasState();

        // Detect if anything moved
        const movement = lastKnownState ? detectMovement(lastKnownState, currentState) : null;

        if (movement) {
            // Something is moving
            hasMovedSinceLastCheck = true;
            lastKnownState = currentState;
        } else if (hasMovedSinceLastCheck && !isSyncing) {
            // Movement stopped, trigger LLM
            hasMovedSinceLastCheck = false;
            isSyncing = true;

            // Find the movement that occurred
            const finalMovement = previousCanvasState ?
                detectMovement(previousCanvasState, currentState) : null;

            if (finalMovement) {
                figma.ui.postMessage({
                    type: 'processing',
                    message: `Analyzing movement of "${finalMovement.objectName}"...`,
                });

                try {
                    // AGENT 1: Extract user intent
                    figma.ui.postMessage({
                        type: 'intent-extraction',
                        message: 'Extracting user intent...',
                    });

                    const userIntent = await extractUserIntent(currentState, finalMovement);

                    figma.ui.postMessage({
                        type: 'intent-extracted',
                        intent: userIntent.description,
                        pattern: userIntent.targetPattern,
                        objectsToMoveCount: userIntent.objectsToMove.length,
                        objectsToKeepFixedCount: userIntent.objectsToKeepFixed.length,
                        fixedReasoning: userIntent.fixedObjectsReasoning,
                    });

                    // AGENT 2: Arrange until intent is satisfied
                    await arrangeUntilIntentSatisfied(userIntent);

                    // Update state after changes
                    previousCanvasState = captureCanvasState();
                    lastKnownState = previousCanvasState;

                    figma.notify(`✨ ${userIntent.description}`);
                } catch (error) {
                    figma.ui.postMessage({
                        type: 'error',
                        message: error instanceof Error ? error.message : 'Failed to process layout',
                    });
                } finally {
                    isSyncing = false;
                }
            } else {
                isSyncing = false;
            }
        }
    }, 300) as unknown as number;
}

function stopTracking() {
    isTracking = false;
    if (trackingInterval) {
        clearInterval(trackingInterval);
        trackingInterval = null;
    }
    figma.ui.postMessage({ type: 'tracking-stopped' });
    figma.notify('Tracking stopped');
}

// ============================================================================
// CONSTRAINT-BASED ARCHITECTURE
// Multi-Stage Pipeline: Constraints → Quick Solve → Intent → LLM Refinement
// ============================================================================

async function arrangeWithConstraints(movement: MovementInfo, canvasState: CanvasState): Promise<void> {
    try {
        // STAGE 1: LLM extracts intent and defines target constraints
        figma.ui.postMessage({ type: 'processing', message: '🤖 Analyzing user intent and desired layout...' });

        const intent = await extractUserIntent(canvasState, movement);

        figma.ui.postMessage({
            type: 'intent-result',
            intent: {
                description: intent.description,
                targetPattern: intent.targetPattern,
                objectsToMove: intent.objectsToMove.length,
                objectsToKeepFixed: intent.objectsToKeepFixed.length
            }
        });

        // STAGE 2: Iterative refinement until constraints are met
        const MAX_ITERATIONS = 10;
        let iteration = 0;
        let allConstraintsMet = false;
        let llmApproved = false;

        while (iteration < MAX_ITERATIONS && !llmApproved) {
            iteration++;

            figma.ui.postMessage({
                type: 'processing',
                message: `🔄 Iteration ${iteration}/${MAX_ITERATIONS}: Arranging objects...`
            });

            // Get current state
            const currentState = captureCanvasState();

            // Ask LLM to generate arrangement
            const llmResponse = await interpretAndArrange(currentState, movement);

            // Apply the arrangement
            if (llmResponse.actions.length > 0) {
                await applyLayoutActions(llmResponse.actions);

                figma.ui.postMessage({
                    type: 'processing',
                    message: `📐 Applied ${llmResponse.actions.length} adjustments`
                });
            }

            // STAGE 3: Check if target constraints are satisfied
            const stateAfterArrangement = captureCanvasState();
            const currentConstraints = detectConstraints(stateAfterArrangement.objects);

            // Check if intent-defined constraints are met
            if (intent.constraintsToSatisfy && intent.constraintsToSatisfy.length > 0) {
                const objectsMap = new Map(stateAfterArrangement.objects.map(obj => [obj.id, obj]));
                const satisfiedCount = intent.constraintsToSatisfy.filter(c =>
                    isConstraintSatisfied(c, objectsMap)
                ).length;

                allConstraintsMet = satisfiedCount === intent.constraintsToSatisfy.length;

                figma.ui.postMessage({
                    type: 'processing',
                    message: `✓ Constraints: ${satisfiedCount}/${intent.constraintsToSatisfy.length} satisfied`
                });
            } else {
                allConstraintsMet = true; // No specific constraints to check
            }

            // STAGE 4: LLM validates the result (skip some iterations for speed)
            const shouldValidate = allConstraintsMet || iteration % 2 === 0 || iteration >= MAX_ITERATIONS;

            if (shouldValidate) {
                figma.ui.postMessage({
                    type: 'processing',
                    message: `🔍 Validating arrangement quality...`
                });

                const validation = await evaluateArrangement(stateAfterArrangement, intent, iteration);
                llmApproved = validation.intentSatisfied;

                if (llmApproved && allConstraintsMet) {
                    figma.ui.postMessage({
                        type: 'success',
                        message: `✨ Layout perfected in ${iteration} iteration${iteration > 1 ? 's' : ''}!`
                    });

                    // Update constraints for next time
                    previousConstraints = currentConstraints;
                    return;
                } else if (!llmApproved && validation.issues.length > 0) {
                    figma.ui.postMessage({
                        type: 'processing',
                        message: `⚠️ Issues: ${validation.issues.slice(0, 2).join(', ')}${validation.issues.length > 2 ? '...' : ''}`
                    });
                }
            } else {
                // Skip validation, just continue iterating
                figma.ui.postMessage({
                    type: 'processing',
                    message: `⏭️ Skipping validation (iteration ${iteration})`
                });
            }
        }

        // Max iterations reached
        if (iteration >= MAX_ITERATIONS) {
            figma.ui.postMessage({
                type: 'success',
                message: `⚠️ Layout adjusted (reached ${MAX_ITERATIONS} iterations limit)`
            });
        }

        // Update constraints
        const finalState = captureCanvasState();
        previousConstraints = detectConstraints(finalState.objects);

    } catch (error: any) {
        console.error('Arrangement error:', error);
        figma.ui.postMessage({
            type: 'error',
            message: `Error: ${error && error.message ? error.message : 'Unknown error'}`
        });
    }
}

async function startTrackingEnhanced() {
    if (isTracking) return;

    // Capture initial state and constraints
    previousCanvasState = captureCanvasState();
    previousConstraints = detectConstraints(previousCanvasState.objects);
    let lastKnownState = previousCanvasState;
    let hasMovedSinceLastCheck = false;

    isTracking = true;
    figma.ui.postMessage({
        type: 'tracking-started',
        message: `Tracking started (${previousConstraints.length} constraints detected)`
    });

    // Poll for changes every 300ms
    trackingInterval = setInterval(async () => {
        if (!isTracking) {
            if (trackingInterval) {
                clearInterval(trackingInterval);
                trackingInterval = null;
            }
            return;
        }

        const currentState = captureCanvasState();

        // Detect if anything moved
        const movement = lastKnownState ? detectMovement(lastKnownState, currentState) : null;

        if (movement) {
            // Something is moving
            hasMovedSinceLastCheck = true;
            lastKnownState = currentState;
        } else if (hasMovedSinceLastCheck && !isSyncing) {
            // Movement stopped, trigger constraint-based pipeline
            hasMovedSinceLastCheck = false;
            isSyncing = true;

            // Find the movement that occurred
            const finalMovement = previousCanvasState ?
                detectMovement(previousCanvasState, currentState) : null;

            if (finalMovement) {
                figma.ui.postMessage({
                    type: 'processing',
                    message: `Analyzing movement of "${finalMovement.objectName}"...`,
                });

                // Use constraint-based pipeline
                await arrangeWithConstraints(finalMovement, currentState);

                // Update state
                previousCanvasState = captureCanvasState();
                isSyncing = false;
            }
        }
    }, 300);
}


figma.ui.onmessage = async (msg) => {
    if (msg.type === 'start-tracking') {
        await startTrackingEnhanced();
    } else if (msg.type === 'stop-tracking') {
        stopTracking();
    }
};
