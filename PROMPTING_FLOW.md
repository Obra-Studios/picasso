# Prompting Flow Documentation

This document explains how prompts from `prompts.json` are used in each OpenAI API call.

## Overview

The plugin makes **3 main API calls** to OpenAI:

1. **Semantic Description** - Describes existing shapes in the frame
2. **Planning Phase** - Generates a detailed plan in plain English
3. **Execution Phase** - Converts the plan into JSON operations

## How `callOpenAI` Works

The `callOpenAI` function automatically prepends the coordinate system context to all user prompts:

```typescript
callOpenAI(
    apiKey: string,
    systemPrompt: string,        // Hardcoded system message
    userPrompt: string,          // From prompts.json (with replacements)
    onDebug?: function,
    imageBase64?: string,
    temperature?: number,
    includeCoordinateContext: boolean = true  // Defaults to true
)
```

**What gets sent to OpenAI:**
- **System Message**: The `systemPrompt` parameter (hardcoded string)
- **User Message**: 
  - `figmaCoordinateSystemPrompt` (prepended automatically)
  - `\n\n`
  - `userPrompt` (from prompts.json with template variables replaced)
  - If screenshot provided: also includes the image

---

## API Call #1: Semantic Description

**Purpose**: Generate a human-readable description of existing shapes in the frame

**Function**: `generateSemanticDescription()`

**System Prompt** (hardcoded):
```
"You are a design analysis assistant. Describe visual designs in clear, human-readable terms."
```

**User Prompt** (constructed from prompts.json):
1. `semanticDescriptionPrompt` with `{domRepresentation}` replaced
2. If screenshot exists: `screenshotInterpretationPrompt` appended

**Full User Message Sent**:
```
[figmaCoordinateSystemPrompt]

[semanticDescriptionPrompt with {domRepresentation} replaced]

[If screenshot: screenshotInterpretationPrompt]
```

**Prompts Used from prompts.json**:
- ✅ `figmaCoordinateSystemPrompt` (prepended automatically)
- ✅ `semanticDescriptionPrompt` (with `{domRepresentation}` replaced)
- ✅ `screenshotInterpretationPrompt` (if screenshot provided)

---

## API Call #2: Planning Phase

**Purpose**: Generate a detailed plan in plain English describing what needs to be done

**Function**: Called during `generate` message handler

**System Prompt** (hardcoded):
```
"You are a design planning assistant. Create detailed, precise plans for design modifications with exact numerical values."
```

**User Prompt** (constructed from prompts.json):
1. `planningPrompt` with replacements:
   - `{userPrompt}` → user's design request
   - `{vectorDescription}` → description from API Call #1
   - `{domRepresentation}` → JSON DOM representation

**Full User Message Sent**:
```
[figmaCoordinateSystemPrompt]

[planningPrompt with {userPrompt}, {vectorDescription}, and {domRepresentation} replaced]
```

**Prompts Used from prompts.json**:
- ✅ `figmaCoordinateSystemPrompt` (prepended automatically)
- ✅ `planningPrompt` (with all template variables replaced)

---

## API Call #3: Execution Phase

**Purpose**: Convert the plan into JSON instructions for Figma primitives

**Function**: Called during `generate` message handler (after planning)

**System Prompt** (hardcoded):
```
"You are a design execution assistant. Convert detailed plans into precise JSON instructions for Figma primitives."
```

**User Prompt** (constructed from prompts.json):
1. `executionPrompt` with replacements:
   - `{plan}` → plan from API Call #2
   - `{domRepresentation}` → JSON DOM representation

**Full User Message Sent**:
```
[figmaCoordinateSystemPrompt]

[executionPrompt with {plan} and {domRepresentation} replaced]
```

**Prompts Used from prompts.json**:
- ✅ `figmaCoordinateSystemPrompt` (prepended automatically)
- ✅ `executionPrompt` (with all template variables replaced)

---

## Summary Table

| API Call                 | System Prompt                             | User Prompt Components                                                                                           | Screenshot? |
| ------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------- |
| **Semantic Description** | "You are a design analysis assistant..."  | `figmaCoordinateSystemPrompt`<br>`semanticDescriptionPrompt`<br>`screenshotInterpretationPrompt` (if screenshot) | ✅ Optional  |
| **Planning**             | "You are a design planning assistant..."  | `figmaCoordinateSystemPrompt`<br>`planningPrompt`                                                                | ❌ No        |
| **Execution**            | "You are a design execution assistant..." | `figmaCoordinateSystemPrompt`<br>`executionPrompt`                                                               | ❌ No        |

---

## Template Variables

Prompts use template variables that get replaced before sending:

- `{domRepresentation}` - JSON string of the DOM representation
- `{userPrompt}` - User's design request text
- `{vectorDescription}` - Description from semantic description API call
- `{plan}` - Plan from planning phase API call

---

## Unused Prompts in prompts.json

The following prompts exist in `prompts.json` but are **not currently used** in the code:
- `systemPrompt` - Legacy prompt, not used
- `completionPrompt` - Legacy prompt, not used (replaced by planning/execution two-phase approach)
- `vectorDescriptionPrompt` - Legacy prompt, not used

These may be kept for reference or future use.

## Notes

1. **Coordinate System Context**: The `figmaCoordinateSystemPrompt` is **automatically prepended** to ALL user prompts by default (can be disabled with `includeCoordinateContext: false`)

2. **System Prompts**: System prompts are hardcoded strings, not from prompts.json

3. **Screenshot Support**: Only the semantic description call supports screenshots (vision API)

4. **Temperature**: All calls use the same temperature setting (default 0.7, configurable in UI)

5. **Template Replacement**: All template variables (`{domRepresentation}`, `{userPrompt}`, etc.) are replaced with actual values before the prompt is sent to OpenAI

