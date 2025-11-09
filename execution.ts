// ============================================================================
// EXECUTION AGENT
// Shared interfaces and types used by operations.ts and execute.ts
// ============================================================================

// ============================================================================
// INTERFACES
// ============================================================================

export interface ExecutionOperation {
    action: 'add' | 'modify';
    type?: 'circle' | 'rectangle' | 'ellipse' | 'frame' | 'text' | 'line' | 'polygon' | 'star' | 'vector' | 'arrow';
    name?: string;
    x?: number; // Top-left x coordinate
    y?: number; // Top-left y coordinate
    width?: number;
    height?: number;
    radius?: number; // For circles
    fills?: Array<{
        type: 'SOLID';
        color: { r: number; g: number; b: number };
        opacity?: number;
    }>;
    strokes?: Array<{
        type: 'SOLID';
        color: { r: number; g: number; b: number };
        opacity?: number;
    }>;
    strokeWeight?: number;
    container?: string; // Name or ID of parent container
    targetId?: string; // For MODIFY operations - ID of object to modify
    targetDescription?: string; // Alternative for MODIFY - description to identify shape
    cornerRadius?: number; // For rectangles
    pointCount?: number; // For polygon/star
    innerRadius?: number; // For star
    vectorPaths?: Array<{
        windingRule?: 'NONZERO' | 'EVENODD';
        data: string;
    }>; // For vector shapes - matches Figma API
    rotation?: number;
    opacity?: number;
    // Text-specific properties
    textContent?: string; // The actual text content to display
    fontSize?: number; // Font size in pixels
    textAlign?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'; // Text alignment
    textBoxId?: string; // ID or name of the text box container to overlay text into
    textBoxDescription?: string; // Alternative description to identify text box
    padding?: {
        top?: number;
        right?: number;
        bottom?: number;
        left?: number;
    }; // Padding inside text box for text positioning
    fontFamily?: string; // Font family (e.g., "Inter", "Roboto")
    fontWeight?: number; // Font weight (e.g., 400, 500, 600, 700)
}

export interface ExecutionPlan {
    operations: ExecutionOperation[];
    summary?: string;
}

export interface PositionConstraint {
    id: string;
    type: 'position';
    description: string;
    targetId: string;
    parameters: {
        containerId?: string;
        padding?: {
            top?: number;
            right?: number;
            bottom?: number;
            left?: number;
        };
        xRange?: {
            min?: number;
            max?: number;
        };
        yRange?: {
            min?: number;
            max?: number;
        };
    };
}

export interface SizeConstraint {
    id: string;
    type: 'size';
    description: string;
    targetId: string;
    parameters: {
        width?: {
            operator: 'eq' | 'min' | 'max' | 'range';
            value?: number;
            min?: number;
            max?: number;
        };
        height?: {
            operator: 'eq' | 'min' | 'max' | 'range';
            value?: number;
            min?: number;
            max?: number;
        };
    };
}

export interface SpacingConstraint {
    id: string;
    type: 'spacing';
    description: string;
    targetId: string;
    parameters: {
        referenceId: string;
        direction: 'horizontal' | 'vertical';
        distance: {
            operator: 'eq' | 'min' | 'max';
            value: number;
        };
    };
}

export interface ColorConstraint {
    id: string;
    type: 'color';
    description: string;
    targetId: string;
    parameters: {
        property: 'fill' | 'stroke';
        value: string | { r: number; g: number; b: number; a?: number };
    };
}

export type Constraint = PositionConstraint | SizeConstraint | SpacingConstraint | ColorConstraint;

export interface Action {
    id: string;
    type: 'create' | 'modify';
    description: string;
    constraints: Constraint[];
}

export interface ConstraintBasedPlan {
    actions: Action[];
    metadata?: {
        timestamp?: number;
        model?: string;
        intent?: string;
    };
}

export interface APICallInfo {
    request: {
        url: string;
        method: string;
        headers: Record<string, string>;
        body: any;
    };
    response: {
        status: number;
        statusText: string;
        body: any;
    };
    timestamp: number;
}

// ============================================================================
// RE-EXPORTS
// Re-export functions from operations.ts and execute.ts for backward compatibility
// ============================================================================

export * from './operations';
export * from './execute';
