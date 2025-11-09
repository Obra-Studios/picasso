// ============================================================================
// ENHANCED INTENT EXTRACTION
// Uses constraint diff + visual context for better understanding
// ============================================================================

import { Constraint, ConstraintDiff, CanvasObject } from './constraints';

export interface UserIntent {
    description: string;
    targetPattern: string;
    alignmentType: string;
    spacingRequirement: string;
    objectsToMove: string[];
    objectsToKeepFixed: string[];
    fixedObjectsReasoning: string;
    constraintsToSatisfy: Constraint[];
    scope: {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
    };
}

export async function extractUserIntent(
    diff: ConstraintDiff,
    objects: CanvasObject[],
    screenshot: string | null,
    apiKey: string
): Promise<UserIntent> {
    const objectsMap = new Map(objects.map(obj => [obj.id, obj]));
    
    // Build context with constraint information
    const constraintContext = buildConstraintContext(diff, objectsMap);
    
    // Calculate scope (affected region)
    const scope = calculateScope(diff.affectedObjects, objectsMap);
    
    const prompt = `You are analyzing a UI layout change in Figma. A user moved "${objectsMap.get(diff.movedObject)?.name}" and potentially broke some layout constraints.

**CONSTRAINT ANALYSIS:**
${constraintContext}

**OBJECTS IN SCOPE:**
${Array.from(diff.affectedObjects).map(id => {
    const obj = objectsMap.get(id);
    return obj ? `- ${obj.name} (${obj.type}) at (${obj.x}, ${obj.y}) size ${obj.width}×${obj.height}` : '';
}).join('\n')}

**YOUR TASK:**
1. Analyze what layout pattern the user is trying to achieve
2. Identify which objects should move to restore/improve the layout
3. Identify which objects should stay fixed (including the moved object as anchor)
4. Explain the reasoning

**IMPORTANT:**
- The object that was just moved (${objectsMap.get(diff.movedObject)?.name}) should ALWAYS be in objectsToKeepFixed as it's the anchor point
- Only move objects that need to adjust to maintain the layout pattern
- Consider both violated and preserved constraints

Return your analysis in the specified JSON format.`;

    const intentSchema = {
        type: "object",
        properties: {
            description: {
                type: "string",
                description: "Clear description of what layout pattern the user is creating"
            },
            targetPattern: {
                type: "string",
                description: "The specific layout pattern (e.g., 'vertical stack', 'grid', 'aligned row')"
            },
            alignmentType: {
                type: "string",
                description: "Primary alignment (e.g., 'left-aligned', 'center-aligned', 'distributed')"
            },
            spacingRequirement: {
                type: "string",
                description: "Spacing pattern (e.g., '16px consistent spacing', 'equal distribution')"
            },
            objectsToMove: {
                type: "array",
                items: { type: "string" },
                description: "IDs of objects that should be repositioned to satisfy the intent"
            },
            objectsToKeepFixed: {
                type: "array",
                items: { type: "string" },
                description: "IDs of objects that should NOT move (anchors, including the moved object)"
            },
            fixedObjectsReasoning: {
                type: "string",
                description: "Why these objects should stay fixed"
            }
        },
        required: [
            "description",
            "targetPattern",
            "alignmentType",
            "spacingRequirement",
            "objectsToMove",
            "objectsToKeepFixed",
            "fixedObjectsReasoning"
        ],
        additionalProperties: false
    };

    const messages: any[] = [
        {
            role: 'system',
            content: 'You are an expert UI/UX layout analyzer. You understand constraint-based layouts, alignment systems, and spatial relationships. Analyze the provided constraint violations and visual context to determine user intent.',
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
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: 'gpt-4o-2024-08-06',
            messages: messages,
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "user_intent_analysis",
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
    const content = data.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    
    return Object.assign({}, parsed, {
        constraintsToSatisfy: diff.violated,
        scope
    });
}

function buildConstraintContext(diff: ConstraintDiff, objects: Map<string, CanvasObject>): string {
    let context = '';
    
    if (diff.violated.length > 0) {
        context += '**VIOLATED CONSTRAINTS:**\n';
        for (const constraint of diff.violated) {
            context += `- ${describeConstraint(constraint, objects)}\n`;
        }
        context += '\n';
    }
    
    if (diff.preserved.length > 0) {
        context += `**PRESERVED CONSTRAINTS:** ${diff.preserved.length} constraints still satisfied\n\n`;
    }
    
    return context;
}

function describeConstraint(constraint: Constraint, objects: Map<string, CanvasObject>): string {
    switch (constraint.type) {
        case 'alignment':
            const alignedNames = constraint.objects
                .map(id => objects.get(id)?.name || id)
                .join(', ');
            return `${constraint.alignmentType} alignment: ${alignedNames}`;
            
        case 'spacing':
            const obj1Name = objects.get(constraint.object1)?.name || constraint.object1;
            const obj2Name = objects.get(constraint.object2)?.name || constraint.object2;
            return `${constraint.distance}px ${constraint.spacingType} spacing between ${obj1Name} and ${obj2Name}`;
            
        case 'distribution':
            return `${constraint.distributionType} distribution: ${constraint.objects.length} objects with ${constraint.spacing}px spacing`;
            
        case 'grid':
            return `Grid: ${constraint.rows}×${constraint.columns} with ${constraint.rowGap}px rows, ${constraint.columnGap}px columns`;
            
        default:
            return 'Unknown constraint';
    }
}

function calculateScope(
    affectedObjects: Set<string>,
    objects: Map<string, CanvasObject>
): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    
    for (const id of affectedObjects) {
        const obj = objects.get(id);
        if (obj) {
            minX = Math.min(minX, obj.x);
            minY = Math.min(minY, obj.y);
            maxX = Math.max(maxX, obj.x + obj.width);
            maxY = Math.max(maxY, obj.y + obj.height);
        }
    }
    
    // Add 50px margin
    const margin = 50;
    return {
        minX: minX - margin,
        minY: minY - margin,
        maxX: maxX + margin,
        maxY: maxY + margin
    };
}
