// Prompts configuration for the agent playground
// This file can be easily edited to customize the prompts sent to OpenAI
export const prompts = {
    systemPrompt: "You are a design assistant that helps complete vector graphics in Figma. Given a description of existing vectors and a user's prompt, you should generate instructions for creating additional vectors to complete the design. Respond with a JSON array of vector creation instructions.",
    vectorDescriptionPrompt: "Describe the following vector in detail, including its shape, position, size, and any visual characteristics:",
    semanticDescriptionPrompt: "Based on the following DOM-like representation of vector graphics, provide a clear, concise description of what this design looks like. Focus on what a human would see - shapes, patterns, and visual elements. Keep it to 2-3 sentences:\n\n{domRepresentation}",
    completionPrompt: "Given the existing vector description and the user's request to \"{userPrompt}\", generate instructions for creating additional vectors. The existing vector description is: {vectorDescription}. The DOM representation is: {domRepresentation}. Respond with a JSON array where each object has: type (circle, rectangle, path, etc.), x, y, width, height (if applicable), fills (color as RGB 0-1), strokes (color as RGB 0-1), strokeWeight, and any path data if it's a vector path."
};
