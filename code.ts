// ============================================================================
// PICASSO - AI-Powered Layout Assistant for Figma
// Execution Agent Only
// ============================================================================

// import { detectConstraints, computeConstraintDiff, Constraint, isConstraintSatisfied } from './constraints';
// import { quickSolve } from './solver';
import { executeNaturalLanguage } from './execution';

figma.showUI(__html__, { width: 350, height: 500 });

// Get API key from plugin storage or user input
let OPENAI_API_KEY = '';

// Load API key from storage on startup and send to UI
(async () => {
    try {
        const storedKey = await figma.clientStorage.getAsync('openai_api_key');
        if (storedKey) {
            OPENAI_API_KEY = storedKey;
            // Send to UI
            figma.ui.postMessage({
                type: 'api-key-loaded',
                apiKey: storedKey,
            });
        }
    } catch (error) {
        console.log('No stored API key found');
    }
})();

// ============================================================================
// COMMENTED OUT - All tracking, intent, and arrangement code
// ============================================================================

/*
// let isTracking = false;
// let isSyncing = false;
// let trackingInterval: number | null = null;
// let previousCanvasState: CanvasState | null = null;
// let previousConstraints: Constraint[] = [];

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

// ... all other functions commented out ...
*/

// ============================================================================
// MESSAGE HANDLER - Only Execute
// ============================================================================

figma.ui.onmessage = async (msg) => {
    // Handle API key requests
    if (msg.type === 'get-api-key') {
        try {
            const storedKey = await figma.clientStorage.getAsync('openai_api_key');
            OPENAI_API_KEY = storedKey || '';
            figma.ui.postMessage({
                type: 'api-key-loaded',
                apiKey: storedKey || '',
            });
        } catch (error) {
            OPENAI_API_KEY = '';
            figma.ui.postMessage({
                type: 'api-key-loaded',
                apiKey: '',
            });
        }
        return;
    }

    // Handle API key saves
    if (msg.type === 'save-api-key') {
        if (msg.apiKey) {
            OPENAI_API_KEY = msg.apiKey;
            await figma.clientStorage.setAsync('openai_api_key', msg.apiKey);
            console.log('API key saved to storage');
        } else {
            await figma.clientStorage.setAsync('openai_api_key', '');
            OPENAI_API_KEY = '';
        }
        return;
    }

    // Handle action description load
    if (msg.type === 'get-action-description') {
        try {
            const storedDescription = await figma.clientStorage.getAsync('action_description');
            figma.ui.postMessage({
                type: 'action-description-loaded',
                description: storedDescription || '',
            });
        } catch (error) {
            figma.ui.postMessage({
                type: 'action-description-loaded',
                description: '',
            });
        }
        return;
    }

    // Handle action description save
    if (msg.type === 'save-action-description') {
        if (msg.description !== undefined) {
            await figma.clientStorage.setAsync('action_description', msg.description);
            console.log('Action description saved to storage');
        }
        return;
    }

    // COMMENTED OUT: start-tracking and stop-tracking handlers
    /*
    if (msg.type === 'start-tracking') {
        // Store API key if provided
        if (msg.apiKey) {
            OPENAI_API_KEY = msg.apiKey;
            await figma.clientStorage.setAsync('openai_api_key', msg.apiKey);
        } else {
            // Try to load from storage
            const storedKey = await figma.clientStorage.getAsync('openai_api_key');
            if (storedKey) {
                OPENAI_API_KEY = storedKey;
            }
        }
        await startTrackingEnhanced();
    } else if (msg.type === 'stop-tracking') {
        stopTracking();
    } else 
    */

    if (msg.type === 'execute') {
        // Store API key if provided
        if (msg.apiKey) {
            OPENAI_API_KEY = msg.apiKey;
            await figma.clientStorage.setAsync('openai_api_key', msg.apiKey);
        } else {
            // Try to load from storage
            const storedKey = await figma.clientStorage.getAsync('openai_api_key');
            if (storedKey) {
                OPENAI_API_KEY = storedKey;
            }
        }

        if (!OPENAI_API_KEY) {
            figma.ui.postMessage({
                type: 'error',
                message: 'OpenAI API key is required. Please enter it in the plugin UI.',
            });
            return;
        }

        try {
            figma.ui.postMessage({
                type: 'execution-started',
            });

            figma.ui.postMessage({
                type: 'execution-progress',
                message: 'Parsing natural language description...',
            });

            const result = await executeNaturalLanguage(msg.description, OPENAI_API_KEY);

            figma.ui.postMessage({
                type: 'execution-complete',
                success: result.success,
                created: result.created,
                modified: result.modified,
                errors: result.errors,
                summary: result.summary,
                apiCalls: result.apiCalls,
            });

            if (result.success) {
                figma.notify(`✅ Execution complete! Created: ${result.created}, Modified: ${result.modified}`);
            } else {
                figma.notify(`⚠️ Execution completed with ${result.errors.length} error(s)`);
            }
        } catch (error) {
            figma.ui.postMessage({
                type: 'error',
                message: error instanceof Error ? error.message : 'Failed to execute actions',
            });
            figma.notify(`❌ Execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
};
