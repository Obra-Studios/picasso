Below are the steps to get your plugin running. You can also find instructions at:

  https://www.figma.com/plugin-docs/plugin-quickstart-guide/

This plugin template uses Typescript and NPM, two standard tools in creating JavaScript applications.

## Using Bun (Recommended)

Bun is a fast all-in-one JavaScript runtime & toolkit. To use Bun with this plugin:

1. Install Bun if you haven't already:

   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

   Or visit https://bun.sh for other installation methods.

2. Install dependencies:

   ```bash
   bun install
   ```

3. Build the plugin:

   ```bash
   bun run build
   ```

4. Or run in watch mode for development:

   ```bash
   bun run watch
   ```

That's it! Bun will automatically compile TypeScript to JavaScript and regenerate files when you save.
