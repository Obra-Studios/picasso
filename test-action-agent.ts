// ============================================================================
// ACTION AGENT TEST
// Test the action agent with dummy data
// ============================================================================

import { generateActions, type Context, type DOMState, type Intent } from './action-agent';

// ============================================================================
// DUMMY DATA
// ============================================================================

const dummyContext: Context = {
  colors: {
    primary: '#3B82F6',
    secondary: '#8B5CF6',
    accent: '#10B981',
    background: '#FFFFFF',
    text: '#1F2937',
    gray: '#6B7280',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  typography: {
    fontSize: {
      xs: 12,
      sm: 14,
      md: 16,
      lg: 20,
      xl: 24,
    },
    fontFamily: {
      primary: 'Inter',
      secondary: 'Roboto',
    },
  },
};

const dummyDOMState: DOMState = {
  objects: [
    {
      id: 'obj-1',
      name: 'Header Container',
      type: 'FRAME',
      x: 0,
      y: 0,
      width: 800,
      height: 100,
    },
    {
      id: 'obj-2',
      name: 'Logo',
      type: 'RECTANGLE',
      x: 16,
      y: 16,
      width: 68,
      height: 68,
      parentId: 'obj-1',
    },
    {
      id: 'obj-3',
      name: 'Content Area',
      type: 'FRAME',
      x: 0,
      y: 120,
      width: 800,
      height: 600,
    },
    {
      id: 'obj-4',
      name: 'Button',
      type: 'RECTANGLE',
      x: 300,
      y: 300,
      width: 120,
      height: 40,
    },
    {
      id: 'obj-5',
      name: 'Sidebar',
      type: 'FRAME',
      x: 820,
      y: 120,
      width: 300,
      height: 600,
    },
    {
      id: 'obj-6',
      name: 'Existing Card',
      type: 'RECTANGLE',
      x: 24,
      y: 140,
      width: 200,
      height: 100,
      parentId: 'obj-3',
    },
    {
      id: 'obj-7',
      name: 'Small Box',
      type: 'RECTANGLE',
      x: 240,
      y: 160,
      width: 48,
      height: 48,
      parentId: 'obj-3',
    },
  ],
  viewport: {
    width: 1920,
    height: 1080,
  },
  selection: [],
};

// High-level intent - user wants to create a login form in the content area
// The action agent should break this down into concrete actions with constraints
const dummyIntent: Intent = 
  'Create a login form in the Content Area with an email input field and a login button below it, properly spaced and aligned';

// ============================================================================
// TEST FUNCTION
// ============================================================================

async function testActionAgent() {
  console.log('🧪 Testing Action Agent\n');
  console.log('=' .repeat(80));
  
  console.log('\n📥 INPUT:');
  console.log('\nContext:', JSON.stringify(dummyContext, null, 2));
  console.log('\nDOM State:', JSON.stringify(dummyDOMState, null, 2));
  console.log('\nIntent:', dummyIntent);
  
  console.log('\n' + '='.repeat(80));
  console.log('\n⚙️  Generating actions...\n');
  
  try {
    // API key will be automatically loaded from .env file by Bun
    // No need to pass it explicitly unless you want to override
    
    const result = await generateActions(
      dummyContext,
      dummyDOMState,
      dummyIntent
    );
    
    console.log('✅ Action generation successful!\n');
    console.log('=' .repeat(80));
    
    console.log('\n📤 OUTPUT:\n');
    
    console.log('Actions:', JSON.stringify(result.actions, null, 2));
    console.log('\nMetadata:', JSON.stringify(result.metadata, null, 2));
    
    console.log('\n' + '='.repeat(80));
    console.log('\n📊 SUMMARY:');
    console.log(`- Generated ${result.actions.length} action(s)`);
    
    // Count total constraints across all actions
    const totalConstraints = result.actions.reduce(
      (sum, action) => sum + (action.constraints?.length || 0),
      0
    );
    console.log(`- Generated ${totalConstraints} constraint(s) total`);
    console.log(`- Model: ${result.metadata.model}`);
    console.log(`- Timestamp: ${new Date(result.metadata.timestamp).toISOString()}`);
    
    // Display actions in detail
    if (result.actions.length > 0) {
      console.log('\n📋 ACTION DETAILS:');
      result.actions.forEach((action, index) => {
        console.log(`\n${index + 1}. ${action.type.toUpperCase()}`);
        console.log(`   ID: ${action.id}`);
        console.log(`   Description: ${action.description}`);
        if (action.targetId) {
          console.log(`   Target: ${action.targetId}`);
        }
        
        // Display constraints for this action
        if (action.constraints && action.constraints.length > 0) {
          console.log(`   Constraints (${action.constraints.length}):`);
          action.constraints.forEach((constraint, cIndex) => {
            console.log(`     ${cIndex + 1}. ${constraint.type.toUpperCase()}`);
            console.log(`        ID: ${constraint.id}`);
            console.log(`        Description: ${constraint.description}`);
            console.log(`        Target: ${constraint.targetId}`);
            console.log(`        Parameters:`, JSON.stringify(constraint.parameters, null, 2));
          });
        }
      });
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('\n✨ Test completed successfully!\n');
    
  } catch (error) {
    console.error('\n❌ Error during action generation:');
    console.error(error);
  }
}

// ============================================================================
// RUN TEST
// ============================================================================

testActionAgent();
