// ============================================================================
// PICASSO - AI-Powered Layout Assistant for Figma
// Architecture: Constraint-Based Multi-Stage Pipeline
// ============================================================================

import { detectConstraints, isConstraintSatisfied } from './constraints';
import { serializeFrame } from './frame-serialization';
import { generateContextDescription } from './context-agent';
import { analyzeIntent, UserAction } from './intent-agent';
import { config } from './config';

figma.showUI(__html__, { width: 400, height: 500 });

// Get API key from config file (gitignored)
const OPENAI_API_KEY = config.OPENAI_API_KEY;

let isSyncing = false;
let previousCanvasState: CanvasState | null = null;

// Hash-based change detection
let previousCanvasHash: string | null = null;
let canvasChangeTimeout: ReturnType<typeof setTimeout> | null = null;
const recentlyProcessed = new Set<string>();
let isProcessing = false;

// Context frame hash tracking
let previousContextHash: string | null = null;
let contextChangeTimeout: ReturnType<typeof setTimeout> | null = null;
let storedContextDescription: string | null = null;

// Frame selection state
let contextFrameId: string | null = null;
let canvasFrameId: string | null = null;

// Additional context text
let additionalContext: string | null = null;
let additionalContextTimeout: ReturnType<typeof setTimeout> | null = null;

// Load saved frame selections from clientStorage
(async () => {
    // Load context frame
    const savedContextFrameId = await figma.clientStorage.getAsync('context_frame_id');
    if (savedContextFrameId) {
        try {
            const frame = await figma.getNodeByIdAsync(savedContextFrameId as string);
            if (frame && frame.type === 'FRAME') {
                contextFrameId = frame.id;
                // Initialize context hash
                previousContextHash = await getFrameHash(frame as FrameNode);
                // Load stored description if available
                const savedDescription = await figma.clientStorage.getAsync('context_description');
                if (savedDescription) {
                    storedContextDescription = savedDescription as string;
                }
                figma.ui.postMessage({
                    type: 'context-selected',
                    frameId: contextFrameId,
                    frameName: frame.name,
                });
                // Generate context description if API key is available
                if (OPENAI_API_KEY) {
                    await generateAndStoreContextDescription(frame as FrameNode, OPENAI_API_KEY);
                }
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
                // Initialize canvas hash for change detection
                previousCanvasHash = await getFrameHash(frame as FrameNode);
                // Initialize canvas state for change detection
                previousCanvasState = captureCanvasState(frame as FrameNode);
                console.log(`✅ Initialized canvas state with ${previousCanvasState.objects.length} objects`);
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
    
    // Load additional context
    const savedAdditionalContext = await figma.clientStorage.getAsync('additional_context');
    if (savedAdditionalContext) {
        additionalContext = savedAdditionalContext as string;
        figma.ui.postMessage({
            type: 'additional-context-loaded',
            context: additionalContext,
        });
    }
})();

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


function captureCanvasState(frame?: FrameNode): CanvasState {
    const objects: CanvasObject[] = [];
    
    // Get children from the specified frame, or top-level nodes on the current page
    const nodesToProcess = frame ? frame.children : figma.currentPage.children;
    
    for (const node of nodesToProcess) {
        // Include all objects (frames, groups, and individual shapes)
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

// Generate a hash of frame content to detect changes
async function getFrameHash(frame: FrameNode): Promise<string> {
    const json = serializeFrame(frame);
    const jsonString = JSON.stringify(json);
    // Create a robust hash that includes:
    // - Number of children
    // - Frame dimensions
    // - A hash of the JSON content
    let hash = 0;
    for (let i = 0; i < jsonString.length; i++) {
        const char = jsonString.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return `${frame.children.length}_${Math.round(frame.width)}_${Math.round(frame.height)}_${hash}`;
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

interface AddInfo {
    objectId: string;
    objectName: string;
    objectType: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
}

function detectAddition(before: CanvasState, after: CanvasState): AddInfo | null {
    // Find new objects (objects in after but not in before)
    for (const afterObj of after.objects) {
        const beforeObj = before.objects.find(obj => obj.id === afterObj.id);
        
        if (!beforeObj) {
            // This is a new object
            return {
                objectId: afterObj.id,
                objectName: afterObj.name,
                objectType: afterObj.type,
                position: { x: afterObj.x, y: afterObj.y },
                size: { width: afterObj.width, height: afterObj.height },
            };
        }
    }
    
    return null;
}


// Export a specific frame as a base64 image
async function exportFrameAsImage(frame: FrameNode): Promise<string | null> {
    try {
        // Export the frame as PNG
        const imageBytes = await frame.exportAsync({
            format: 'PNG',
            constraint: { type: 'SCALE', value: 2 }, // 2x scale for better quality
        });
        
        // Convert to base64 using Figma's built-in function
        const base64 = figma.base64Encode(imageBytes);
        
        return base64;
    } catch (e) {
        console.log('Error exporting frame as image:', e);
        return null;
    }
}

// Perform intent analysis for user action
async function performIntentAnalysis(
    action: UserAction
): Promise<void> {
    try {
        if (!OPENAI_API_KEY) {
            console.log('No API key available, skipping intent analysis');
            return;
        }
        
        // Get canvas frame
        const canvasFrame = canvasFrameId ? 
            await figma.getNodeByIdAsync(canvasFrameId) as FrameNode | null : null;
        
        if (!canvasFrame) {
            console.log('No canvas frame selected, skipping intent analysis');
            return;
        }
        
        // Get context frame
        const contextFrame = contextFrameId ? 
            await figma.getNodeByIdAsync(contextFrameId) as FrameNode | null : null;
        
        if (!contextFrame) {
            console.log('No context frame selected, skipping intent analysis');
            return;
        }
        
        // Serialize frames
        const canvasJSON = serializeFrame(canvasFrame);
        const contextJSON = serializeFrame(contextFrame);
        
        // Get screenshots
        const canvasImage = await exportFrameAsImage(canvasFrame);
        const contextImage = await exportFrameAsImage(contextFrame);
        
        // Show analyzing message
        figma.ui.postMessage({
            type: 'processing',
            message: '🤔 Analyzing your intent...',
        });
        
        // Analyze intent
        const intentAnalysis = await analyzeIntent(
            action,
            canvasJSON,
            contextJSON,
            additionalContext,
            canvasImage || undefined,
            contextImage || undefined
        );
        
        // Log to console
        console.log('=== INTENT ANALYSIS ===');
        console.log(`Action: ${action.type}`);
        console.log(`Intent: ${intentAnalysis.intent}`);
        console.log(`Confidence: ${intentAnalysis.confidence}`);
        if (intentAnalysis.suggestedNextSteps) {
            console.log('Suggested next steps:');
            intentAnalysis.suggestedNextSteps.forEach((step, i) => {
                console.log(`  ${i + 1}. ${step}`);
            });
        }
        console.log('=======================');
        
        // Send to UI
        figma.ui.postMessage({
            type: 'intent-analysis',
            intent: intentAnalysis.intent,
            confidence: intentAnalysis.confidence,
            suggestedNextSteps: intentAnalysis.suggestedNextSteps,
            actionType: action.type,
        });
        
        // Show notification with confidence indicator
        const confidenceEmoji = intentAnalysis.confidence === 'high' ? '✨' : 
                               intentAnalysis.confidence === 'medium' ? '💡' : '🤔';
        figma.notify(`${confidenceEmoji} Intent: ${intentAnalysis.intent}`);
        
    } catch (e) {
        console.log('Error analyzing intent:', e);
        figma.notify('⚠️ Could not analyze intent');
    }
}

// Generate and store context description
async function generateAndStoreContextDescription(frame: FrameNode, apiKey: string): Promise<void> {
    try {
        if (!apiKey) {
            console.log('No API key available, skipping context description generation');
            return;
        }
        
        console.log('Generating context description for frame:', frame.name);
        
        // Serialize the frame to JSON
        const frameJSON = serializeFrame(frame);
        
        // Export frame as image
        const frameImageBase64 = await exportFrameAsImage(frame);
        
        // Generate context description using the context agent
        const description = await generateContextDescription(
            additionalContext,
            frameJSON,
            apiKey,
            frameImageBase64 || undefined
        );
        
        // Store the description
        storedContextDescription = description;
        await figma.clientStorage.setAsync('context_description', description);
        
        // Print to console
        console.log('=== CONTEXT DESCRIPTION ===');
        console.log(description);
        console.log('===========================');
        
        // Update hash
        const currentHash = await getFrameHash(frame);
        previousContextHash = currentHash;
        await figma.clientStorage.setAsync('context_frame_hash', currentHash);
        
    } catch (e) {
        console.log('Error generating context description:', e);
        figma.notify('Could not generate context description');
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
    
    // Get screenshot from stored canvas frame
    let screenshot: string | null = null;
    if (canvasFrameId) {
        const canvasFrame = await figma.getNodeByIdAsync(canvasFrameId) as FrameNode | null;
        if (canvasFrame) {
            screenshot = await exportFrameAsImage(canvasFrame);
        }
    }
    
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
        const error = await response.json() as any;
        throw new Error(error.error?.message || 'Intent extraction error');
    }

    const data = await response.json() as any;
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
    // Get screenshot from stored canvas frame
    let screenshot: string | null = null;
    if (canvasFrameId) {
        const canvasFrame = await figma.getNodeByIdAsync(canvasFrameId) as FrameNode | null;
        if (canvasFrame) {
            screenshot = await exportFrameAsImage(canvasFrame);
        }
    }
    
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
        const error = await response.json() as any;
        throw new Error(error.error?.message || 'Arrangement evaluation error');
    }

    const data = await response.json() as any;
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
    
    // Get screenshot from stored canvas frame
    let screenshot: string | null = null;
    if (canvasFrameId) {
        const canvasFrame = await figma.getNodeByIdAsync(canvasFrameId) as FrameNode | null;
        if (canvasFrame) {
            screenshot = await exportFrameAsImage(canvasFrame);
        }
    }
    
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
        const error = await response.json() as any;
        throw new Error(error.error?.message || 'LLM API error');
    }

    const data = await response.json() as any;
    const content = data.choices[0]?.message?.content || '{"interpretation":"","actions":[]}';
    
    return JSON.parse(content);
}


interface ValidationResponse {
    isAligned: boolean;
    issues: string[];
    suggestions: LayoutAction[];
}

async function validateAlignment(canvasState: CanvasState, iterationNumber: number): Promise<ValidationResponse> {
    // Get screenshot from stored canvas frame
    let screenshot: string | null = null;
    if (canvasFrameId) {
        const canvasFrame = await figma.getNodeByIdAsync(canvasFrameId) as FrameNode | null;
        if (canvasFrame) {
            screenshot = await exportFrameAsImage(canvasFrame);
        }
    }
    
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
        const error = await response.json() as any;
        throw new Error(error.error?.message || 'Validation API error');
    }

    const data = await response.json() as any;
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
                    
                    // Constraints are detected on-demand, no need to store
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
        
        // Update state
        const finalState = captureCanvasState();
        // Constraints are detected on-demand, no need to store
        
    } catch (error: any) {
        console.error('Arrangement error:', error);
        figma.ui.postMessage({
            type: 'error',
            message: `Error: ${error && error.message ? error.message : 'Unknown error'}`
        });
    }
}



figma.ui.onmessage = async (msg) => {
    if (msg.type === 'select-context') {
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
        
        // Initialize context hash
        try {
            const contextFrame = selection[0] as FrameNode;
            previousContextHash = await getFrameHash(contextFrame);
        } catch (e) {
            console.log('Error initializing context hash:', e);
        }
        
        figma.ui.postMessage({
            type: 'context-selected',
            frameId: contextFrameId,
            frameName: selection[0].name,
        });
        
        // Generate context description if API key is available
        if (OPENAI_API_KEY) {
            await generateAndStoreContextDescription(selection[0] as FrameNode, OPENAI_API_KEY);
        }
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
        
        // Initialize canvas hash and state for change detection
        try {
            const canvasFrame = selection[0] as FrameNode;
            previousCanvasHash = await getFrameHash(canvasFrame);
            previousCanvasState = captureCanvasState(canvasFrame);
            console.log(`✅ Initialized canvas state with ${previousCanvasState.objects.length} objects`);
        } catch (e) {
            console.log('Error initializing canvas hash/state:', e);
        }
        
        figma.ui.postMessage({
            type: 'canvas-selected',
            frameId: canvasFrameId,
            frameName: selection[0].name,
        });
    } else if (msg.type === 'save-additional-context') {
        additionalContext = msg.context || null;
        await figma.clientStorage.setAsync('additional_context', additionalContext || '');
        
        // Debounce regeneration of context description
        if (additionalContextTimeout) {
            clearTimeout(additionalContextTimeout);
        }
        
        additionalContextTimeout = setTimeout(async () => {
            if (!OPENAI_API_KEY || !contextFrameId) return;
            
            try {
                const contextFrame = await figma.getNodeByIdAsync(contextFrameId) as FrameNode | null;
                if (!contextFrame) return;
                
                console.log('🔄 Additional context modified, regenerating description');
                figma.notify('🔄 Additional context changed - regenerating description...');
                await generateAndStoreContextDescription(contextFrame, OPENAI_API_KEY);
                figma.notify('✅ Context description updated!');
            } catch (e) {
                console.log('Error regenerating context description:', e);
                figma.notify('⚠️ Failed to update context description');
            }
        }, 2000); // Wait 2 seconds after last change
    } else if (msg.type === 'get-additional-context') {
        figma.ui.postMessage({
            type: 'additional-context-loaded',
            context: additionalContext || '',
        });
    }
};

// Load all pages (required for documentchange handler)
figma.loadAllPagesAsync();

// Listen for document changes to detect context frame modifications
figma.on('documentchange', async () => {
    if (!contextFrameId || !OPENAI_API_KEY) {
        return;
    }
    
    // Check if context frame was modified
    try {
        const contextFrame = await figma.getNodeByIdAsync(contextFrameId) as FrameNode | null;
        if (contextFrame) {
            // Debounce to avoid too many checks
            if (contextChangeTimeout) {
                clearTimeout(contextChangeTimeout);
            }
            
            contextChangeTimeout = setTimeout(async () => {
                if (!OPENAI_API_KEY || !contextFrameId) return;
                
                try {
                    const currentFrame = await figma.getNodeByIdAsync(contextFrameId) as FrameNode | null;
                    if (!currentFrame) return;
                    
                    const currentHash = await getFrameHash(currentFrame);
                    
                    if (previousContextHash === null) {
                        // First time, just store the hash
                        previousContextHash = currentHash;
                        return;
                    }
                    
                    // If hash changed, regenerate description
                    if (previousContextHash !== currentHash) {
                        console.log('🔄 Context frame modified, regenerating description');
                        figma.notify('🔄 Context frame changed - regenerating description...');
                        await generateAndStoreContextDescription(currentFrame, OPENAI_API_KEY);
                        figma.notify('✅ Context description updated!');
                    }
                } catch (e) {
                    console.log('Error checking context frame:', e);
                }
            }, 2000); // Wait 2 seconds after last change
        }
    } catch (e) {
        // Context frame might have been deleted
        console.log('Error checking context frame:', e);
    }
});

// Listen for document changes to detect canvas frame modifications (event-driven hash-based)
figma.on('documentchange', async () => {
    if (!canvasFrameId || isProcessing || isSyncing) {
        return;
    }
    
    // Debounce changes
    if (canvasChangeTimeout) {
        clearTimeout(canvasChangeTimeout);
    }
    
    canvasChangeTimeout = setTimeout(async () => {
        try {
            if (!canvasFrameId || isProcessing || isSyncing) {
                return;
            }
            
            const canvasFrame = await figma.getNodeByIdAsync(canvasFrameId) as FrameNode | null;
            
            if (!canvasFrame) {
                return;
            }
            
            // Check if selection is within canvas frame (early exit if not)
            const selection = figma.currentPage.selection;
            if (selection.length === 0) {
                return;
            }
            
            // Check if selection is within canvas frame
            let selectedElement: SceneNode | null = null;
            for (const node of selection) {
                // Check if node is within canvas frame
                let current: BaseNode | null = node;
                while (current) {
                    if (current.id === canvasFrame.id) {
                        selectedElement = node;
                        break;
                    }
                    current = current.parent;
                }
                if (selectedElement) break;
            }
            
            // If selection is not in canvas frame, skip entirely
            if (!selectedElement) {
                return;
            }
            
            // Skip if we recently processed this element
            if (recentlyProcessed.has(selectedElement.id)) {
                return;
            }
            
            // Check if canvas frame content actually changed
            const currentHash = await getFrameHash(canvasFrame);
            if (previousCanvasHash === null) {
                // First time, just store the hash
                previousCanvasHash = currentHash;
                return;
            }
            
            if (previousCanvasHash === currentHash) {
                // No changes detected, skip
                console.log('Canvas frame hash unchanged, skipping');
                return;
            }
            
            console.log('Canvas frame hash changed, processing change');
            
            // Update hash for next check
            previousCanvasHash = currentHash;
            
            // Mark as processed
            recentlyProcessed.add(selectedElement.id);
            // Clear after 5 seconds to allow re-processing if needed
            setTimeout(() => recentlyProcessed.delete(selectedElement.id), 5000);
            
            isProcessing = true;
            console.log(`Processing change for ${selectedElement.type} element`);
            
            // Capture current state and detect movement or addition
            console.log('📸 Capturing canvas state...');
            const currentState = captureCanvasState(canvasFrame);
            console.log(`📸 Captured ${currentState.objects.length} objects`);
            
            // Check for additions FIRST (more specific than movements)
            console.log('🔍 Checking for additions and movements...');
            const addition = previousCanvasState ? 
                detectAddition(previousCanvasState, currentState) : null;
            const movement = previousCanvasState && !addition ? 
                detectMovement(previousCanvasState, currentState) : null;
            console.log(`🔍 Addition: ${addition ? 'YES' : 'NO'}, Movement: ${movement ? 'YES' : 'NO'}`);
            
            if (addition) {
                // User added a new element
                console.log(`🆕 Detected addition: ${addition.objectName} (${addition.objectType})`);
                
                const userAction: UserAction = {
                    type: 'add',
                    elementId: addition.objectId,
                    elementName: addition.objectName,
                    elementType: addition.objectType,
                    position: addition.position,
                    size: addition.size,
                };
                
                // Analyze intent
                console.log('🤔 Starting intent analysis for addition...');
                await performIntentAnalysis(userAction);
                console.log('✅ Intent analysis complete for addition');
                
                // Update state for next time
                previousCanvasState = currentState;
            } else if (movement) {
                // User moved an element
                console.log(`📦 Detected movement: ${movement.objectName} from (${movement.from.x}, ${movement.from.y}) to (${movement.to.x}, ${movement.to.y})`);
                
                const userAction: UserAction = {
                    type: 'move',
                    elementId: movement.objectId,
                    elementName: movement.objectName,
                    elementType: currentState.objects.find(obj => obj.id === movement.objectId)?.type || 'UNKNOWN',
                    from: movement.from,
                    to: movement.to,
                    delta: movement.delta,
                };
                
                // Analyze intent
                console.log('🤔 Starting intent analysis for movement...');
                await performIntentAnalysis(userAction);
                console.log('✅ Intent analysis complete for movement');
                
                // Update state after changes
                previousCanvasState = captureCanvasState(canvasFrame);
            } else {
                // No movement or addition detected, but hash changed
                console.log('⚠️ Hash changed but no movement or addition detected');
                // Initialize state for next time
                previousCanvasState = currentState;
            }
            
            isProcessing = false;
            console.log('✅ Processing complete, isProcessing set to false');
        } catch (e) {
            console.log('❌ Error processing document change:', e);
            isProcessing = false;
        }
    }, 500); // Wait 0.5 second after last change
});
