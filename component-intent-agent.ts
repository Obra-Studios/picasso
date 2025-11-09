// ============================================================================
// COMPONENT INTENT AGENT
// Analyzes user actions and determines component usage intent
// Can return multiple component actions in one response
// ============================================================================

import { ComponentIntent, ComponentIntentResponse, ComponentLibrary } from './component-types';

/**
 * Analyze user action and determine component intent
 * Can return multiple actions to build complete patterns
 */
export async function analyzeComponentIntent(
  userAction: any,
  componentLibrary: ComponentLibrary,
  canvasJSON: any,
  apiKey: string,
  basePrompt?: string
): Promise<ComponentIntent[]> {
  const basePromptSection = basePrompt 
    ? `\n=== BASE PROMPT / USER INSTRUCTIONS ===\n${basePrompt}\n\nConsider these instructions when determining the next component to add.\n` 
    : '';

  const prompt = `Analyze user action and return component operations.
${basePromptSection}
=== USER ACTION ===
${JSON.stringify(userAction, null, 2)}

=== COMPONENT LIBRARY ===
${JSON.stringify(componentLibrary.components.map(c => ({ 
  type: c.type, 
  name: c.name,
  id: c.id,
  defaultSize: c.defaultSize
})), null, 2)}

=== CANVAS ===
${JSON.stringify(canvasJSON, null, 2)}

=== DESIGN SYSTEM ===
Spacing: ${JSON.stringify(componentLibrary.designSystem.spacing, null, 2)}

=== RULES ===

**MOVED (userAction.type === "moved"):**
- Analyze elements within 200px
- Detect pattern: horizontal row (same Y ±20px) | vertical column (same X ±20px) | grid (multiple X/Y clusters)
- GRID SIGNAL: If moved element was below another (higher Y) and now at similar Y (±50px) → GRID layout
- Return ONLY modify actions to reposition elements with spacing ${componentLibrary.designSystem.spacing.md}px
- NO new components

**ADDED (userAction.type === "added"):**

*Check canvas for existing form first (email/password/button inputs)*

IF NO FORM EXISTS:
- Base prompt "signup" → 4 actions: modify to email | add password | add confirm | add button
- Base prompt "login" → 3 actions: modify to email | add password | add button
- Otherwise: modify element + add 0-2 complementary components

IF FORM EXISTS (email + password + button already in canvas):
- DO NOT add new form components
- Return ONLY modify actions:
  1. Modify new element: If height >80px (textarea) → match width only, keep height | If input → match width & height
  2-N. Rearrange ALL form elements: Calculate Y = prevY + prevHeight + spacing (24px standard, 32px after textarea)
- All elements same X and width

**EXAMPLES:**

Signup (no form): [modify input→email, add password, add confirm, add button]
Login (no form): [modify input→email, add password, add button]  
Add textarea to form: [modify textarea w=300 h=120, modify email y=100, modify textarea y=174, modify button y=338]
Move element next to upper: Grid layout (2 col)
Move elements same Y: Horizontal row

Example B - 2-column grid (4 cards forming 2x2):
Current: Card1 (x=100, y=100), Card2 (x=300, y=105), Card3 (x=95, y=250), Card4 (x=305, y=248)
Pattern detected: 2-column grid (2 X positions ~100 and ~300, 2 Y positions ~100 and ~250)
Actions: 
- Row 1: Card1 at (100, 100), Card2 at (300, 100)
- Row 2: Card3 at (100, 250), Card4 at (300, 250)
Result: Symmetric 2x2 grid with 200px column gap, 150px row gap

Example C - Vertical column (3 inputs at similar X, different Y):
Current: Input1 (x=150, y=100), Input2 (x=148, y=180), Input3 (x=152, y=290)
Pattern detected: Vertical column (X positions similar: 150±4px)
Actions: Align all to x=150, stack vertically with 24px gaps

Example D - GRID SIGNAL: Lower element moved next to upper element:
Before move: Card1 (x=100, y=100), Card2 (x=105, y=250) - Card2 was BELOW Card1
User moves Card2 to: (x=300, y=105) - Now next to Card1 horizontally
Pattern detected: GRID LAYOUT signal (lower element moved to same Y as upper element)
Analysis: Card2 was at y=250 (below), now at y=105 (≈ Card1's y=100)
Actions:
- Modify Card1 → position at (100, 100)
- Modify Card2 → position at (300, 100) [create 2-column grid, same row]
Result: 2-column, 1-row grid instead of vertical column

⚠️ CRITICAL: When lower element moved next to upper element → ALWAYS choose GRID layout over column!
⚠️ For MOVED actions: ONLY return "modify" actions, NEVER "add" actions.

---

✨ FOR ADDED ACTIONS (userAction.type === "added"):
Your task is to BUILD a pattern by modifying what they added and adding complementary components.

FIRST ACTION - MODIFY THE USER'S ELEMENT:
Always start by modifying/refining the element the user just added to match the pattern:
- Use action: "modify"
- Use targetId: "${userAction.added?.id || ''}" (the ID of what they added)
- Match it to a component type from the library
- Set properties based on what they added AND the broader pattern

Example: User adds a rectangle with text "Email"
- Action 1: Modify that rectangle → Make it an "input" component with proper styling and "Enter your email" placeholder

SUBSEQUENT ACTIONS - ADD COMPLEMENTARY COMPONENTS:
After modifying the user's element, add 0-3 additional components to complete the pattern.
For example:
- If building a form input, you might add: [label component above]
- If building a card, you might add: [heading, text, button]
- If completing a form, you might add: [submit button, cancel button]

---

CRITICAL RULE - COMPLETE COMPONENTS ONLY:
You must ONLY use COMPLETE components from the library above. Each component is already designed and complete.
❌ NEVER extract parts of a component (like just the label from an input)
❌ NEVER create fragments or partial components
✅ ALWAYS use the ENTIRE component as it exists in the library

UNDERSTANDING USER INTENT:
Based on what they just added "${userAction.added?.name || 'element'}", think about the BROADER pattern:

- If they added an INPUT → They're likely building a form (next might be: text label above + input, or another input below, or submit button)
- If they added a BUTTON → They might be building a CTA or completing a form
- If they added TEXT → They might be starting a section, heading, or labeling something
- If they added a CARD → They might be building a grid or list
- If they added a CONTAINER → They might be structuring a layout

COMMON FORM PATTERNS TO RECOGNIZE:

**🚨 SIGNUP/REGISTRATION FORM - EXACT SPECIFICATION:**
If the BASE PROMPT contains "signup", "sign up", "register", or "registration", you are building a SIGNUP form.
**POSITION CALCULATION:**
Y(next) = Y(prev) + Height(prev) + spacing
- Standard spacing: 24px
- After textarea (h>80): 32px
- All form elements: same X, same width

**PROPERTY EXTRACTION:**
Extract from user's element:
- Text content
- Fill/stroke colors (RGB values)
- Size (w × h)  
- Position (x, y)

Use these to infer intent for ALL actions.

=== OUTPUT FORMAT ===

Return JSON array (max 6 actions):
{
  "action": "modify"|"add",
  "targetId": "id" (modify only),
  "componentType": "type",
  "description": "brief",
  "properties": {
    "x": num, "y": num, "width": num, "height": num,
    "text": "str", "placeholder": "str",
    "fill": {"r":0-255,"g":0-255,"b":0-255}
  }
}

Return ONLY valid JSON array.
`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
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
