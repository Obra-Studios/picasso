// ============================================================================
// PICASSO - AI-Powered Layout Assistant for Figma
// Component-Based Architecture
// ============================================================================

import { serializeFrame } from './frame-serialization';
import { generateContextDescription } from './context-agent';
import { analyzeIntent, UserAction } from './intent-agent';
import { generateActions } from './action-agent';
import { convertConstraintsToNaturalLanguage, parseNaturalLanguageOperations } from './operations';
import { executePlan } from './execute';
import { Action as ExecutionAction, ExecutionOperation } from './execution';
import { extractComponentLibrary } from './component-library-agent';
import { analyzeComponentIntent } from './component-intent-agent';
import { generateComponentPlan } from './component-plan-agent';
import { executeComponentPlan } from './component-execution';
import { ComponentLibrary } from './component-types';
import { config } from './config';

figma.showUI(__html__, { width: 400, height: 500 });

// Get API key from config file (gitignored)
const OPENAI_API_KEY = config.OPENAI_API_KEY;

let previousCanvasState: CanvasState | null = null;

// Hash-based change detection
let previousCanvasHash: string | null = null;
let canvasChangeTimeout: ReturnType<typeof setTimeout> | null = null;
const recentlyProcessed = new Set<string>();
let isProcessing = false;
let isApplyingChanges = false; // Lock to prevent detecting our own changes as user actions
let quickMode = true; // Quick mode: only run quickstyle agent (faster). When disabled, runs full inference suite.

// Context frame hash tracking
let previousContextHash: string | null = null;
let contextChangeTimeout: ReturnType<typeof setTimeout> | null = null;
let storedContextDescription: string | null = null;
let storedComponentLibrary: ComponentLibrary | null = null;

// Frame selection state
let contextFrameId: string | null = null;
let canvasFrameId: string | null = null;

// Additional context text
let additionalContext: string | null = null;
let additionalContextTimeout: ReturnType<typeof setTimeout> | null = null;

// Load saved frame selections from clientStorage
(async () => {
    // Load all pages for dynamic-page access
    await figma.loadAllPagesAsync();
    
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
                // Load stored component library if available
                const savedComponentLibrary = await figma.clientStorage.getAsync('component_library');
                if (savedComponentLibrary) {
                    try {
                        storedComponentLibrary = JSON.parse(savedComponentLibrary as string);
                        console.log(`✅ Loaded component library with ${storedComponentLibrary?.components.length || 0} components`);
                    } catch (e) {
                        console.log('Could not parse stored component library:', e);
                    }
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
        // const canvasImage = await exportFrameAsImage(canvasFrame);
        // const contextImage = await exportFrameAsImage(contextFrame);
        
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
            // canvasImage || undefined,
            // contextImage || undefined
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
        
        // If confidence is high or medium, generate actions
        if (intentAnalysis.confidence === 'high' || intentAnalysis.confidence === 'medium') {
            console.log('🎬 Generating actions from intent...');
            figma.ui.postMessage({
                type: 'processing',
                message: '🎬 Generating actions...',
            });
            
            // Get stored context description
            if (!storedContextDescription) {
                console.log('No context description available, skipping action generation');
                return;
            }
            
            try {
                const actions = await generateActions(
                    storedContextDescription,
                    contextJSON,
                    canvasJSON,
                    {
                        intent: intentAnalysis.intent,
                        suggestedNextSteps: intentAnalysis.suggestedNextSteps
                    },
                    OPENAI_API_KEY
                );
                
                console.log('=== GENERATED ACTIONS ===');
                console.log(`Generated ${actions.actions.length} action(s)`);
                actions.actions.forEach((action, i) => {
                    console.log(`${i + 1}. ${action.description}`);
                    console.log(`   Type: ${action.type}, Constraints: ${action.constraints.length}`);
                });
                console.log('========================');
                
                figma.ui.postMessage({
                    type: 'actions-generated',
                    actions: actions.actions,
                    count: actions.actions.length,
                });
                
                figma.notify(`✅ Generated ${actions.actions.length} action(s)`);
                
                // Convert action types from action-agent format to execution format
                // (map 'move' to 'modify')
                const constraintPlan = {
                    actions: actions.actions.map(action => ({
                        ...action,
                        type: (action.type === 'move' ? 'modify' : action.type) as 'create' | 'modify'
                    })) as ExecutionAction[],
                    metadata: actions.metadata
                };
                
                // Convert constraints to natural language operations
                console.log('🔄 Converting constraints to operations...');
                figma.ui.postMessage({
                    type: 'processing',
                    message: '🔄 Converting to operations...',
                });
                
                // Pass canvas frame info so operations are created inside it
                const canvasFrameInfo = {
                    id: canvasFrame.id,
                    name: canvasFrame.name,
                };
                console.log(`Canvas Frame: "${canvasFrameInfo.name}" (${canvasFrameInfo.id})`);
                
                const nlResult = await convertConstraintsToNaturalLanguage(
                    constraintPlan, 
                    OPENAI_API_KEY,
                    canvasFrameInfo,
                    {
                        contextDescription: storedContextDescription,
                        contextJSON: contextJSON
                    }
                );
                console.log('=== NATURAL LANGUAGE OPERATIONS ===');
                console.log(nlResult.naturalLanguageOperations);
                console.log('===================================');
                
                // Parse natural language into execution plan
                console.log('📋 Parsing execution plan...');
                figma.ui.postMessage({
                    type: 'processing',
                    message: '📋 Parsing execution plan...',
                });
                
                const parseResult = await parseNaturalLanguageOperations(
                    nlResult.naturalLanguageOperations,
                    OPENAI_API_KEY,
                    canvasFrameInfo,
                    {
                        contextDescription: storedContextDescription,
                        contextJSON: contextJSON
                    }
                );
                
                console.log('=== EXECUTION PLAN ===');
                console.log(`Operations: ${parseResult.plan.operations.length}`);
                console.log(`Canvas Frame: "${canvasFrameInfo.name}"`);
                
                // Force all 'add' operations to use canvas frame as container
                parseResult.plan.operations.forEach((op: ExecutionOperation, i: number) => {
                    console.log(`${i + 1}. ${op.action} ${op.type || ''} ${op.name || ''}`);
                    
                    // Always set container to canvas frame for add operations
                    if (op.action === 'add') {
                        op.container = canvasFrameInfo.name;
                        console.log(`    Container: ${op.container} (canvas frame)`);
                    } else {
                        console.log(`    Container: ${op.container || '(none)'}`);
                    }
                    
                    // Fix opacity if it's 0 (invisible) - default to 1.0
                    if (op.opacity === 0) {
                        console.warn(`    ⚠️ Opacity was 0 (invisible), correcting to 1.0`);
                        op.opacity = 1.0;
                    }
                    
                    // Fix opacity in fills array
                    if (op.fills && Array.isArray(op.fills)) {
                        op.fills.forEach((fill, fillIndex) => {
                            if (fill.opacity === 0) {
                                console.warn(`    ⚠️ Fill[${fillIndex}] opacity was 0, correcting to 1.0`);
                                fill.opacity = 1.0;
                            }
                        });
                    }
                    
                    // Fix opacity in strokes array
                    if (op.strokes && Array.isArray(op.strokes)) {
                        op.strokes.forEach((stroke, strokeIndex) => {
                            if (stroke.opacity === 0) {
                                console.warn(`    ⚠️ Stroke[${strokeIndex}] opacity was 0, correcting to 1.0`);
                                stroke.opacity = 1.0;
                            }
                        });
                    }
                    
                    console.log(`    Position: x=${op.x}, y=${op.y}`);
                });
                console.log('======================');
                
                // Execute the plan
                console.log('⚡ Executing plan...');
                figma.ui.postMessage({
                    type: 'processing',
                    message: '⚡ Executing operations...',
                });
                
                // Set lock to prevent detecting our own changes
                isApplyingChanges = true;
                console.log('🔒 Lock engaged: preventing detection of applied changes');
                
                try {
                    const executionResult = await executePlan(parseResult.plan);
                    
                    console.log('=== EXECUTION COMPLETE ===');
                    console.log(`Created: ${executionResult.created}`);
                    console.log(`Modified: ${executionResult.modified}`);
                    console.log(`Errors: ${executionResult.errors.length}`);
                    if (executionResult.errors.length > 0) {
                        console.log('Errors:', executionResult.errors);
                    }
                    console.log('==========================');
                    
                    figma.ui.postMessage({
                        type: 'execution-complete',
                        created: executionResult.created,
                        modified: executionResult.modified,
                        errors: executionResult.errors,
                        success: executionResult.success,
                    });
                    
                    if (executionResult.success) {
                        figma.notify(`✨ Executed! Created ${executionResult.created}, Modified ${executionResult.modified}`);
                    } else {
                        figma.notify(`⚠️ Execution completed with ${executionResult.errors.length} error(s)`);
                    }
                } finally {
                    // Release lock after a delay to ensure all change events have propagated
                    setTimeout(async () => {
                        // Update canvas state to reflect the changes we just made
                        if (canvasFrameId) {
                            const canvasFrame = await figma.getNodeByIdAsync(canvasFrameId) as FrameNode | null;
                            if (canvasFrame) {
                                previousCanvasState = captureCanvasState(canvasFrame);
                                previousCanvasHash = await getFrameHash(canvasFrame);
                                console.log('📸 Updated canvas state after applying changes');
                            }
                        }
                        
                        isApplyingChanges = false;
                        console.log('🔓 Lock released: now detecting user changes again');
                    }, 500);
                }
                
            } catch (actionError) {
                console.log('Error in action pipeline:', actionError);
                figma.notify('⚠️ Could not complete action pipeline');
                
                // Release lock immediately on error
                isApplyingChanges = false;
                console.log('🔓 Lock released due to error');
            }
        } else {
            console.log('⏭️ Skipping action generation due to low confidence');
        }
        
    } catch (e) {
        console.log('Error analyzing intent:', e);
        figma.notify('⚠️ Could not analyze intent');
    }
}

// NEW: Component-based workflow
async function performComponentAnalysis(
    action: UserAction
): Promise<void> {
    try {
        if (!OPENAI_API_KEY) {
            console.log('No API key available, skipping component analysis');
            return;
        }
        
        // Get canvas frame
        const canvasFrame = canvasFrameId ? 
            await figma.getNodeByIdAsync(canvasFrameId) as FrameNode | null : null;
        
        if (!canvasFrame) {
            console.log('No canvas frame selected, skipping component analysis');
            return;
        }
        
        // Check if component library is available
        if (!storedComponentLibrary) {
            console.log('No component library available, skipping component analysis');
            figma.notify('⚠️ Please select a context frame first');
            return;
        }
        
        // Serialize canvas
        let canvasJSON = serializeFrame(canvasFrame);
        
        // Show analyzing message
        figma.ui.postMessage({
            type: 'processing',
            message: '🤔 Analyzing component intent...',
        });
        
        // Analyze component intent
        console.log('🤔 Analyzing component intent...');
        const componentIntentResponse = await analyzeComponentIntent(
            action,
            storedComponentLibrary,
            canvasJSON,
            OPENAI_API_KEY,
            additionalContext || undefined
        );
        
        figma.notify(`💡 ${componentIntentResponse.overallIntent} (${componentIntentResponse.actions.length} actions)`);
        
        // Track the last created component to use as reference for the next one
        let lastCreatedComponentId: string | null = null;
        
        // Process each action
        for (let i = 0; i < componentIntentResponse.actions.length; i++) {
            const componentIntent = componentIntentResponse.actions[i];
            
            // If this is not the first action and we have a previously created component,
            // update the placement to be relative to the last created component
            if (i > 0 && lastCreatedComponentId) {
                console.log(`📍 Adjusting placement: using last created component (${lastCreatedComponentId}) as reference`);
                componentIntent.placement.relativeTo = lastCreatedComponentId;
            }
            
            console.log(`\n📐 Generating plan for action ${i + 1}/${componentIntentResponse.actions.length}...`);
            figma.ui.postMessage({
                type: 'processing',
                message: `📐 Planning: ${componentIntent.description}`,
            });
            
            // Update canvas JSON to include previously created components
            if (canvasFrameId && i > 0) {
                const canvasFrame = await figma.getNodeByIdAsync(canvasFrameId) as FrameNode | null;
                if (canvasFrame) {
                    canvasJSON = serializeFrame(canvasFrame);
                }
            }
            
            const componentPlan = await generateComponentPlan(
                componentIntent,
                storedComponentLibrary,
                canvasJSON,
                canvasFrame.id
            );
            
            // Execute the plan
            console.log(`⚡ Executing plan ${i + 1}...`);
            figma.ui.postMessage({
                type: 'processing',
                message: `⚡ Creating: ${componentIntent.description}`,
            });
            
            // Set lock to prevent detecting our own changes
            isApplyingChanges = true;
            console.log('🔒 Lock engaged: preventing detection of applied changes');
            
            try {
                const executionResult = await executeComponentPlan(componentPlan);
                
                // Track the actual Figma node ID of the created component for the next iteration
                if (executionResult.created > 0 && executionResult.createdNodeIds.length > 0) {
                    lastCreatedComponentId = executionResult.createdNodeIds[0];
                    console.log(`✅ Tracked created component with Figma ID: ${lastCreatedComponentId}`);
                }
                
                console.log(`=== ACTION ${i + 1} COMPLETE ===`);
                console.log(`Created: ${executionResult.created}`);
                console.log(`Modified: ${executionResult.modified}`);
                console.log(`Errors: ${executionResult.errors.length}`);
                if (executionResult.errors.length > 0) {
                    console.log('Errors:', executionResult.errors);
                }
                console.log('==========================');
                
                figma.ui.postMessage({
                    type: 'execution-complete',
                    created: executionResult.created,
                    modified: executionResult.modified,
                    errors: executionResult.errors,
                    success: executionResult.success,
                });
                
                if (executionResult.success) {
                    figma.notify(`✨ Component ${i + 1}/${componentIntentResponse.actions.length} added!`);
                } else {
                    figma.notify(`⚠️ Action ${i + 1} completed with ${executionResult.errors.length} error(s)`);
                }
                
                // Add a small delay between actions to allow UI messages to render
                // This prevents the UI from lagging behind the actual execution
                if (i < componentIntentResponse.actions.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            } finally {
                // Release lock after a delay
                setTimeout(async () => {
                    // Update canvas state
                    if (canvasFrameId) {
                        const canvasFrame = await figma.getNodeByIdAsync(canvasFrameId) as FrameNode | null;
                        if (canvasFrame) {
                            previousCanvasState = captureCanvasState(canvasFrame);
                            previousCanvasHash = await getFrameHash(canvasFrame);
                            console.log('📸 Updated canvas state after applying changes');
                        }
                    }
                    
                    isApplyingChanges = false;
                    console.log('🔓 Lock released: now detecting user changes again');
                }, 500);
            }
        }
        
        // Show final summary
        figma.notify(`✨ All done! Added ${componentIntentResponse.actions.length} component(s)`);
        
    } catch (e) {
        console.log('Error in component analysis:', e);
        figma.notify('⚠️ Could not complete component analysis');
        
        // Release lock immediately on error
        isApplyingChanges = false;
        console.log('🔓 Lock released due to error');
    }
}

// Generate and store context description and component library
async function generateAndStoreContextDescription(frame: FrameNode, apiKey: string): Promise<void> {
    try {
        if (!apiKey) {
            console.log('No API key available, skipping context analysis');
            return;
        }
        
        console.log('Analyzing context frame:', frame.name);
        
        // Serialize the frame to JSON
        const frameJSON = serializeFrame(frame);
        
        // Count all elements recursively
        function countElements(node: any): number {
            let count = 1; // Count this node
            if (node.children && Array.isArray(node.children)) {
                for (const child of node.children) {
                    count += countElements(child);
                }
            }
            return count;
        }
        
        // Flatten all elements for easier viewing
        function flattenElements(node: any, depth: number = 0, list: any[] = []): any[] {
            const indent = '  '.repeat(depth);
            list.push({
                indent,
                name: node.name,
                type: node.type,
                id: node.id || '(no id)',
                x: node.x,
                y: node.y,
                width: node.width,
                height: node.height,
            });
            
            if (node.children && Array.isArray(node.children)) {
                for (const child of node.children) {
                    flattenElements(child, depth + 1, list);
                }
            }
            
            return list;
        }
        
        const totalElements = countElements(frameJSON);
        const elementsList = flattenElements(frameJSON);
        
        // Print complete frame JSON structure
        console.log('=== CONTEXT FRAME JSON (Complete DOM Structure) ===');
        console.log(`Total elements in frame: ${totalElements}`);
        console.log('\nElement hierarchy:');
        elementsList.forEach(el => {
            console.log(`${el.indent}${el.type}: "${el.name}" (${el.width}x${el.height} at ${el.x},${el.y})`);
        });
        console.log('\nFull JSON:');
        console.log(JSON.stringify(frameJSON, null, 2));
        console.log('====================================================');
        
        // Export frame as image
        const frameImageBase64 = await exportFrameAsImage(frame);
        
        // Extract component library (NEW!)
        console.log('🔍 Extracting component library...');
        const componentLibrary = await extractComponentLibrary(frameJSON, apiKey, additionalContext || undefined);
        storedComponentLibrary = componentLibrary;
        await figma.clientStorage.setAsync('component_library', JSON.stringify(componentLibrary));
        console.log('✅ Component library extracted and stored');
        
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
        console.log('Error analyzing context:', e);
        figma.notify('Could not analyze context frame');
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
    } else if (msg.type === 'start-tracking') {
        // Enable quick mode (only quickstyle agent)
        quickMode = true;
        console.log('🚀 Quick mode enabled: will only run quickstyle agent');
        figma.ui.postMessage({
            type: 'tracking-started',
        });
    } else if (msg.type === 'stop-tracking') {
        // Disable quick mode (run full inference suite)
        quickMode = false;
        console.log('🧠 Quick mode disabled: will run full inference suite');
        figma.ui.postMessage({
            type: 'tracking-stopped',
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
    if (!canvasFrameId || isProcessing || isApplyingChanges) {
        return;
    }
    
    // Debounce changes
    if (canvasChangeTimeout) {
        clearTimeout(canvasChangeTimeout);
    }
    
    canvasChangeTimeout = setTimeout(async () => {
        try {
            if (!canvasFrameId || isProcessing || isApplyingChanges) {
                console.log('⏸️ Skipping change detection: lock is engaged or already processing');
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
                // First time, just store the hash and capture initial state
                console.log('📸 First time: capturing initial canvas state');
                previousCanvasHash = currentHash;
                previousCanvasState = captureCanvasState(canvasFrame);
                console.log(`📸 Initial state captured: ${previousCanvasState.objects.length} objects`);
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
                
                // Run quickstyle asynchronously (don't await - runs in parallel)
                const contextFrame = contextFrameId ? 
                    await figma.getNodeByIdAsync(contextFrameId) as FrameNode | null : null;
                const canvasFrame = canvasFrameId ?
                    await figma.getNodeByIdAsync(canvasFrameId) as FrameNode | null : null;
                
                if (contextFrame && canvasFrame && OPENAI_API_KEY) {
                    console.log('⚡ Starting quickstyle agent (async)...');
                    const contextJSON = serializeFrame(contextFrame);
                    const canvasJSON = serializeFrame(canvasFrame);
                    
                    // Run async without blocking
                    suggestQuickStyle(
                        {
                            id: addition.objectId,
                            name: addition.objectName,
                            type: addition.objectType,
                            x: addition.position.x,
                            y: addition.position.y,
                            width: addition.size.width,
                            height: addition.size.height,
                        },
                        contextJSON,
                        canvasJSON,
                        OPENAI_API_KEY
                    ).then(async (suggestion) => {
                        console.log('=== QUICKSTYLE SUGGESTION ===');
                        console.log(`Matched: ${suggestion.reasoning}`);
                        console.log(`Confidence: ${suggestion.confidence}`);
                        console.log('Applying styles...');
                        
                        // Engage lock to prevent re-triggering
                        isApplyingChanges = true;
                        console.log('🔒 Quickstyle lock engaged');
                        
                        try {
                            const result = await applyQuickStyle(addition.objectId, suggestion);
                            
                            if (result.success) {
                                console.log(`✅ Quickstyle applied: ${result.applied.join(', ')}`);
                                figma.notify(`⚡ Quick-styled: ${result.applied.join(', ')}`);
                            } else {
                                console.log('❌ Quickstyle failed to apply');
                            }
                        } finally {
                            // Release lock after a short delay
                            setTimeout(() => {
                                isApplyingChanges = false;
                                console.log('🔓 Quickstyle lock released');
                            }, 300);
                        }
                        console.log('=============================');
                    }).catch((error) => {
                        console.log('⚠️ Quickstyle error:', error);
                    });
                }
                
                // Conditionally run full inference suite based on quick mode
                if (!quickMode) {
                    console.log('🧠 Quick mode OFF: Starting component analysis for addition...');
                    await performComponentAnalysis(userAction);
                    console.log(':white_check_mark: Component analysis complete for addition');
                } else {
                    console.log('🚀 Quick mode ON: Skipping full inference suite (quickstyle only)');
                }
                
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
                
                // Conditionally run full inference suite based on quick mode
                if (!quickMode) {
                    console.log('🧠 Quick mode OFF: Starting full inference suite for movement...');
                    await performComponentAnalysis(userAction);
                    console.log(':white_check_mark: Intent analysis complete for movement');
                } else {
                    console.log('🚀 Quick mode ON: Skipping full inference suite (no action for movements in quick mode)');
                }
                
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
