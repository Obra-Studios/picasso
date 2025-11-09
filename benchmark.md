# Benchmark Execution Suite

This document describes how to use the benchmark suite to test and compare different versions of the execution system.

## Setup

1. Set your OpenAI API key as an environment variable:
   ```bash
   export OPENAI_API_KEY=sk-your-api-key-here
   ```

2. Run the benchmark:
   ```bash
   bun run benchmark
   ```

## Basic Usage

### Test All Versions

Run benchmarks for all configured versions:
```bash
bun run benchmark
```

### Test Specific Version(s)

Test only a single version (saves API calls):
```bash
bun run benchmark --version v2
```

Test only v1:
```bash
bun run benchmark --version v1
```

### Test Multiple Versions

Test multiple specific versions:
```bash
bun run benchmark --version v1,v2
```

### Customize Iterations

Change the number of iterations per test (default is 3):
```bash
bun run benchmark --version v2 --iterations 5
```

### Combined Options

Test specific version(s) with custom iterations:
```bash
bun run benchmark --version=v2 --iterations=5
```

Alternative syntax:
```bash
bun run benchmark -v v2 -i 5
```

## Command Line Arguments

| Argument       | Short | Description                   | Example                             |
| -------------- | ----- | ----------------------------- | ----------------------------------- |
| `--version`    | `-v`  | Specify version(s) to test    | `--version v2` or `--version v1,v2` |
| `--iterations` | `-i`  | Number of iterations per test | `--iterations 5`                    |

### Argument Formats

All of these formats are supported:
- `--version v2`
- `--version=v2`
- `-v v2`
- `--version v1,v2`
- `--version=v1,v2`

## What Gets Tested

The benchmark suite tests the `parseExecutionPlan` function, which is the core inference/API call portion of the execution system. It measures:

- **Total execution time** (end-to-end)
- **API call count** (number of OpenAI API calls made)
- **API call timing** (individual call durations)
- **Success rate** (percentage of successful runs)
- **Plan operations count** (number of operations in the generated plan)

## Test Cases

The benchmark includes three default test cases:

1. **simple-natural-language**: Single shape creation
   - Input: "Create a red circle with radius 50 at position (100, 100)"

2. **complex-natural-language**: Multiple shapes with relationships
   - Input: Login form with email input field, button, and text elements

3. **constraint-based-form**: Constraint-based JSON input
   - Input: Structured constraint-based actions for form creation

## Output

### Console Output

The benchmark displays:
- Real-time progress for each test iteration
- Summary table with statistics (avg, min, max, std dev)
- Version comparison table (when multiple versions are tested)
- Error messages if any tests fail

### Results File

All results are saved to `benchmark-results.json` which:
- Appends new results to existing data
- Contains full details of each test run
- Can be used for historical analysis

## Adding New Versions

To add a new version for benchmarking:

1. Create a copy of `operations.ts` (e.g., `operations-v3.ts`)
2. Make your modifications (prompts, functions, etc.) while maintaining the same function signatures
3. Add the version to the `allVersions` array in `benchmark-execution.ts`:
   ```typescript
   {
       name: 'v3',
       importPath: './operations-v3',
       functionName: 'parseExecutionPlan'
   }
   ```
4. Run benchmarks to compare:
   ```bash
   bun run benchmark --version v2,v3
   ```

## Tips

- **Save API calls**: Use `--version` to test only the version you're working on
- **Faster iteration**: Reduce `--iterations` to 1 or 2 during development
- **Statistical significance**: Use at least 3 iterations for reliable results
- **Compare versions**: Test multiple versions together to see side-by-side comparisons

## Example Workflow

1. Make changes to `operations-v2.ts`
2. Test only v2 with fewer iterations for quick feedback:
   ```bash
   bun run benchmark --version v2 --iterations 1
   ```
3. Once working, run full comparison:
   ```bash
   bun run benchmark --version v1,v2 --iterations 3
   ```
4. Review the comparison table to see performance differences

## Troubleshooting

### "No matching versions found"
- Check that the version name matches exactly (case-sensitive)
- Available versions are listed in the error message

### "OPENAI_API_KEY environment variable is not set"
- Set the API key: `export OPENAI_API_KEY=your-key`
- Or add it to your shell profile for persistence

### Tests failing with JSON parse errors
- Check the error messages in the console output
- The benchmark now includes detailed error logging
- Common causes: API returning invalid JSON, schema validation failures

