// ============================================================================
// COMPONENT PLAN AGENT
// Generates component execution plans with deterministic positioning
// ============================================================================

import { 
  ComponentIntent, 
  ComponentLibrary, 
  ComponentPlan, 
  ComponentInstance, 
  Position 
} from './component-types';

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
