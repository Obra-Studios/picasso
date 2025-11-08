// Simple plugin: when you move one block, ask the (simulated) LLM for a
// suggested move of the nearest other block and let the user apply it.

figma.showUI(__html__, { width: 380, height: 260 });

// Track last known positions for nodes we care about
const lastPositions = new Map<string, { x: number; y: number }>();

// Helper: update map entries for current selection (seed positions)
function seedSelectionPositions() {
  for (const node of figma.currentPage.selection) {
    if (typeof node.x === 'number' && typeof node.y === 'number') {
      lastPositions.set(node.id, { x: node.x, y: node.y });
    }
  }
}

seedSelectionPositions();

// Polling loop to detect movement while the UI is open.
// Plugins can keep running while UI is open, so this is fine for a simple demo.
const POLL_MS = 250;
setInterval(() => {
  const selection = figma.currentPage.selection;

  if (selection.length !== 1) {
    // clear UI state when not a single selected node
    figma.ui.postMessage({ type: 'idle' });
    // refresh stored positions for selection
    seedSelectionPositions();
    return;
  }

  const moved = selection[0];
  if (typeof moved.x !== 'number' || typeof moved.y !== 'number') {
    return;
  }

  const last = lastPositions.get(moved.id) || { x: moved.x, y: moved.y };
  const dx = moved.x - last.x;
  const dy = moved.y - last.y;

  // small threshold to avoid noise
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
    // update stored position and do nothing
    lastPositions.set(moved.id, { x: moved.x, y: moved.y });
    return;
  }

  // Find nearest other node on the current page (simple heuristic)
  let nearest: SceneNode | null = null;
  let bestDist = Infinity;
  const movedCenterX = (moved.x ?? 0) + ((moved as any).width ?? 0) / 2;
  const movedCenterY = (moved.y ?? 0) + ((moved as any).height ?? 0) / 2;

  for (const node of figma.currentPage.children) {
    if (node.id === moved.id) continue;
    if (typeof node.x !== 'number' || typeof node.y !== 'number') continue;
    // ignore locked or hidden nodes
    if ((node as any).locked) continue;
    const nx = node.x + ((node as any).width ?? 0) / 2;
    const ny = node.y + ((node as any).height ?? 0) / 2;
    const dist = Math.hypot(nx - movedCenterX, ny - movedCenterY);
    if (dist < bestDist) {
      bestDist = dist;
      nearest = node;
    }
  }

  if (!nearest) {
    lastPositions.set(moved.id, { x: moved.x, y: moved.y });
    return;
  }

  const suggestedX = nearest.x + dx;
  const suggestedY = nearest.y + dy;

  // Send suggestion to UI (this simulates prompting an LLM and receiving a result)
  figma.ui.postMessage({
    type: 'suggest-move',
    moved: { id: moved.id, name: moved.name, x: moved.x, y: moved.y },
    target: { id: nearest.id, name: nearest.name, x: nearest.x, y: nearest.y },
    suggested: { x: suggestedX, y: suggestedY },
    delta: { dx, dy },
  });

  // update stored position for moved node so we detect subsequent moves
  lastPositions.set(moved.id, { x: moved.x, y: moved.y });
}, POLL_MS);

// Unified handler: incoming messages from the UI (apply, create sample, and
// storage-related messages are all handled here).
figma.ui.onmessage = async (msg: any) => {
  // Apply suggested move
  if (msg.type === 'apply-move') {
    const id: string = msg.id;
    const x: number = msg.x;
    const y: number = msg.y;

    const node = figma.getNodeById(id) as SceneNode & { x?: number; y?: number } | null;
    if (!node) {
      figma.ui.postMessage({ type: 'error', message: 'Target node not found' });
      return;
    }

    if (typeof node.x === 'number') node.x = x;
    if (typeof node.y === 'number') node.y = y;

    lastPositions.set(node.id, { x: x, y: y });
    figma.ui.postMessage({ type: 'applied', id: node.id, x, y });
    return;
  }

  // Create sample blocks
  if (msg.type === 'create-sample') {
    const a = figma.createRectangle();
    a.resize(120, 80);
    a.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }];
    a.x = 100;
    a.y = 120;
    a.name = 'Block A';
    figma.currentPage.appendChild(a);

    const b = figma.createRectangle();
    b.resize(120, 80);
    b.fills = [{ type: 'SOLID', color: { r: 0.6, g: 0.8, b: 1 } }];
    b.x = 360;
    b.y = 120;
    b.name = 'Block B';
    figma.currentPage.appendChild(b);

    figma.currentPage.selection = [a];
    figma.viewport.scrollAndZoomIntoView([a, b]);

    lastPositions.set(a.id, { x: a.x, y: a.y });
    lastPositions.set(b.id, { x: b.x, y: b.y });

    figma.ui.postMessage({ type: 'created-sample' });
    return;
  }

  // Close plugin
  if (msg.type === 'cancel') {
    figma.closePlugin('Plugin closed');
    return;
  }

  // Storage-related messages (used when the UI cannot access sessionStorage)
  if (msg.type === 'get-openai-key') {
    const k = await figma.clientStorage.getAsync('OPENAI_KEY');
    figma.ui.postMessage({ type: 'openai-key', key: k || null });
    return;
  }

  if (msg.type === 'save-openai-key') {
    try {
      await figma.clientStorage.setAsync('OPENAI_KEY', msg.key || '');
      figma.ui.postMessage({ type: 'openai-key-saved' });
    } catch (e) {
      figma.ui.postMessage({ type: 'error', message: 'Failed to save key' });
    }
    return;
  }

  if (msg.type === 'clear-openai-key') {
    try {
      await figma.clientStorage.deleteAsync('OPENAI_KEY');
      figma.ui.postMessage({ type: 'openai-key-cleared' });
    } catch (e) {
      figma.ui.postMessage({ type: 'error', message: 'Failed to clear key' });
    }
    return;
  }
};
