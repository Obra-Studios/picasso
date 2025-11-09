// Context Agent - Generates natural language descriptions of design frames
// Based on JSON serialization of the DOM and optional user-provided context
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export function generateContextDescription(additionalContext, frameJSON, apiKey, frameImageBase64) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const additionalContextText = additionalContext
            ? `\n\nADDITIONAL CONTEXT (user-provided):\n${additionalContext}`
            : '';
        const imageNote = frameImageBase64
            ? '\n\nNOTE: You are also provided with a visual screenshot of the frame to help you better understand the layout and visual appearance.'
            : '';
        const prompt = `Analyze this Figma design frame. First, identify WHAT the design represents (e.g., "a smiley face", "a button with text", "a card layout", "a navigation bar"). Then describe the visual style.${imageNote}

FRAME STRUCTURE (JSON):
${JSON.stringify(frameJSON, null, 2)}${additionalContextText}

Provide a description in two parts:

1. COMPOSITION & MEANING: What does this design represent? What are the specific elements and their semantic purpose? For example:
   - "A smiley face made of a circle with two smaller circles for eyes and a curved line for a mouth"
   - "A button with centered text and rounded corners"
   - "A card containing an image, title, and description text"
   - "A navigation bar with multiple menu items"
   - Identify groups of elements that work together
   - Describe what each element represents and its purpose in the design
   - Note if there are multiple unrelated assets on the frame

2. VISUAL STYLE: Describe the visual appearance in detail:
   - Color Palette: List all main colors used with their RGB values, identify primary, secondary, and accent colors
   - Typography: Font families, sizes, weights, line heights, letter spacing if text exists
   - Corners: Corner radius values for rounded elements
   - Effects: Shadows, blurs, gradients, or other visual effects
   - Spacing: Padding, margins, gaps between elements
   - Overall aesthetic: Brief description (e.g., "minimalist", "bold", "soft", "modern", "playful")

Be specific about:
- Each element's semantic purpose and role
- How elements compose into recognizable designs or patterns
- The complete color palette with RGB values
- All stylistic choices including typography, spacing, and effects
- Keep it concise but comprehensive and factual.`;
        const messages = [
            {
                role: 'system',
                content: 'You are a design expert. Analyze Figma frame JSON structures and provide detailed, factual descriptions of composition, semantic meaning, color palettes, and stylistic choices.',
            },
        ];
        // Add user message with image if available
        if (frameImageBase64) {
            messages.push({
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: prompt,
                    },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/png;base64,${frameImageBase64}`,
                        },
                    },
                ],
            });
        }
        else {
            messages.push({
                role: 'user',
                content: prompt,
            });
        }
        const response = yield fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: messages,
                temperature: 0.3,
                max_tokens: 1000,
            }),
        });
        if (!response.ok) {
            const error = yield response.json();
            throw new Error(((_a = error.error) === null || _a === void 0 ? void 0 : _a.message) || 'LLM API error');
        }
        const data = yield response.json();
        return ((_c = (_b = data.choices[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) || 'No response from LLM';
    });
}
