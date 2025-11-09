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
): Promise<ComponentIntentResponse> {
  const basePromptSection = basePrompt 
    ? `\n=== BASE PROMPT / USER INSTRUCTIONS ===\n${basePrompt}\n\nConsider these instructions when determining the next component to add.\n` 
    : '';

  const prompt = `The user just performed an action. Your job is to:
1. Understand what they're trying to do
2. Update/refine elements based on their intent and context
3. Suggest additional components to complete the pattern (ONLY if they ADDED an element, NOT if they MOVED one)
${basePromptSection}
=== WHAT THE USER JUST DID ===
${JSON.stringify(userAction, null, 2)}

User action type: "${userAction.type || 'unknown'}"
Element: "${userAction.added?.name || userAction.moved?.name || 'an element'}" (ID: ${userAction.added?.id || userAction.moved?.id || 'unknown'})
Type: ${userAction.added?.type || userAction.moved?.type || 'unknown'}

🚨 CRITICAL - MOVED vs ADDED:

**If userAction.type === "moved":**
The user is REARRANGING the UI layout. This is about organizing existing elements into a clean, symmetric layout.

Your job is to:
1. Analyze ALL nearby elements in the canvas (within ~200px of the moved element)
2. Detect the intended layout pattern (horizontal row, vertical column, grid)
3. Return MULTIPLE "modify" actions to rearrange ALL related elements into a symmetric flex/grid layout
4. DO NOT ADD NEW COMPONENTS - only reposition existing ones

Layout Guidelines for MOVED actions:
- **Flex Row (Horizontal)**: Align elements with equal spacing, same Y position, consistent gaps
  - Example: [Button] [Button] [Button] - evenly spaced horizontally
- **Flex Column (Vertical)**: Stack elements with equal spacing, same X position, consistent gaps
  - Example: Input fields stacked vertically with uniform spacing
- **Grid Layout**: Arrange in rows and columns with symmetric spacing
  - Example: 2x2 grid of cards with equal gaps
- **Alignment**: Use design system spacing (${componentLibrary.designSystem.spacing.md}px default)
- **Symmetry**: Ensure equal gaps, aligned edges, centered if appropriate

**If userAction.type === "added":**
The user is BUILDING a pattern. You can modify what they added AND add complementary components.

🔍 CRITICAL - ANALYZE CANVAS FOR EXISTING FORMS:
Before determining actions, check the canvas JSON for existing form elements:
- Look for input components with text containing: "email", "password", "confirm"
- Look for button components with text containing: "sign up", "login", "submit"
- If you find a complete form (email + password + confirm + button) AND base prompt has "signup":
  → The user is ADDING A FIELD to an existing signup form
  → Follow the "ADDING FIELDS TO EXISTING SIGNUP FORM" pattern below

CRITICAL - EXTRACT USER'S PROPERTIES:
Look at the element the user added and extract:
- Text content: Does it have text? What does it say? (e.g., "Email", "Submit", "Login")
- Color/Fill: What color did they use? (extract RGB values)
- Size: How big is it? (width x height)
- Position: Where did they place it?

These properties tell us the user's intent - use them to inform ALL your actions!

=== COMPONENT LIBRARY (COMPLETE COMPONENTS ONLY) ===
These are the COMPLETE, READY-TO-USE components extracted from your design system.
Each component is WHOLE and FUNCTIONAL - never use partial components or fragments.

${JSON.stringify(componentLibrary.components.map(c => ({ 
  type: c.type, 
  name: c.name,
  id: c.id,
  defaultSize: c.defaultSize,
  properties: c.properties
})), null, 2)}

=== CURRENT CANVAS STATE ===
${JSON.stringify(canvasJSON, null, 2)}

=== DESIGN SYSTEM ===
Spacing: ${JSON.stringify(componentLibrary.designSystem.spacing, null, 2)}
Colors: ${JSON.stringify(componentLibrary.designSystem.colors, null, 2)}

=== YOUR TASK ===

🔄 FOR MOVED ACTIONS (userAction.type === "moved"):
Your task is to REARRANGE UI elements into a clean, symmetric layout based on their CURRENT POSITIONS.

🚨 CRITICAL - ANALYZE ACTUAL POSITIONS TO CHOOSE MOST EFFICIENT LAYOUT:

Steps:
1. **Identify the moved element**: "${userAction.moved?.name || 'element'}" at new position (x: ${userAction.moved?.x || 'unknown'}, y: ${userAction.moved?.y || 'unknown'})

2. **Find ALL nearby elements**: Look at the canvas JSON and find ALL elements within ~200px radius of the moved element
   - Extract their current X and Y positions
   - Extract their widths and heights
   - Note their types (button, input, text, card, etc.)
   - **CRITICAL**: Check if any nearby elements have a HIGHER Y position (were below) the moved element BEFORE it was moved

3. **🚨 GRID LAYOUT SIGNAL - LOWER ELEMENT MOVED NEXT TO UPPER ELEMENT:**
   
   **Strong indicator for GRID layout:**
   - If the moved element was previously at a LOWER Y position (below other elements)
   - AND now it's at a SIMILAR Y position (±50px) to an element that was ABOVE it
   - This is a STRONG signal the user wants a GRID layout (not a column)
   
   Example:
   - Before: Element A at y=100, Element B at y=200 (B is below A)
   - User moves B to y=105, x=300 (next to A horizontally)
   - **Detection**: B was below (y=200) and is now next to A (y=105 ≈ y=100)
   - **Action**: Create 2-column grid with A and B in same row
   
   When you detect this pattern:
   → PRIORITIZE grid layout over column layout
   → Arrange elements into rows with multiple columns
   → If 2 elements → 2-column, 1-row grid
   → If 3-4 elements → 2-column grid (2x2 or 2x1)
   → If 6+ elements → 2-column or 3-column grid

4. **ANALYZE POSITIONS to detect the MOST EFFICIENT layout pattern**:
   
   **PRIORITY 1 - Check for GRID LAYOUT SIGNAL (lower element moved next to upper):**
   - Did the moved element have a higher Y value before (was below other elements)?
   - Is it now at similar Y position (±50px) to elements that were above it?
   - **If YES → GRID LAYOUT is strongly indicated**
   - Proceed to create 2-column or multi-column grid
   
   **PRIORITY 2 - Check for HORIZONTAL ROW pattern:**
   - Are elements roughly at the SAME Y position (within ±20px)?
   - Are they spread horizontally (different X positions)?
   - If YES AND no grid signal → Create horizontal flex layout (single row)
   
   **PRIORITY 3 - Check for 2-COLUMN GRID pattern:**
   - Are there elements at TWO distinct X positions (e.g., left column ~x=100, right column ~x=300)?
   - Are there elements at MULTIPLE Y positions forming rows?
   - Do you have 4+ elements that could form a 2x2 or 2x3 grid?
   - If YES → Create 2-column grid layout with symmetric rows and columns
   
   **PRIORITY 4 - Check for VERTICAL COLUMN pattern:**
   - Are elements roughly at the SAME X position (within ±20px)?
   - Are they spread vertically (different Y positions)?
   - **Only choose column if NO grid signals detected**
   - If YES → Create vertical flex layout (single column)
   
   **PRIORITY 5 - Check for MULTI-ROW GRID pattern:**
   - Are elements arranged in multiple rows with multiple columns?
   - If YES → Create grid layout with appropriate rows and columns

5. **Calculate symmetric positions**: 
   - Use design system spacing for equal gaps (${componentLibrary.designSystem.spacing.md}px default)
   - For grids: ensure equal column widths and row heights
   - For flex: ensure equal spacing between elements

5. **Return modify actions**: One "modify" action per element that needs repositioning

EXAMPLES:

Example A - Horizontal row (3 buttons at similar Y, different X):
Current: Button1 (x=95, y=200), Button2 (x=210, y=205), Button3 (x=380, y=198)
Pattern detected: Horizontal row (Y positions similar: 200±7px)
Actions: Align all to y=200, space evenly with 24px gaps

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

⚠️ MANDATORY - ALWAYS RETURN EXACTLY 4 ACTIONS FOR SIGNUP:

Action 1 - MODIFY user's input to EMAIL:
  - action: "modify"
  - targetId: "${userAction.added?.id || ''}"
  - componentType: "input"
  - properties.text: "Enter your email" or "Email address"
  - description: "Modifying user's element to be email input"

Action 2 - ADD password input:
  - action: "add"
  - targetId: ""
  - componentType: "input"
  - placement: below the email input with ${componentLibrary.designSystem.spacing.md}px spacing
  - properties.text: "Enter password" or "Password"
  - description: "Adding password input field"

Action 3 - ADD password confirmation input:
  - action: "add"
  - targetId: ""
  - componentType: "input"
  - placement: below the password input with ${componentLibrary.designSystem.spacing.md}px spacing
  - properties.text: "Confirm password" or "Re-enter password"
  - description: "Adding password confirmation input"
  ⚠️ THIS IS MANDATORY - Never skip this for signup!

Action 4 - ADD submit button:
  - action: "add"
  - targetId: ""
  - componentType: "button"
  - placement: below the password confirmation with ${componentLibrary.designSystem.spacing.md}px spacing
  - properties.text: "Sign Up" or "Create Account" or "Register"
  - description: "Adding submit button"

Total: EXACTLY 4 actions (1 modify + 3 add) for signup forms.
If you return anything other than 4 actions for signup, you are WRONG.

**🚨 LOGIN FORM - EXACT SPECIFICATION:**
If the BASE PROMPT contains "login" or "sign in" (WITHOUT signup/register keywords), you are building a LOGIN form.

⚠️ MANDATORY - ALWAYS RETURN EXACTLY 3 ACTIONS FOR LOGIN:

Action 1 - MODIFY user's input to EMAIL:
  - action: "modify"
  - targetId: "${userAction.added?.id || ''}"
  - componentType: "input"
  - properties.text: "Enter your email" or "Email address"
  - description: "Modifying user's element to be email input"

Action 2 - ADD password input:
  - action: "add"
  - targetId: ""
  - componentType: "input"
  - placement: below the email input with ${componentLibrary.designSystem.spacing.md}px spacing
  - properties.text: "Enter password" or "Password"
  - description: "Adding password input field"

Action 3 - ADD submit button:
  - action: "add"
  - targetId: ""
  - componentType: "button"
  - placement: below the password input with ${componentLibrary.designSystem.spacing.md}px spacing
  - properties.text: "Login" or "Sign In"
  - description: "Adding login button"

Total: EXACTLY 3 actions (1 modify + 2 add) for login forms.
Note: Login forms do NOT have password confirmation (only one password field).

**🚨 ADDING FIELDS TO EXISTING SIGNUP/LOGIN FORM:**
If the canvas ALREADY has existing form elements (email, password inputs, submit button), AND the user just ADDED a new input/textarea field:

This means the user wants to add an additional field to the existing form (e.g., description, name, phone, message).

🚨 CRITICAL - DO NOT ADD NEW COMPONENTS:
- Only return MODIFY actions to incorporate the new field and rearrange existing form
- DO NOT generate new email/password/button components
- The form structure already exists - just integrate the new field

⚠️ MANDATORY - Return actions to:

1. MODIFY the newly added element - CRITICAL SIZE DETECTION:
   
   **🚨 DETECT ELEMENT TYPE FROM CANVAS JSON:**
   - Look at the newly added element's height in canvas JSON
   - Look at existing form input heights for comparison
   
   **If TEXTAREA (height >80px OR significantly taller than inputs):**
   - ⚠️ DO NOT resize the height - keep it as is (typically 80-150px)
   - ✅ Resize WIDTH ONLY to match form input widths
   - ✅ Check canvas JSON for input width (e.g., email input width)
   - ✅ Set textarea width to match that input width exactly
   - ✅ Set placeholder to "Enter your message", "Description", or "Additional details"
   - Example: If email input is 300px wide, set textarea to 300px wide (keep height unchanged)
   
   **If regular INPUT (height ≤50px, similar to other inputs):**
   - ✅ Resize BOTH width AND height to match existing inputs
   - ✅ Check canvas JSON for email/password input dimensions
   - ✅ Set placeholder to "Name", "Phone", "Description", etc.
   
   - action: "modify"
   - targetId: "${userAction.added?.id || ''}"
   - componentType: "input" or "text" (match what's in canvas)
   - properties.text: Contextual placeholder

2-N. REARRANGE the entire form stack (MODIFY actions for ALL form elements):
   
   **🚨 CRITICAL - CALCULATE POSITIONS TO AVOID OVERLAP:**
   
   Steps:
   1. Find ALL form elements in canvas (email, password, confirm, new field, button)
   2. Get each element's height from canvas JSON
   3. Calculate Y positions to stack without overlap:
      - Start position: y = first element's Y (e.g., 100)
      - For each subsequent element:
        * Y = previous element's Y + previous element's HEIGHT + spacing
        * Standard spacing: ${componentLibrary.designSystem.spacing.md}px (24px)
        * After textarea: ${componentLibrary.designSystem.spacing.lg || 32}px (32px for extra room)
   
   Example calculation:
   - Email input: y=100, height=50 → next Y = 100 + 50 + 24 = 174
   - Password input: y=174, height=50 → next Y = 174 + 50 + 24 = 248
   - Textarea: y=248, height=120 → next Y = 248 + 120 + 32 = 400
   - Button: y=400, height=40
   
   **Order options:**
   - Standard: email → password → confirm → textarea → button
   - Alternative: email → name → textarea → password → confirm → button
   
   **Alignment:**
   - All elements at SAME X position (left-aligned)
   - All inputs/button at SAME WIDTH
   - Textarea at SAME WIDTH as inputs

Total: Multiple "modify" actions - one for each form element to resize and reposition.
DO NOT return any "add" actions when adding to existing form.

Example A - Adding regular input to existing signup form:
- Canvas has: email (y=100, h=50, w=300), password (y=180, h=50), confirm (y=260, h=50), button (y=340, h=40)
- User adds: new input field (h=50)
- Actions:
  1. Modify new input → width=300 (match inputs), height=50 (match inputs), text: "Full Name"
  2. Modify email → y=100 (top of stack)
  3. Modify new (name) → y=174 (100 + 50 + 24)
  4. Modify password → y=248 (174 + 50 + 24)
  5. Modify confirm → y=322 (248 + 50 + 24)
  6. Modify button → y=396 (322 + 50 + 24)

Example B - Adding TEXTAREA to existing contact form (AVOIDING OVERLAP):
- Canvas has: name input (y=100, h=50, w=300), email input (y=160, h=50), button (y=220, h=40)
- User adds: textarea (h=120, w=250) - WRONG width, needs to match
- Calculation:
  * Textarea should be: w=300 (match inputs), h=120 (keep as is)
  * Name: y=100
  * Email: y=174 (100 + 50 + 24)
  * Textarea: y=248 (174 + 50 + 24)
  * Button: y=400 (248 + 120 + 32 spacing after textarea)
- Actions:
  1. Modify textarea → width=300 (match inputs), height=120 (keep), text: "Enter your message"
  2. Modify name → y=100, width=300
  3. Modify email → y=174, width=300
  4. Modify textarea → y=248, width=300
  5. Modify button → y=400, width=300

⚠️ CRITICAL: Calculate each Y position using: previous Y + previous HEIGHT + spacing
⚠️ This prevents overlapping elements!

**CONTACT FORM:**
If the user adds "Name", "Message", or "Contact":
1. Name input
2. Email input
3. Message/textarea
4. Submit button (with text "Send" or "Submit")

PROPERTY CUSTOMIZATION - CRITICAL:
ALWAYS customize the properties (text, color) to match the user's intent:

1. Look at the user action properties:
   - What text did they use? (e.g., "Email", "Submit", "Login")
   - What color did they choose?

2. Override default component properties to match:
   ❌ WRONG: Add input with default text "Enter text"
   ✅ CORRECT: Add input with contextual text "Email address"
   
   ❌ WRONG: Add button with default text "Click me"
   ✅ CORRECT: Add button with text "Submit" or "Login"
   
   ❌ WRONG: Add text with generic content "Label"
   ✅ CORRECT: Add text with specific content "Email" or "Password"

3. Use design system colors from the palette above

DETERMINE THE NEXT COMPONENT(S):

🚨 CRITICAL DECISION - MOVED vs ADDED:

**If userAction.type === "moved":**
🎯 ANALYZE CURRENT POSITIONS TO CHOOSE MOST EFFICIENT LAYOUT

Steps to determine layout:
1. **Extract positions from canvas JSON**: Get X, Y, width, height of all elements within ~200px
2. **Analyze X positions**: 
   - All similar X (±20px)? → Vertical column layout
   - 2 distinct X values? → 2-column grid layout
   - 3+ distinct X values? → Multi-column grid or horizontal row
3. **Analyze Y positions**:
   - All similar Y (±20px)? → Horizontal row layout
   - 2+ distinct Y values with similar X groups? → Grid layout with rows
4. **Choose the pattern that requires MINIMAL position changes**

Layout Options (choose most efficient):
- **Single horizontal row**: Elements at same Y, different X
- **Single vertical column**: Elements at same X, different Y  
- **2-column grid**: Elements at 2 distinct X positions, multiple Y positions (e.g., 2x2, 2x3 grid)
- **3-column grid**: Elements at 3 distinct X positions, multiple Y positions
- **Multi-row grid**: Elements forming clear rows and columns

Return 2-8 "modify" actions (one per element) to create symmetric layout:
- Use equal spacing from design system (${componentLibrary.designSystem.spacing.md}px default)
- Align edges (for grids: same X for columns, same Y for rows)
- DO NOT ADD NEW COMPONENTS

Example A - 2x2 Grid (4 cards):
Canvas shows: Card1 (x=105, y=100), Card2 (x=295, y=110), Card3 (x=100, y=240), Card4 (x=300, y=235)
Detection: 2 X clusters (~100, ~300), 2 Y clusters (~105, ~237) → 2-column grid
Actions:
- Modify Card1: position at (100, 100)
- Modify Card2: position at (300, 100) [200px right of Card1]
- Modify Card3: position at (100, 250) [150px below Card1]
- Modify Card4: position at (300, 250) [200px right of Card3, 150px below Card2]

Example B - Horizontal row (3 buttons):
Canvas shows: Btn1 (x=120, y=200), Btn2 (x=240, y=205), Btn3 (x=380, y=198)
Detection: Similar Y (~200), different X → Horizontal row
Actions:
- Modify Btn1: position at (100, 200)
- Modify Btn2: position at (224, 200) [124px right: 100px width + 24px gap]
- Modify Btn3: position at (348, 200) [124px right of Btn2]

**If userAction.type === "added":**
You can return 1-4 actions to build a pattern:
  - First action: "modify" the user's added element
  - Subsequent actions: "add" complementary components (0-3 additional)
  - For SIGNUP forms: You MUST add all 4 components (email, password, confirm password, submit button)

For EACH action in your response:
1. Pick action type: "modify" (for repositioning elements) or "add" (for new components)
2. Pick ONE complete component TYPE from the library (button/input/text/card/container/icon/image)
3. Set targetId:
   - For "modify" action: Use the ID of the element you're repositioning (from canvas)
   - For "add" action: Use "" (empty string for new components)
4. Determine WHERE to place it (relative to reference element)
5. Set proper spacing from the design system (default: ${componentLibrary.designSystem.spacing.md}px)
6. Specify alignment based on the pattern
7. **CUSTOMIZE properties (text, color) to match user intent** - don't use generic defaults!

YOUR RESPONSE FORMAT:
- overallIntent: High-level description of what's being done
  Example for MOVED: "Arranging 3 buttons in a horizontal flex layout with equal spacing"
  Example for ADDED: "Refining user's element as email input and building a login form"
  
- actions: Array of actions, each with:
  - componentType: Use EXACT type from library (button/input/text/card/container/icon/image)
  - action: "modify" (for repositioning/updating) or "add" (for new components)
  - description: Why THIS action is being performed
    Example: "Modifying user's rectangle to be a proper email input field"
  - targetId: ID of user's added element (for modify) OR "" (for add)
  - placement: Specify relative to the element the user just added OR relative to previous action
    - relativeTo: Use the ID or name of reference element
    - relationship: above/below/left/right/inside
    - alignment: left/center/right (horizontal) or top/middle/bottom (vertical)
    - spacing: Use value from design system (default: ${componentLibrary.designSystem.spacing.md})
  - properties: **CUSTOMIZE to match user intent!**
    - text: Contextual, meaningful text (e.g., "Email", "Password", "Submit", "Cancel")
      NOT generic defaults like "Label", "Button", "Enter text"
    - color: Use color from design system that matches intent

REMEMBER - CRITICAL RULES:
1. ⚠️ MOVED vs ADDED - POSITION-BASED LAYOUT ANALYSIS:
   - User action type: "${userAction.type || 'unknown'}"
   - If MOVED: 
     → ANALYZE ACTUAL X,Y POSITIONS from canvas JSON
     → Look at elements within ~200px of moved element
     → Detect MOST EFFICIENT pattern based on current positions:
       • Similar Y (±20px), different X → Horizontal row
       • Similar X (±20px), different Y → Vertical column  
       • 2 distinct X values + multiple Y → 2-column grid (e.g., 2x2, 2x3)
       • Multiple X and Y clusters → Multi-column grid
     → Return 2-8 "modify" actions (one per element to reposition)
     → Use equal spacing (${componentLibrary.designSystem.spacing.md}px default)
     → Create symmetric, aligned layout
     → NO new components - only reposition existing ones
   - If ADDED: 
     → Can modify what they added + add complementary components

2. ⚠️ EXACT FORM SPECIFICATIONS - NEVER DEVIATE:
   - Base prompt: "${basePrompt || 'none'}"
   
   **If "signup" or "sign up" or "register" in base prompt:**
   → Return EXACTLY 4 actions:
     1. MODIFY user's input → componentType: "input", text: "Enter your email"
     2. ADD password input → componentType: "input", text: "Enter password"
     3. ADD confirm password → componentType: "input", text: "Confirm password"
     4. ADD submit button → componentType: "button", text: "Sign Up"
   → If you return anything other than 4 actions, you are WRONG
   
   **If "login" or "sign in" in base prompt (no signup keywords):**
   → Return EXACTLY 3 actions:
     1. MODIFY user's input → componentType: "input", text: "Enter your email"
     2. ADD password input → componentType: "input", text: "Enter password"
     3. ADD submit button → componentType: "button", text: "Login"
   → Login forms have NO password confirmation field
   
   **If canvas already has existing form elements (email, password, button, etc.):**
   → User is adding additional field to existing form
   → DO NOT generate new form components (no new email/password/button)
   → Return ONLY MODIFY actions to incorporate new field:
   
   🚨 TEXTAREA SIZE HANDLING - CRITICAL:
     1. MODIFY new element:
        • Check element HEIGHT in canvas JSON
        • If TEXTAREA (height >80px): 
          - ⚠️ DO NOT change height - keep original height (e.g., 120px)
          - ✅ Change WIDTH ONLY to match input widths from canvas
          - ✅ Set text: "Enter your message" or "Description"
        • If INPUT (height ≤50px): 
          - Match both width AND height to existing inputs
     
     2-N. MODIFY all form elements → CALCULATE positions to prevent overlap:
        • Get each element's HEIGHT from canvas JSON
        • Calculate Y positions: Y(next) = Y(prev) + HEIGHT(prev) + spacing
        • Standard spacing: ${componentLibrary.designSystem.spacing.md}px (24px)
        • After textarea: ${componentLibrary.designSystem.spacing.lg || 32}px (32px)
        • Example: If textarea is 120px tall at y=200, next element at y=352 (200+120+32)
   
   → ⚠️ MUST extract heights from canvas to calculate positions correctly
   → Align all to same X position and same width

3. 🎯 POSITION CLUSTERING & GRID DETECTION (for MOVED actions):
   - Extract X,Y from canvas JSON for all nearby elements
   - **🚨 PRIORITY CHECK - Lower element moved next to upper element:**
     → If moved element had higher Y (was below) and now has similar Y (±50px) to upper element
     → This is STRONG signal for GRID layout (not column)
     → ALWAYS prefer grid over column when this signal is detected
   - Group similar X positions (±20px tolerance) → identifies columns
   - Group similar Y positions (±20px tolerance) → identifies rows
   - Pattern priority:
     1. Grid signal detected → Create grid layout
     2. 1 Y cluster = horizontal row
     3. 2+ X clusters + 2+ Y clusters = grid layout (possibly 2-column)
     4. 1 X cluster = vertical column (only if NO grid signal)
   - Choose pattern requiring MINIMAL position changes

4. 🎨 CUSTOMIZATION (for ADDED actions):
   - CUSTOMIZE text properties to match user intent (not generic defaults!)
   - Use the design system colors and spacing values
   - Position relative to what the user just did
   - Explain the broader pattern you're recognizing`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-2024-08-06',
      messages: [
        {
          role: 'system',
          content: 'You are an expert at understanding UI design patterns. You analyze what the user just added and suggest 1-3 COMPLETE components from their design system to build the pattern. You customize component properties (text, color) to match user intent. You NEVER use component fragments - only whole, functional components from the library.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'component_intent_response',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              overallIntent: { type: 'string' },
              actions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    componentType: { 
                      type: 'string',
                      enum: ['button', 'input', 'text', 'card', 'container', 'icon', 'image']
                    },
                    action: { 
                      type: 'string', 
                      enum: ['add', 'modify'] 
                    },
                    description: { type: 'string' },
                    targetId: { type: 'string' },
                    placement: {
                      type: 'object',
                      properties: {
                        relativeTo: { type: 'string' },
                        relationship: { 
                          type: 'string', 
                          enum: ['above', 'below', 'left', 'right', 'inside'] 
                        },
                        alignment: { 
                          type: 'string', 
                          enum: ['left', 'center', 'right', 'top', 'middle', 'bottom'] 
                        },
                        spacing: { type: 'number' }
                      },
                      required: ['relativeTo', 'relationship', 'alignment', 'spacing'],
                      additionalProperties: false
                    },
                    properties: {
                      type: 'object',
                      properties: {
                        text: { type: 'string' },
                        color: { type: 'string' }
                      },
                      required: ['text', 'color'],
                      additionalProperties: false
                    }
                  },
                  required: ['componentType', 'action', 'description', 'targetId', 'placement', 'properties'],
                  additionalProperties: false
                }
              }
            },
            required: ['overallIntent', 'actions'],
            additionalProperties: false
          }
        }
      },
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const error = await response.json() as any;
    throw new Error(`Component intent analysis failed: ${error.error?.message || 'Unknown error'}`);
  }

  const data = await response.json() as any;
  const content = data.choices[0]?.message?.content;
  
  if (!content) {
    throw new Error('No content in response');
  }

  const intentResponse = JSON.parse(content) as ComponentIntentResponse;
  
  console.log('=== COMPONENT INTENT EXTRACTED ===');
  console.log(`Overall Intent: ${intentResponse.overallIntent}`);
  console.log(`Actions: ${intentResponse.actions.length}`);
  console.log('');
  
  intentResponse.actions.forEach((intent, index) => {
    console.log(`--- Action ${index + 1} ---`);
    console.log(`Component Type: ${intent.componentType}`);
    console.log(`Action: ${intent.action}`);
    console.log(`Description: ${intent.description}`);
    console.log(`Target ID: ${intent.targetId || '(none)'}`);
    console.log(`Placement:`);
    console.log(`  - Relative To: ${intent.placement.relativeTo}`);
    console.log(`  - Relationship: ${intent.placement.relationship}`);
    console.log(`  - Alignment: ${intent.placement.alignment}`);
    console.log(`  - Spacing: ${intent.placement.spacing}`);
    console.log(`Properties:`);
    console.log(`  - Text: "${intent.properties.text}"`);
    console.log(`  - Color: ${intent.properties.color}`);
    console.log('');
  });
  
  console.log('==================================');
  
  return intentResponse;
}
