// ============================================================================
// COMPONENT EXECUTION
// Executes component plans directly using Figma API
// ============================================================================

import type { ComponentPlan, ComponentInstance } from './component-agent';

/**
 * Execution result
 */
export interface ComponentExecutionResult {
  success: boolean;
  created: number;
  modified: number;
  errors: string[];
  createdNodeIds: string[]; // Track actual Figma node IDs of created components
}

/**
 * Execute component plan directly using Figma API
 */
export async function executeComponentPlan(plan: ComponentPlan): Promise<ComponentExecutionResult> {
  console.log('=== EXECUTING COMPONENT PLAN ===');
  console.log(`Container: ${plan.containerId}`);
  console.log(`Instances to process: ${plan.instances.length}`);
  
  const result: ComponentExecutionResult = {
    success: true,
    created: 0,
    modified: 0,
    errors: [],
    createdNodeIds: []
  };
  
  try {
    // Get container frame
    const container = await figma.getNodeByIdAsync(plan.containerId) as FrameNode | null;
    
    if (!container) {
      throw new Error(`Container frame not found: ${plan.containerId}`);
    }
    
    console.log(`Container frame found: "${container.name}"`);
    
    for (const instance of plan.instances) {
      try {
        if (instance.action === 'add') {
          const createdNodeId = await createComponentInstance(instance, container);
          result.createdNodeIds.push(createdNodeId);
          result.created++;
          console.log(`✅ Created: ${instance.componentType} (ID: ${createdNodeId})`);
        } else if (instance.action === 'modify') {
          await modifyComponentInstance(instance);
          result.modified++;
          console.log(`✅ Modified: ${instance.targetId}`);
        }
      } catch (error) {
        const errorMsg = `Failed to ${instance.action} ${instance.componentType}: ${error}`;
        console.error(`❌ ${errorMsg}`);
        result.errors.push(errorMsg);
        result.success = false;
      }
    }
    
  } catch (error) {
    const errorMsg = `Execution failed: ${error}`;
    console.error(`❌ ${errorMsg}`);
    result.errors.push(errorMsg);
    result.success = false;
  }
  
  console.log('=== EXECUTION COMPLETE ===');
  console.log(`Created: ${result.created}, Modified: ${result.modified}, Errors: ${result.errors.length}`);
  console.log('==========================');
  
  return result;
}

/**
 * Create a new component instance
 */
async function createComponentInstance(
  instance: ComponentInstance,
  container: FrameNode
): Promise<string> {
  console.log(`Creating ${instance.componentType} at (${instance.position.x}, ${instance.position.y})`);
  
  // Get source component/element
  const sourceNode = await figma.getNodeByIdAsync(instance.sourceComponentId);
  
  if (!sourceNode) {
    throw new Error(`Source component not found: ${instance.sourceComponentId}`);
  }
  
  let newNode: SceneNode;
  
  // Check if it's a component (can be instantiated) or a regular node (needs to be cloned)
  if (sourceNode.type === 'COMPONENT') {
    // Create component instance
    newNode = (sourceNode as ComponentNode).createInstance();
    console.log(`  Created instance of component "${sourceNode.name}"`);
  } else {
    // Clone the node
    newNode = (sourceNode as SceneNode).clone();
    console.log(`  Cloned node "${sourceNode.name}"`);
  }
  
  // Set position
  newNode.x = instance.position.x;
  newNode.y = instance.position.y;
  
  // Set size if resizable
  if ('resize' in newNode) {
    try {
      newNode.resize(instance.size.width, instance.size.height);
      console.log(`  Resized to ${instance.size.width}x${instance.size.height}`);
    } catch (e) {
      console.warn(`  Could not resize: ${e}`);
    }
  }
  
  // Set text property if available
  if (instance.properties.text) {
    await setTextProperty(newNode, instance.properties.text);
  }
  
  // Set color property if available
  if (instance.properties.color) {
    setColorProperty(newNode, instance.properties.color);
  }
  
  // Set opacity
  if (instance.properties.opacity !== undefined && 'opacity' in newNode) {
    newNode.opacity = instance.properties.opacity;
  }
  
  // Add to container
  container.appendChild(newNode);
  console.log(`  Added to container "${container.name}"`);
  
  // Return the actual Figma node ID
  return newNode.id;
}

/**
 * Modify an existing component instance
 */
async function modifyComponentInstance(instance: ComponentInstance): Promise<void> {
  console.log(`Modifying ${instance.targetId}`);
  
  const targetNode = await figma.getNodeByIdAsync(instance.targetId!) as SceneNode;
  
  if (!targetNode) {
    throw new Error(`Target node not found: ${instance.targetId}`);
  }
  
  // Update position
  if ('x' in targetNode) {
    targetNode.x = instance.position.x;
    targetNode.y = instance.position.y;
    console.log(`  Moved to (${instance.position.x}, ${instance.position.y})`);
  }
  
  // Update size if resizable
  if ('resize' in targetNode) {
    try {
      targetNode.resize(instance.size.width, instance.size.height);
      console.log(`  Resized to ${instance.size.width}x${instance.size.height}`);
    } catch (e) {
      console.warn(`  Could not resize: ${e}`);
    }
  }
  
  // Update text property if available
  if (instance.properties.text) {
    await setTextProperty(targetNode, instance.properties.text);
  }
  
  // Update color property if available
  if (instance.properties.color) {
    setColorProperty(targetNode, instance.properties.color);
  }
  
  // Update opacity
  if (instance.properties.opacity !== undefined && 'opacity' in targetNode) {
    targetNode.opacity = instance.properties.opacity;
  }
}

/**
 * Set text property on a node or its children
 * For nested components, intelligently updates text based on context
 */
async function setTextProperty(node: SceneNode, text: string): Promise<void> {
  // If node itself is text
  if (node.type === 'TEXT') {
    const textNode = node as TextNode;
    try {
      await figma.loadFontAsync(textNode.fontName as FontName);
      textNode.characters = text;
      console.log(`  Set text: "${text}"`);
    } catch (e) {
      console.warn(`  Could not set text: ${e}`);
    }
    return;
  }
  
  // For nested components, find ALL text nodes and update them contextually
  if ('children' in node) {
    const textNodes = node.findAll(n => n.type === 'TEXT') as TextNode[];
    
    if (textNodes.length === 0) {
      return;
    }
    
    // If there's only one text node, update it directly
    if (textNodes.length === 1) {
      try {
        await figma.loadFontAsync(textNodes[0].fontName as FontName);
        textNodes[0].characters = text;
        console.log(`  Set text on child: "${text}"`);
      } catch (e) {
        console.warn(`  Could not set text on child: ${e}`);
      }
      return;
    }
    
    // For multiple text nodes (e.g., label + input), update intelligently
    console.log(`  Found ${textNodes.length} text elements in nested component`);
    
    // Sort text nodes by vertical position (top to bottom)
    const sortedNodes = textNodes.sort((a, b) => a.y - b.y);
    
    // Heuristic: Update based on node characteristics
    for (const textNode of sortedNodes) {
      try {
        await figma.loadFontAsync(textNode.fontName as FontName);
        
        // Determine which text node to update based on size, position, and name
        const nodeName = textNode.name.toLowerCase();
        const fontSize = textNode.fontSize !== figma.mixed ? textNode.fontSize : 12;
        
        // Label detection: smaller font, positioned above, or has "label" in name
        const isLabel = nodeName.includes('label') || 
                       nodeName.includes('title') ||
                       fontSize < 14 ||
                       textNode.y < node.height * 0.3;
        
        // Input/placeholder detection: larger font, centered/below, or has "input"/"placeholder" in name  
        const isInput = nodeName.includes('input') || 
                       nodeName.includes('placeholder') ||
                       nodeName.includes('field') ||
                       fontSize >= 14;
        
        if (isLabel) {
          // For labels, use the text as-is (e.g., "Email", "Password")
          textNode.characters = text;
          console.log(`  Set label text: "${text}"`);
        } else if (isInput && text) {
          // For input fields, create a contextual placeholder
          // e.g., "Email" -> "Enter your email"
          const placeholder = text.toLowerCase().includes('email') ? 'Enter your email' :
                            text.toLowerCase().includes('password') ? 'Enter your password' :
                            text.toLowerCase().includes('name') ? 'Enter your name' :
                            text.toLowerCase().includes('phone') ? 'Enter your phone number' :
                            `Enter ${text.toLowerCase()}`;
          textNode.characters = placeholder;
          console.log(`  Set input placeholder: "${placeholder}"`);
        } else {
          // Default: use the text directly
          textNode.characters = text;
          console.log(`  Set text: "${text}"`);
        }
      } catch (e) {
        console.warn(`  Could not set text on element "${textNode.name}": ${e}`);
      }
    }
  }
}

/**
 * Set color property on a node
 */
function setColorProperty(node: SceneNode, color: string): void {
  // Parse color (hex or named color)
  const rgb = parseColor(color);
  
  if (!rgb) {
    console.warn(`  Could not parse color: ${color}`);
    return;
  }
  
  // Set fill if node supports it
  if ('fills' in node && node.fills !== figma.mixed) {
    try {
      node.fills = [{ type: 'SOLID', color: rgb }];
      console.log(`  Set color: ${color}`);
    } catch (e) {
      console.warn(`  Could not set fill: ${e}`);
    }
    return;
  }
  
  // Try to set on child with fills
  if ('children' in node) {
    const fillNode = node.findOne(n => 'fills' in n);
    if (fillNode && 'fills' in fillNode && fillNode.fills !== figma.mixed) {
      try {
        fillNode.fills = [{ type: 'SOLID', color: rgb }];
        console.log(`  Set color on child: ${color}`);
      } catch (e) {
        console.warn(`  Could not set fill on child: ${e}`);
      }
    }
  }
}

/**
 * Parse color string to RGB
 */
function parseColor(color: string): RGB | null {
  // Handle hex colors
  if (color.startsWith('#')) {
    const hex = color.substring(1);
    if (hex.length === 6) {
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;
      return { r, g, b };
    }
  }
  
  // Handle named colors (basic set)
  const namedColors: Record<string, RGB> = {
    'black': { r: 0, g: 0, b: 0 },
    'white': { r: 1, g: 1, b: 1 },
    'red': { r: 1, g: 0, b: 0 },
    'green': { r: 0, g: 1, b: 0 },
    'blue': { r: 0, g: 0, b: 1 },
    'yellow': { r: 1, g: 1, b: 0 },
    'gray': { r: 0.5, g: 0.5, b: 0.5 },
    'grey': { r: 0.5, g: 0.5, b: 0.5 },
  };
  
  return namedColors[color.toLowerCase()] || null;
}
