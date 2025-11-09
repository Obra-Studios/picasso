// ============================================================================
// Intent Agent - Analyzes user actions to extract design intent
// ============================================================================

import { config } from './config';

export interface UserAction {
    type: 'add' | 'move';
    elementId: string;
    elementName: string;
    elementType: string;
    // For move actions
    from?: { x: number; y: number };
    to?: { x: number; y: number };
    delta?: { dx: number; dy: number };
    // For add actions
    position?: { x: number; y: number };
    size?: { width: number; height: number };
}

export interface IntentAnalysis {
    intent: string; // 1-3 sentence description of user's intent
    confidence: 'high' | 'medium' | 'low';
    suggestedNextSteps?: string[];
}

/**
 * Analyzes a user action to extract their design intent
 * @param userAction The action the user performed (add or move)
 * @param canvasStateJSON The current canvas state as JSON
 * @param contextFrameJSON The context frame's JSON tree
 * @param additionalContext Additional context text from the user
 * @param canvasImageBase64 Optional screenshot of the canvas
 * @param contextImageBase64 Optional screenshot of the context frame
 * @returns Intent analysis with description and confidence
 */
export async function analyzeIntent(
    userAction: UserAction,
    canvasStateJSON: any,
    contextFrameJSON: any,
    additionalContext: string | null,
    canvasImageBase64?: string,
    contextImageBase64?: string
): Promise<IntentAnalysis> {
    const apiKey = config.OPENAI_API_KEY;
    
    if (!apiKey) {
        throw new Error('OpenAI API key not configured');
    }
    
    if (userAction.type === 'add') {
        return analyzeAddIntent(
            userAction,
            canvasStateJSON,
            contextFrameJSON,
            additionalContext,
            apiKey,
            canvasImageBase64,
            contextImageBase64
        );
    } else {
        return analyzeMoveIntent(
            userAction,
            canvasStateJSON,
            contextFrameJSON,
            additionalContext,
            apiKey,
            canvasImageBase64,
            contextImageBase64
        );
    }
}

/**
 * Analyzes intent when user adds a new element
 * Assumes user is building something similar to the context frame
 */
async function analyzeAddIntent(
    userAction: UserAction,
    canvasStateJSON: any,
    contextFrameJSON: any,
    additionalContext: string | null,
    apiKey: string,
    canvasImageBase64?: string,
    contextImageBase64?: string
): Promise<IntentAnalysis> {
    const prompt = `You are an expert UI/UX design intent analyzer. A user just added a new element to their canvas.

CONTEXT FRAME (reference design):
${JSON.stringify(contextFrameJSON, null, 2)}

${additionalContext ? `ADDITIONAL CONTEXT FROM USER:\n${additionalContext}\n` : ''}

CURRENT CANVAS STATE:
${JSON.stringify(canvasStateJSON, null, 2)}

USER ACTION - ADDED NEW ELEMENT:
- Element: "${userAction.elementName}" (type: ${userAction.elementType})
- ID: ${userAction.elementId}
- Position: (${userAction.position?.x}, ${userAction.position?.y})
- Size: ${userAction.size?.width}x${userAction.size?.height}

ANALYZE THE USER'S INTENT:

We assume the user is building something similar to what exists in the context frame.
Look at:
1. What element was added and its properties (name, type, size, position)
2. What similar or related elements exist in the context frame
3. What the user might be trying to build based on the context frame's design patterns
4. How this new element fits into the overall design they're creating

Provide:
1. A concise 1-3 sentence description of what you think the user is trying to build or accomplish
2. A confidence level (high/medium/low) based on how clear the intent is
3. Optional: 2-3 suggested next steps the user might take

Be specific and actionable. Focus on the DESIGN GOAL, not just describing what was added.

Examples:
- "The user is building a dashboard with metric cards similar to the context frame. They've added a new card that likely represents another KPI or statistic."
- "The user appears to be recreating the navigation bar from the context frame, starting with a logo element in the top-left corner."
- "The user is constructing a form layout inspired by the context frame, beginning with an input field that matches the style of the reference design."`;

    const responseSchema = {
        type: "object",
        properties: {
            intent: {
                type: "string",
                description: "1-3 sentence description of what the user is trying to build or accomplish"
            },
            confidence: {
                type: "string",
                enum: ["high", "medium", "low"],
                description: "Confidence level in the intent analysis"
            },
            suggestedNextSteps: {
                type: "array",
                items: {
                    type: "string",
                    description: "Suggested next steps the user might take"
                },
                description: "2-3 suggestions for what the user might do next (can be empty array if no suggestions)"
            }
        },
        required: ["intent", "confidence", "suggestedNextSteps"],
        additionalProperties: false
    };

    const messages: any[] = [
        {
            role: 'system',
            content: 'You are an expert at understanding user intent in UI/UX design. You analyze what users add to their canvas and infer their design goals based on a reference context frame.',
        },
    ];
    
    // Build content array for multimodal input
    const userContent: any[] = [
        {
            type: 'text',
            text: prompt,
        },
    ];
    
    // Add canvas image if available
    if (canvasImageBase64) {
        userContent.push({
            type: 'image_url',
            image_url: {
                url: `data:image/png;base64,${canvasImageBase64}`,
                detail: 'high'
            }
        });
    }
    
    // Add context frame image if available
    if (contextImageBase64) {
        userContent.push({
            type: 'image_url',
            image_url: {
                url: `data:image/png;base64,${contextImageBase64}`,
                detail: 'high'
            }
        });
    }
    
    messages.push({
        role: 'user',
        content: userContent,
    });
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: 'gpt-4o-2024-08-06',
            messages: messages,
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "add_intent_analysis",
                    strict: true,
                    schema: responseSchema
                }
            },
            temperature: 0.3,
        }),
    });

    if (!response.ok) {
        const error = await response.json() as any;
        throw new Error(error.error?.message || 'Intent analysis API error');
    }

    const data = await response.json() as any;
    const content = data.choices[0]?.message?.content || '{"intent":"User added a new element","confidence":"low"}';
    
    return JSON.parse(content);
}

/**
 * Analyzes intent when user moves an existing element
 * Assumes user wants alignment changes
 */
async function analyzeMoveIntent(
    userAction: UserAction,
    canvasStateJSON: any,
    contextFrameJSON: any,
    additionalContext: string | null,
    apiKey: string,
    canvasImageBase64?: string,
    contextImageBase64?: string
): Promise<IntentAnalysis> {
    const prompt = `You are an expert UI/UX design intent analyzer. A user just moved an element on their canvas.

CONTEXT FRAME (reference design):
${JSON.stringify(contextFrameJSON, null, 2)}

${additionalContext ? `ADDITIONAL CONTEXT FROM USER:\n${additionalContext}\n` : ''}

CURRENT CANVAS STATE:
${JSON.stringify(canvasStateJSON, null, 2)}

USER ACTION - MOVED ELEMENT:
- Element: "${userAction.elementName}" (type: ${userAction.elementType})
- ID: ${userAction.elementId}
- From: (${userAction.from?.x}, ${userAction.from?.y})
- To: (${userAction.to?.x}, ${userAction.to?.y})
- Movement: dx=${userAction.delta?.dx}, dy=${userAction.delta?.dy}

ANALYZE THE USER'S INTENT:

We assume the user wants to make alignment or layout changes. Look at:

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

4. How does this relate to the context frame?
   - Are they trying to match an alignment pattern from the context?
   - Are they adapting the context frame's layout principles?

5. Spacing and Margins:
   - Identify proper padding/margins to maintain
   - Note if spacing should be uniform across similar elements

Provide:
1. A concise 1-3 sentence description of what alignment or layout change the user is trying to achieve
2. A confidence level (high/medium/low) based on how clear the intent is
3. Optional: 2-3 suggested next steps for completing the layout

Be specific about the LAYOUT GOAL.

Examples:
- "The user is aligning cards in a vertical stack with consistent spacing, similar to the context frame's layout pattern. They want all similar elements to follow this vertical alignment."
- "The user is creating a 3-column grid layout by repositioning elements. They're establishing equal spacing and alignment across columns."
- "The user is adjusting the spacing between navigation items to match the context frame's consistent 20px gaps."`;

    const responseSchema = {
        type: "object",
        properties: {
            intent: {
                type: "string",
                description: "1-3 sentence description of what alignment or layout change the user is trying to achieve"
            },
            confidence: {
                type: "string",
                enum: ["high", "medium", "low"],
                description: "Confidence level in the intent analysis"
            },
            suggestedNextSteps: {
                type: "array",
                items: {
                    type: "string",
                    description: "Suggested next steps for completing the layout"
                },
                description: "2-3 suggestions for what the user might do next (can be empty array if no suggestions)"
            }
        },
        required: ["intent", "confidence", "suggestedNextSteps"],
        additionalProperties: false
    };

    const messages: any[] = [
        {
            role: 'system',
            content: 'You are an expert at understanding user intent in UI/UX design. You analyze movements and extract the underlying layout and alignment goals.',
        },
    ];
    
    // Build content array for multimodal input
    const userContent: any[] = [
        {
            type: 'text',
            text: prompt,
        },
    ];
    
    // Add canvas image if available
    if (canvasImageBase64) {
        userContent.push({
            type: 'image_url',
            image_url: {
                url: `data:image/png;base64,${canvasImageBase64}`,
                detail: 'high'
            }
        });
    }
    
    // Add context frame image if available
    if (contextImageBase64) {
        userContent.push({
            type: 'image_url',
            image_url: {
                url: `data:image/png;base64,${contextImageBase64}`,
                detail: 'high'
            }
        });
    }
    
    messages.push({
        role: 'user',
        content: userContent,
    });
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: 'gpt-4o-2024-08-06',
            messages: messages,
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "move_intent_analysis",
                    strict: true,
                    schema: responseSchema
                }
            },
            temperature: 0.3,
        }),
    });

    if (!response.ok) {
        const error = await response.json() as any;
        throw new Error(error.error?.message || 'Intent analysis API error');
    }

    const data = await response.json() as any;
    const content = data.choices[0]?.message?.content || '{"intent":"User moved an element","confidence":"low"}';
    
    return JSON.parse(content);
}

