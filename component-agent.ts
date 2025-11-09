// ============================================================================
// COMPONENT AGENT
// Handles component-based layout generation with deterministic positioning
// ============================================================================

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Available component types from the context frame
 */
export type ComponentType = 
  | 'button'
  | 'input'
  | 'text'
  | 'label'
  | 'card'
  | 'container'
  | 'icon'
  | 'image';

/**
 * Component definition extracted from context frame
 */
export interface ComponentDefinition {
  /** Component ID in Figma */
  id: string;
  
  /** Component type/category */
  type: ComponentType;
  
  /** Display name */
  name: string;
  
  /** Default dimensions */
  defaultSize: {
    width: number;
    height: number;
  };
  
  /** Configurable properties */
  properties: {
    /** Can text be edited? */
    hasText: boolean;
    /** Default text value */
    defaultText: string;
    /** Can color be changed? */
    hasColor: boolean;
    /** Default color */
    defaultColor: string;
    /** Can icon be changed? */
    hasIcon: boolean;
  };
}

/**
 * Component library extracted from context frame
 */
export interface ComponentLibrary {
  components: ComponentDefinition[];
  /** Design system values */
  designSystem: {
    spacing: {
      xs: number;
      sm: number;
      md: number;
      lg: number;
      xl: number;
    };
    colors: {
      primary: string;
      secondary: string;
      text: string;
      background: string;
      [key: string]: string;
    };
  };
}

/**
 * Simplified intent focused on component usage
 */
export interface ComponentIntent {
  /** What component does the user want to add/modify */
  componentType: ComponentType;
  
  /** Action type */
  action: 'add' | 'modify';
  
  /** Natural language intent */
  description: string;
  
  /** Target element ID (for modify) - use empty string if not applicable */
  targetId: string;
  
  /** Spatial relationship to reference element */
  placement: {
    /** Reference element ID */
    relativeTo: string;
    /** Spatial relationship */
    relationship: 'above' | 'below' | 'left' | 'right' | 'inside';
    /** Alignment */
    alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
    /** Spacing value */
    spacing: number;
  };
  
  /** Property overrides */
  properties: {
    text: string;
    color: string;
  };
}

/**
 * Positioning specification
 */
export interface Position {
  /** X coordinate */
  x: number;
  
  /** Y coordinate */
  y: number;
  
  /** Calculated from spatial relationship and alignment */
  calculatedFrom: {
    referenceId?: string;
    relationship?: 'above' | 'below' | 'left' | 'right' | 'inside';
    alignment?: string;
    spacing?: number;
  };
}

/**
 * Single component instance to create/modify
 */
export interface ComponentInstance {
  /** Unique ID for this instance */
  id: string;
  
  /** Component type to instantiate */
  componentType: ComponentType;
  
  /** Source component ID from library */
  sourceComponentId: string;
  
  /** Action to perform */
  action: 'add' | 'modify';
  
  /** Target ID (for modify) */
  targetId?: string;
  
  /** Position in canvas */
  position: Position;
  
  /** Size (defaults from component definition) */
  size: {
    width: number;
    height: number;
  };
  
  /** Property values */
  properties: {
    /** Text content */
    text?: string;
    /** Fill color */
    color?: string;
    /** Opacity */
    opacity?: number;
    /** Other properties */
    [key: string]: any;
  };
}

/**
 * Component agent output - ready for direct execution
 */
export interface ComponentPlan {
  /** List of component instances to create/modify */
  instances: ComponentInstance[];
  
  /** Container frame to add components to */
  containerId: string;
  
  /** Metadata */
  metadata: {
    timestamp: number;
    intent: string;
  };
}

// ============================================================================
// COMPONENT LIBRARY EXTRACTION
// ============================================================================

/**
 * Extract component library from context frame
 */
export async function extractComponentLibrary(
  frameJSON: any,
  apiKey: string
): Promise<ComponentLibrary> {
  const prompt = `Analyze this design frame and extract reusable UI components.

FRAME STRUCTURE:
${JSON.stringify(frameJSON, null, 2)}

TASK:
1. Identify reusable UI components (buttons, inputs, text fields, labels, cards, containers, etc.)
2. Categorize each component by type
3. Extract default properties (size, color, text)
4. Extract design system values (spacing scale, color palette)

CRITICAL: For the "id" field, you MUST use the EXACT "id" value from the frameJSON for each component. 
Do NOT make up new IDs. Use the exact ID strings from the JSON structure above.

COMPONENT TYPES:
- button: Interactive button elements
- input: Text input fields, textareas
- text: Text/heading elements
- label: Small text labels
- card: Card/panel containers
- container: Frame/group containers
- icon: Icon elements
- image: Image placeholders

IMPORTANT - For each component properties:
- hasText: Set to true if component has editable text
- defaultText: Always provide a default text value (use empty string "" if no text)
- hasColor: Set to true if component has editable color/fill
- defaultColor: Always provide a default color (use "#000000" if no specific color)
- hasIcon: Set to true if component has an icon that can be changed, false otherwise

OUTPUT:
- components: List of all reusable components with their EXACT ID from frameJSON, type, name, default size, and properties
- designSystem: Spacing scale (xs, sm, md, lg, xl) and color palette (primary, secondary, text, background, etc.)`;

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
          content: 'You are an expert at analyzing UI designs and extracting reusable components and design systems.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'component_library',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              components: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    type: { 
                      type: 'string',
                      enum: ['button', 'input', 'text', 'label', 'card', 'container', 'icon', 'image']
                    },
                    name: { type: 'string' },
                    defaultSize: {
                      type: 'object',
                      properties: {
                        width: { type: 'number' },
                        height: { type: 'number' }
                      },
                      required: ['width', 'height'],
                      additionalProperties: false
                    },
                    properties: {
                      type: 'object',
                      properties: {
                        hasText: { type: 'boolean' },
                        defaultText: { 
                          type: 'string',
                          description: 'Default text value if hasText is true'
                        },
                        hasColor: { type: 'boolean' },
                        defaultColor: { 
                          type: 'string',
                          description: 'Default color value if hasColor is true'
                        },
                        hasIcon: { 
                          type: 'boolean',
                          description: 'Whether component has an icon that can be changed'
                        }
                      },
                      required: ['hasText', 'defaultText', 'hasColor', 'defaultColor', 'hasIcon'],
                      additionalProperties: false
                    }
                  },
                  required: ['id', 'type', 'name', 'defaultSize', 'properties'],
                  additionalProperties: false
                }
              },
              designSystem: {
                type: 'object',
                properties: {
                  spacing: {
                    type: 'object',
                    properties: {
                      xs: { type: 'number' },
                      sm: { type: 'number' },
                      md: { type: 'number' },
                      lg: { type: 'number' },
                      xl: { type: 'number' }
                    },
                    required: ['xs', 'sm', 'md', 'lg', 'xl'],
                    additionalProperties: false
                  },
                  colors: {
                    type: 'object',
                    properties: {
                      primary: { type: 'string' },
                      secondary: { type: 'string' },
                      text: { type: 'string' },
                      background: { type: 'string' }
                    },
                    required: ['primary', 'secondary', 'text', 'background'],
                    additionalProperties: false
                  }
                },
                required: ['spacing', 'colors'],
                additionalProperties: false
              }
            },
            required: ['components', 'designSystem'],
            additionalProperties: false
          }
        }
      },
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const error = await response.json() as any;
    throw new Error(`Component library extraction failed: ${error.error?.message || 'Unknown error'}`);
  }

  const data = await response.json() as any;
  const content = data.choices[0]?.message?.content;
  
  if (!content) {
    throw new Error('No content in response');
  }

  const library = JSON.parse(content) as ComponentLibrary;
  
  console.log('=== COMPONENT LIBRARY EXTRACTED ===');
  console.log(`Components found: ${library.components.length}`);
  library.components.forEach(c => {
    console.log(`  - ${c.type}: "${c.name}" (${c.defaultSize.width}x${c.defaultSize.height})`);
  });
  console.log(`Design System: ${Object.keys(library.designSystem.spacing).length} spacing values, ${Object.keys(library.designSystem.colors).length} colors`);
  console.log('===================================');
  
  return library;
}

// ============================================================================
// COMPONENT INTENT ANALYSIS
// ============================================================================

/**
 * Analyze user action and determine component intent
 */
export async function analyzeComponentIntent(
  userAction: any,
  componentLibrary: ComponentLibrary,
  canvasJSON: any,
  apiKey: string
): Promise<ComponentIntent> {
  const prompt = `The user performed an action on the canvas. Determine their intent in terms of component usage.

USER ACTION:
${JSON.stringify(userAction, null, 2)}

AVAILABLE COMPONENTS:
${JSON.stringify(componentLibrary.components.map(c => ({ 
  type: c.type, 
  name: c.name,
  id: c.id,
  defaultSize: c.defaultSize 
})), null, 2)}

CURRENT CANVAS STATE:
${JSON.stringify(canvasJSON, null, 2)}

DESIGN SYSTEM SPACING:
${JSON.stringify(componentLibrary.designSystem.spacing, null, 2)}

TASK:
Based on the user action, determine:
1. What component should be added/modified? (Pick from available components - use EXACT component type)
2. Where should it be positioned (relative to what element)?
3. What spatial relationship (above/below/left/right/inside)?
4. How should it be aligned (left/center/right for horizontal, top/middle/bottom for vertical)?
5. What spacing value from the design system? (REQUIRED - default to 'md' = ${componentLibrary.designSystem.spacing.md})
6. What properties should be set? (REQUIRED - always provide both text and color, use empty string "" if not applicable)

CRITICAL: 
- The componentType must EXACTLY match one of the available component types listed above
- We will use the component ID from the library based on the type you choose

REQUIRED FIELDS (always provide):
- targetId: Element ID if modifying, or empty string "" if adding new
- placement: Always provide relativeTo (element ID or name), relationship, alignment, and spacing
- properties: Always provide text and color (use "" for empty values)

IMPORTANT: 
- Always provide a spacing value (use ${componentLibrary.designSystem.spacing.md} as default)
- Always provide text and color in properties (use "" for empty text, "#000000" for default color)
- Always provide targetId (use "" if not modifying an existing element)
- For placement.relativeTo: Use element ID if available, otherwise use element name

SPATIAL RELATIONSHIPS:
- above: Position above the reference element
- below: Position below the reference element  
- left: Position to the left of the reference element
- right: Position to the right of the reference element
- inside: Position inside the reference element (as a child)

ALIGNMENT:
- For vertical stacking (above/below): left, center, or right alignment
- For horizontal placement (left/right): top, middle, or bottom alignment`;

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
          content: 'You are an expert at understanding user intent for UI layout and component placement.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'component_intent',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              componentType: { 
                type: 'string',
                enum: ['button', 'input', 'text', 'label', 'card', 'container', 'icon', 'image']
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

  const intent = JSON.parse(content) as ComponentIntent;
  
  console.log('=== COMPONENT INTENT ===');
  console.log(`Action: ${intent.action}`);
  console.log(`Component: ${intent.componentType}`);
  console.log(`Description: ${intent.description}`);
  if (intent.placement) {
    console.log(`Placement: ${intent.placement.relationship} ${intent.placement.relativeTo}, aligned ${intent.placement.alignment}`);
    console.log(`Spacing: ${intent.placement.spacing || 'default'}`);
  }
  if (intent.properties) {
    console.log(`Properties:`, intent.properties);
  }
  console.log('========================');
  
  return intent;
}

// ============================================================================
// COMPONENT PLAN GENERATION
// ============================================================================

/**
 * Generate component instances with deterministically calculated positions
 */
export async function generateComponentPlan(
  intent: ComponentIntent,
  componentLibrary: ComponentLibrary,
  canvasJSON: any,
  containerId: string
): Promise<ComponentPlan> {
  console.log('=== GENERATING COMPONENT PLAN ===');
  
  // Find matching component from library
  const component = componentLibrary.components.find(c => c.type === intent.componentType);
  
  if (!component) {
    throw new Error(`Component type "${intent.componentType}" not found in library`);
  }
  
  console.log(`Selected component: "${component.name}" (${component.type})`);
  
  // Calculate position deterministically
  let position: Position;
  
  if (intent.placement) {
    const { relativeTo, relationship, alignment, spacing } = intent.placement;
    const defaultSpacing = spacing || componentLibrary.designSystem.spacing.md;
    
    // Find reference element in canvas (by ID or name)
    const referenceElement = findElement(canvasJSON, relativeTo);
    
    if (!referenceElement) {
      throw new Error(`Reference element "${relativeTo}" not found in canvas`);
    }
    
    console.log(`Reference element: "${referenceElement.name}" (ID: ${referenceElement.id}) at (${referenceElement.x}, ${referenceElement.y}), size ${referenceElement.width}x${referenceElement.height}`);
    console.log(`Relationship: ${relationship}, Alignment: ${alignment}, Spacing: ${defaultSpacing}`);
    
    position = calculatePosition(
      component.defaultSize,
      referenceElement,
      relationship,
      alignment,
      defaultSpacing
    );
    
    console.log(`Calculated position: (${position.x}, ${position.y})`);
  } else {
    // Default to center of container
    position = {
      x: 100,
      y: 100,
      calculatedFrom: {}
    };
  }
  
  // Create component instance
  const instance: ComponentInstance = {
    id: `component-instance-${Date.now()}`,
    componentType: component.type,
    sourceComponentId: component.id,
    action: intent.action,
    targetId: intent.targetId,
    position,
    size: {
      width: component.defaultSize.width,
      height: component.defaultSize.height
    },
    properties: {
      text: intent.properties.text || component.properties.defaultText || '',
      color: intent.properties.color || component.properties.defaultColor || '',
      opacity: 1.0
    }
  };
  
  const plan: ComponentPlan = {
    instances: [instance],
    containerId,
    metadata: {
      timestamp: Date.now(),
      intent: intent.description
    }
  };
  
  console.log('=== COMPONENT PLAN GENERATED ===');
  console.log(`Instances: ${plan.instances.length}`);
  console.log(`Container: ${containerId}`);
  console.log('================================');
  
  return plan;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Find element by ID in JSON tree
 */
function findElementById(json: any, id: string): any {
  if (json.id === id) {
    return json;
  }
  
  if (json.children && Array.isArray(json.children)) {
    for (const child of json.children) {
      const found = findElementById(child, id);
      if (found) return found;
    }
  }
  
  return null;
}

/**
 * Find element by name in JSON tree (fallback if ID not found)
 */
function findElementByName(json: any, name: string): any {
  if (json.name === name) {
    return json;
  }
  
  if (json.children && Array.isArray(json.children)) {
    for (const child of json.children) {
      const found = findElementByName(child, name);
      if (found) return found;
    }
  }
  
  return null;
}

/**
 * Find element by ID or name (tries ID first, then name as fallback)
 */
function findElement(json: any, idOrName: string): any {
  // Try by ID first
  let element = findElementById(json, idOrName);
  
  // If not found, try by name
  if (!element) {
    element = findElementByName(json, idOrName);
  }
  
  return element;
}

/**
 * Calculate position based on spatial relationship and alignment
 * 
 * IMPORTANT: In Figma, positions are measured from the TOP-LEFT CORNER of each element.
 * All calculations below use this coordinate system:
 * - element.x = left edge position
 * - element.y = top edge position
 * - element.x + element.width = right edge position
 * - element.y + element.height = bottom edge position
 */
function calculatePosition(
  componentSize: { width: number; height: number },
  reference: any,
  relationship: 'above' | 'below' | 'left' | 'right' | 'inside',
  alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom',
  spacing: number
): Position {
  let x = 0;
  let y = 0;
  
  // Calculate base position from relationship
  // All positions are TOP-LEFT corner coordinates
  switch (relationship) {
    case 'above':
      // Position ABOVE: new element's bottom edge + spacing should touch reference's top edge
      // reference.y is the TOP of reference, so new element's TOP = reference.y - height - spacing
      y = reference.y - componentSize.height - spacing;
      // Horizontal alignment
      x = calculateHorizontalAlignment(reference, componentSize.width, alignment as 'left' | 'center' | 'right');
      break;
      
    case 'below':
      // Position BELOW: new element's top edge should be spacing below reference's bottom edge
      // reference.y + reference.height is the BOTTOM of reference
      y = reference.y + reference.height + spacing;
      // Horizontal alignment
      x = calculateHorizontalAlignment(reference, componentSize.width, alignment as 'left' | 'center' | 'right');
      break;
      
    case 'left':
      // Position LEFT: new element's right edge + spacing should touch reference's left edge
      // reference.x is the LEFT of reference, so new element's LEFT = reference.x - width - spacing
      x = reference.x - componentSize.width - spacing;
      // Vertical alignment
      y = calculateVerticalAlignment(reference, componentSize.height, alignment as 'top' | 'middle' | 'bottom');
      break;
      
    case 'right':
      // Position RIGHT: new element's left edge should be spacing right of reference's right edge
      // reference.x + reference.width is the RIGHT of reference
      x = reference.x + reference.width + spacing;
      // Vertical alignment
      y = calculateVerticalAlignment(reference, componentSize.height, alignment as 'top' | 'middle' | 'bottom');
      break;
      
    case 'inside':
      // Position inside with padding (top-left corner + spacing)
      x = reference.x + spacing;
      y = reference.y + spacing;
      break;
  }
  
  return {
    x: Math.round(x),
    y: Math.round(y),
    calculatedFrom: {
      referenceId: reference.id,
      relationship,
      alignment,
      spacing
    }
  };
}

/**
 * Calculate horizontal alignment (left/center/right)
 * Positions are TOP-LEFT corner based:
 * - left: align left edges (x values match)
 * - center: center the component horizontally within reference width
 * - right: align right edges (x + width values match)
 */
function calculateHorizontalAlignment(
  reference: any,
  componentWidth: number,
  alignment: 'left' | 'center' | 'right'
): number {
  switch (alignment) {
    case 'left':
      // Align left edges: component.x = reference.x
      return reference.x;
    case 'center':
      // Center horizontally: component.x = reference.x + (reference.width - component.width) / 2
      return reference.x + (reference.width - componentWidth) / 2;
    case 'right':
      // Align right edges: component.x + component.width = reference.x + reference.width
      // So: component.x = reference.x + reference.width - component.width
      return reference.x + reference.width - componentWidth;
    default:
      return reference.x;
  }
}

/**
 * Calculate vertical alignment (top/middle/bottom)
 * Positions are TOP-LEFT corner based:
 * - top: align top edges (y values match)
 * - middle: center the component vertically within reference height
 * - bottom: align bottom edges (y + height values match)
 */
function calculateVerticalAlignment(
  reference: any,
  componentHeight: number,
  alignment: 'top' | 'middle' | 'bottom'
): number {
  switch (alignment) {
    case 'top':
      // Align top edges: component.y = reference.y
      return reference.y;
    case 'middle':
      // Center vertically: component.y = reference.y + (reference.height - component.height) / 2
      return reference.y + (reference.height - componentHeight) / 2;
    case 'bottom':
      // Align bottom edges: component.y + component.height = reference.y + reference.height
      // So: component.y = reference.y + reference.height - component.height
      return reference.y + reference.height - componentHeight;
    default:
      return reference.y;
  }
}
