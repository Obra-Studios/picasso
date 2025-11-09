// ============================================================================
// COMPONENT TYPE DEFINITIONS
// Shared types for component-based architecture
// ============================================================================

/**
 * Available component types from the context frame
 */
export type ComponentType = 
  | 'button'
  | 'input'
  | 'text'
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
 * Component action from AI intent analysis
 */
export interface ComponentIntent {
  /** Component type to add or modify */
  componentType: ComponentType;
  
  /** Action type: 'add' for new components, 'modify' for existing elements */
  action: 'add' | 'modify';
  
  /** Description of this specific action */
  description: string;
  
  /** Target element ID (for modify action, empty for add) */
  targetId: string;
  
  /** Spatial relationship to reference element */
  placement: {
    /** Reference element ID or name */
    relativeTo: string;
    /** Spatial relationship */
    relationship: 'above' | 'below' | 'left' | 'right' | 'inside';
    /** Alignment */
    alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
    /** Spacing value */
    spacing: number;
  };
  
  /** Property overrides - customize text/labels to match user intent */
  properties: {
    /** Text content - override default text with contextual value (e.g., "Email", "Submit", "Login") */
    text: string;
    /** Color value - use design system colors */
    color: string;
  };
}

/**
 * Multi-action component intent response
 * Supports adding multiple components in one response
 */
export interface ComponentIntentResponse {
  /** Array of component actions to perform */
  actions: ComponentIntent[];
  
  /** Overall description of what's being built */
  overallIntent: string;
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
