import { ComponentIntent } from './component-types';

export async function analyzeUserIntent(
  userAction: {
    type: 'added' | 'moved';
    added?: { id: string; name: string; type: string; x: number; y: number; width: number; height: number };
    moved?: { id: string; name: string; type: string; x: number; y: number; width: number; height: number };
  },
  canvasJSON: any,
  componentLibrary: any,
  basePrompt: string
): Promise<ComponentIntent[]> {
  
  const basePromptSection = basePrompt ? `Base prompt: "${basePrompt}"` : '';
  
  const prompt = `Analyze user action and return component operations.
${basePromptSection}

=== USER ACTION ===
${JSON.stringify(userAction, null, 2)}

=== COMPONENT LIBRARY ===
${JSON.stringify(componentLibrary.components.map((c: any) => ({ 
  type: c.type, 
  name: c.name,
  id: c.id,
  defaultSize: c.defaultSize
})), null, 2)}

=== CANVAS ===
${JSON.stringify(canvasJSON, null, 2)}

=== SPACING ===
${componentLibrary.designSystem.spacing.md}px

=== RULES ===

**MOVED (userAction.type === "moved"):**
- Analyze elements within 200px of moved element
- Detect pattern: 
  * horizontal row (same Y ±20px) 
  * vertical column (same X ±20px) 
  * grid (multiple X/Y clusters)
- GRID SIGNAL: If moved element was below (higher Y) and now at similar Y (±50px) → GRID layout
- Return ONLY modify actions to reposition elements with ${componentLibrary.designSystem.spacing.md}px spacing
- NO new components

**ADDED (userAction.type === "added"):**

Check canvas for existing form (email/password/button):

IF NO FORM EXISTS:
- "signup" in base prompt → 4 actions: modify→email | add password | add confirm | add button
- "login" in base prompt → 3 actions: modify→email | add password | add button
- Otherwise: modify element + add 0-2 complementary components

IF FORM EXISTS:
- DO NOT add new form components
- Return ONLY modify actions:
  1. Modify new element: If h>80 (textarea) → match width, keep height | else → match width & height
  2-N. Rearrange ALL form elements: Y = prevY + prevHeight + spacing (24px, or 32px after textarea)
- All elements same X and width

**EXAMPLES:**

Signup (no form): [{modify input→email}, {add password}, {add confirm}, {add button}]
Login (no form): [{modify input→email}, {add password}, {add button}]
Add textarea to existing: [{modify textarea w=300 h=120}, {modify email y=100}, {modify textarea y=164}, {modify confirm y=316}, {modify button y=380}]
Grid signal: Element at y=250 moved to y=105 next to element at y=100 → 2-column grid

**POSITION CALC:**
Y(next) = Y(prev) + H(prev) + spacing
- Standard: 24px
- After textarea: 32px

**EXTRACT FROM USER ELEMENT:**
- Text, colors (RGB), size (w×h), position (x,y)

=== OUTPUT ===

Return JSON array (max 6 actions):

{
  "action": "modify"|"add",
  "targetId": "id" (modify only),
  "componentType": "type",
  "description": "brief text",
  "properties": {
    "x": num, "y": num, "width": num, "height": num,
    "text": "str", "placeholder": "str",
    "fill": {"r":0-255,"g":0-255,"b":0-255},
    "stroke": {"r":0-255,"g":0-255,"b":0-255}
  }
}

Return ONLY valid JSON array.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a UI intent analysis expert. Return valid JSON arrays of component actions.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error('Failed to parse OpenAI response:', content);
      throw new Error('Invalid JSON response from OpenAI');
    }

    const actions = parsed.actions || parsed;
    
    if (!Array.isArray(actions)) {
      console.error('Response is not an array:', actions);
      throw new Error('Expected array of actions');
    }

    return actions.map((action: any) => ({
      action: action.action,
      targetId: action.targetId || '',
      componentType: action.componentType,
      description: action.description || '',
      properties: action.properties || {},
      placement: action.placement || { x: action.properties?.x || 0, y: action.properties?.y || 0 }
    }));

  } catch (error) {
    console.error('Error in analyzeUserIntent:', error);
    return [];
  }
}
