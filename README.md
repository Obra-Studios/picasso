# Picasso - AI-Powered Figma Plugin (simple demo)

Move one block → AI suggests how to move others. This is a minimal developer demo that calls OpenAI directly from the plugin UI.

IMPORTANT: calling OpenAI from the UI requires an API key in the browser. This demo stores the key in your session only. For production, host a server-side proxy and keep keys off the client.

## Quick Start

1. Build/watch the plugin

```bash
bun install
bun watch  # Keep this running in the project root
```

2. Load the plugin in Figma

1. Figma → Plugins → Development → Import plugin from manifest...
2. Select `manifest.json` from this folder
3. Run **Plugins** → **Development** → **Picasso**

3. Use it

1. Paste your OpenAI API key (sk-...) into the plugin UI and click Save.
2. Click **Create sample blocks**.
3. Select the left block and drag it.
4. The plugin will call OpenAI and show a suggested move for the nearest block. Click **Apply** to accept.

## Files

```
code.ts       - Plugin logic (TypeScript)
code.js       - Compiled plugin (auto-generated)
ui.html       - Plugin UI (direct OpenAI calls for demo)
manifest.json - Plugin config (allows https://api.openai.com)
server/       - DEPRECATED: server-side proxy (left in repo but not used in demo)
```

## Security note

- Do NOT publish the plugin with the key in the UI. This demo is for local development only.
- For production, restore a server-side proxy and keep keys on the server.

## If you want the proxy-based setup (safer)

See `server/REMOVED.md` for notes on the previously included proxy. I can restore a minimal proxy (Express) that forwards requests to OpenAI and keeps the key server-side if you'd prefer.

## How it works (high-level)

1. `code.ts` detects a moved node and picks a nearby node as the suggestion target.
2. The plugin UI (`ui.html`) sends the move context to OpenAI and parses a JSON response with x/y coordinates.
3. The UI shows the suggestion; clicking Apply sends a message back to the plugin main thread, which moves the target node.

Happy testing!
