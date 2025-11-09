// ============================================================================
// COMPONENT LIBRARY AGENT
// Extracts reusable components and design system from context frame
// ============================================================================

import { ComponentLibrary, ComponentDefinition } from './component-types';

/**
 * Extract component library from context frame
 */
export async function extractComponentLibrary(
  frameJSON: any,
  apiKey: string,
  basePrompt?: string
): Promise<ComponentLibrary> {
  const basePromptSection = basePrompt 
    ? `\n=== BASE PROMPT / USER INSTRUCTIONS ===\n${basePrompt}\n\nConsider these instructions when analyzing the design system and components.\n` 
    : '';

  const prompt = `Analyze this design frame and extract reusable UI components.
${basePromptSection}
FRAME STRUCTURE:
${JSON.stringify(frameJSON, null, 2)}

TASK:
1. Identify reusable UI components (buttons, inputs, text fields, labels, cards, containers, etc.)
2. Categorize each component by type
3. Extract default properties (size, color, text)
4. Extract design system values (spacing scale, color palette)

CRITICAL: For the "id" field, you MUST use the EXACT "id" value from the frameJSON for each component. 
Do NOT make up new IDs like "button-1" or "input". Use the exact ID strings from the JSON structure above.

EXAMPLE:
If the frameJSON contains:
{
  "id": "123:456",
  "name": "Primary Button",
  "type": "COMPONENT"
}

Then you MUST use "123:456" as the id, NOT "button" or "primary-button".

COMPONENT TYPES:
- button: Interactive button elements
- input: Text input fields, textareas
- text: Text/heading elements
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
      model: 'gpt-4o-mini', // Using mini for lower cost and rate limits
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
  
  // Validate that components have proper Figma node IDs (contain ":" like "123:456")
  const invalidComponents = library.components.filter(c => !c.id.includes(':'));
  if (invalidComponents.length > 0) {
    console.warn('⚠️ WARNING: Some components have invalid IDs (not Figma node IDs):');
    invalidComponents.forEach(c => {
      console.warn(`  - ${c.type} "${c.name}": ID = "${c.id}" (should be like "123:456")`);
    });
    console.warn('This will cause "Source component not found" errors!');
    console.warn('Make sure your context frame contains elements with valid Figma IDs.');
  }
  
  console.log('=== COMPONENT LIBRARY EXTRACTED ===');
  console.log(`Components found: ${library.components.length}`);
  library.components.forEach((c: ComponentDefinition) => {
    console.log(`  - ${c.type}: "${c.name}" (ID: ${c.id}, ${c.defaultSize.width}x${c.defaultSize.height})`);
  });
  console.log(`Design System: ${Object.keys(library.designSystem.spacing).length} spacing values, ${Object.keys(library.designSystem.colors).length} colors`);
  console.log('===================================');
  
  return library;
}
