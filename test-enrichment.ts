#!/usr/bin/env bun

/**
 * Test enrichment function to verify it calculates correct xRange/yRange
 * from containerId + padding + size constraints
 */

import {
  type ActionAgentOutput,
  type DOMState,
  enrichConstraintsWithDOMValues,
} from './action-agent';

// Minimal DOM state for testing
const testDOMState: DOMState = {
  objects: [
    {
      id: 'obj-3',
      name: 'Content Area',
      type: 'FRAME',
      x: 0,
      y: 120,
      width: 800,
      height: 600,
    },
  ],
  viewport: { width: 1920, height: 1080 },
  selection: [],
};

// Test output with position constraint that has containerId + padding
const testOutput: ActionAgentOutput = {
  actions: [
    {
      id: 'action-1',
      type: 'create',
      description: 'Create an email input field inside the Content Area',
      constraints: [
        {
          id: 'constraint-1',
          type: 'position',
          description: 'Position inside container with padding',
          targetId: 'email-input',
          parameters: {
            type: 'position',
            containerId: 'obj-3',
            padding: {
              top: 16,
              right: 16,
              bottom: 16,
              left: 16,
            },
            // These should be recalculated by enrichment
            xRange: { min: 999, max: 999 },
            yRange: { min: 999, max: 999 },
          },
        },
        {
          id: 'constraint-2',
          type: 'size',
          description: 'Set size',
          targetId: 'email-input',
          parameters: {
            type: 'size',
            width: { operator: 'eq', value: 200 },
            height: { operator: 'eq', value: 40 },
          },
        },
      ],
    },
  ],
  metadata: {
    timestamp: Date.now(),
    model: 'test',
    intent: 'test',
  },
};

console.log('🧪 Testing Enrichment Function\n');
console.log('================================================================================\n');

console.log('📥 INPUT (before enrichment):');
console.log(JSON.stringify(testOutput.actions[0].constraints[0].parameters, null, 2));
console.log('');

console.log('Expected calculation:');
console.log('Container: obj-3 at (0, 120) with size 800x600');
console.log('Element size: 200x40');
console.log('Padding: 16 on all sides');
console.log('xRange: min = 0 + 16 = 16, max = 0 + 800 - 16 - 200 = 584');
console.log('yRange: min = 120 + 16 = 136, max = 120 + 600 - 16 - 40 = 664');
console.log('');

console.log('================================================================================\n');

console.log('⚙️  Running enrichment...\n');

const enrichedConstraints = enrichConstraintsWithDOMValues(
  testOutput.actions[0].constraints,
  testDOMState
);

console.log('================================================================================\n');

console.log('📤 OUTPUT (after enrichment):');
const enrichedConstraint = enrichedConstraints[0].parameters;
console.log(JSON.stringify(enrichedConstraint, null, 2));
console.log('');

console.log('================================================================================\n');

// Verify the calculation
const positionParams = enrichedConstraint as any;
const expectedXMin = 0 + 16; // containerX + paddingLeft
const expectedXMax = 0 + 800 - 16 - 200; // containerX + containerWidth - paddingRight - elementWidth
const expectedYMin = 120 + 16; // containerY + paddingTop
const expectedYMax = 120 + 600 - 16 - 40; // containerY + containerHeight - paddingBottom - elementHeight

const xMinCorrect = positionParams.xRange?.min === expectedXMin;
const xMaxCorrect = positionParams.xRange?.max === expectedXMax;
const yMinCorrect = positionParams.yRange?.min === expectedYMin;
const yMaxCorrect = positionParams.yRange?.max === expectedYMax;

console.log('✅ VERIFICATION:');
console.log(`xRange.min: ${positionParams.xRange?.min} === ${expectedXMin} ? ${xMinCorrect ? '✓' : '✗'}`);
console.log(`xRange.max: ${positionParams.xRange?.max} === ${expectedXMax} ? ${xMaxCorrect ? '✓' : '✗'}`);
console.log(`yRange.min: ${positionParams.yRange?.min} === ${expectedYMin} ? ${yMinCorrect ? '✓' : '✗'}`);
console.log(`yRange.max: ${positionParams.yRange?.max} === ${expectedYMax} ? ${yMaxCorrect ? '✓' : '✗'}`);
console.log('');

const allCorrect = xMinCorrect && xMaxCorrect && yMinCorrect && yMaxCorrect;

console.log('================================================================================\n');

if (allCorrect) {
  console.log('✨ All values calculated correctly! Test PASSED');
} else {
  console.log('❌ Some values incorrect! Test FAILED');
  throw new Error('Test failed');
}
