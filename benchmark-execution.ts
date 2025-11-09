// ============================================================================
// EXECUTION BENCHMARKING SUITE
// Measures end-to-end inference speed for execution.ts variants
// Focuses on the inference/API call portion (parseExecutionPlan)
// ============================================================================

import { ConstraintBasedPlan, ExecutionPlan, APICallInfo } from './execution';

// ============================================================================
// TYPES
// ============================================================================

interface BenchmarkResult {
    version: string;
    testCase: string;
    inputType: 'naturalLanguage' | 'constraintBased';
    iteration: number;
    totalTimeMs: number;
    apiCallCount: number;
    apiCallTimes: number[];
    totalApiTimeMs: number;
    success: boolean;
    errors: string[];
    planOperationsCount: number;
    timestamp: number;
}

interface TestCase {
    name: string;
    input: string | ConstraintBasedPlan;
    inputType: 'naturalLanguage' | 'constraintBased';
    description: string;
}

interface VersionConfig {
    name: string;
    // Import path for the version (e.g., './operations-v1' or './operations')
    importPath: string;
    // Function name to call (default: 'parseExecutionPlan')
    functionName?: string;
}

interface BenchmarkConfig {
    apiKey: string;
    versions: VersionConfig[];
    testCases: TestCase[];
    iterations: number; // Number of runs per test case per version
    resultsFile: string; // Path to store results JSON
    disableCache: boolean; // Ensure no caching is used
}

// ============================================================================
// TEST CASES
// ============================================================================

const DEFAULT_TEST_CASES: TestCase[] = [
    {
        name: 'simple-natural-language',
        input: 'Create a red circle with radius 50 at position (100, 100)',
        inputType: 'naturalLanguage',
        description: 'Simple natural language input - single shape creation'
    },
    {
        name: 'complex-natural-language',
        input: `Create a login form with:
1. An email input field (rectangle, 200x40) at position (50, 100) with light gray fill
2. A login button (rectangle, 100x40) below the email field with 16px spacing, blue fill
3. Text "Email" inside the email input field
4. Text "Login" inside the login button, centered`,
        inputType: 'naturalLanguage',
        description: 'Complex natural language input - multiple shapes with relationships'
    },
    {
        name: 'constraint-based-form',
        input: {
            actions: [
                {
                    id: 'action-1',
                    type: 'create',
                    description: 'Create an email input field inside the Content Area',
                    constraints: [
                        {
                            id: 'constraint-1',
                            type: 'position',
                            description: 'Position the email input field inside the Content Area with padding',
                            targetId: 'email-input',
                            parameters: {
                                containerId: 'frame-1',
                                padding: { top: 16, right: 16, bottom: 16, left: 16 },
                                xRange: { min: 16, max: 584 },
                                yRange: { min: 136, max: 664 }
                            }
                        },
                        {
                            id: 'constraint-2',
                            type: 'size',
                            description: 'Set the size of the email input field',
                            targetId: 'email-input',
                            parameters: {
                                width: { operator: 'eq', value: 200 },
                                height: { operator: 'eq', value: 40 }
                            }
                        }
                    ]
                },
                {
                    id: 'action-2',
                    type: 'create',
                    description: 'Create a login button below the email input field',
                    constraints: [
                        {
                            id: 'constraint-3',
                            type: 'spacing',
                            description: 'Place the login button below the email input field',
                            targetId: 'login-button',
                            parameters: {
                                referenceId: 'email-input',
                                direction: 'vertical',
                                distance: { operator: 'eq', value: 16 }
                            }
                        },
                        {
                            id: 'constraint-4',
                            type: 'size',
                            description: 'Set the size of the login button',
                            targetId: 'login-button',
                            parameters: {
                                width: { operator: 'eq', value: 100 },
                                height: { operator: 'eq', value: 40 }
                            }
                        },
                        {
                            id: 'constraint-5',
                            type: 'color',
                            description: 'Set the fill color of the login button to primary',
                            targetId: 'login-button',
                            parameters: {
                                property: 'fill',
                                value: 'primary'
                            }
                        }
                    ]
                }
            ],
            metadata: {
                timestamp: Date.now(),
                model: 'gpt-4o-2024-08-06',
                intent: 'Create a login form with an email input field and a login button'
            }
        } as ConstraintBasedPlan,
        inputType: 'constraintBased',
        description: 'Constraint-based input - form creation with multiple constraints'
    }
];

// ============================================================================
// FIGMA MOCK FOR BENCHMARKING
// ============================================================================

/**
 * Creates a mock Figma environment for benchmarking
 * This allows the operations.ts code to run without the actual Figma plugin environment
 */
function setupFigmaMock() {
    if (typeof (globalThis as any).figma === 'undefined') {
        (globalThis as any).figma = {
            currentPage: {
                children: [] // Empty page for benchmarking
            }
        };
    }
}

/**
 * Cleans up the Figma mock
 */
function teardownFigmaMock() {
    // Optionally remove the mock if needed
    // For now, we'll leave it in place
}

// ============================================================================
// BENCHMARKING FUNCTIONS
// ============================================================================

/**
 * Loads a version module dynamically
 */
async function loadVersion(version: VersionConfig): Promise<any> {
    try {
        // Clear module cache to ensure fresh imports (no caching)
        if (typeof require !== 'undefined' && require.cache) {
            const cacheKey = require.resolve(version.importPath);
            if (require.cache[cacheKey]) {
                delete require.cache[cacheKey];
            }
        }

        const module = await import(version.importPath);
        const functionName = version.functionName || 'parseExecutionPlan';
        if (!module[functionName]) {
            throw new Error(`Function ${functionName} not found in ${version.importPath}`);
        }
        return module[functionName];
    } catch (error) {
        throw new Error(`Failed to load version ${version.name} from ${version.importPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Instrumented fetch wrapper to track API call timing
 */
let apiCallTimings: Array<{ start: number; end: number; duration: number }> = [];
let apiCallCount = 0;

let originalFetch: typeof fetch | null = null;

// Delay between API calls to avoid rate limiting (in milliseconds)
const API_CALL_DELAY_MS = 20000; // 20 seconds

function instrumentFetch() {
    if (!originalFetch) {
        originalFetch = globalThis.fetch;
    }
    apiCallTimings = [];
    apiCallCount = 0;

    globalThis.fetch = async function (...args: Parameters<typeof fetch>): Promise<Response> {
        // Add delay before API call (except for the first one)
        if (apiCallCount > 0) {
            console.log(`      ⏳ Waiting ${API_CALL_DELAY_MS / 1000}s before next API call to avoid rate limits...`);
            await new Promise(resolve => setTimeout(resolve, API_CALL_DELAY_MS));
        }

        apiCallCount++;
        const start = performance.now();
        const response = await originalFetch!(...args);
        const end = performance.now();
        const duration = end - start;

        apiCallTimings.push({ start, end, duration });
        return response;
    } as typeof fetch;
}

function resetFetch() {
    // Restore original fetch
    if (originalFetch) {
        globalThis.fetch = originalFetch;
    }
    // Reset API call count for next iteration
    apiCallCount = 0;
}

/**
 * Runs a single benchmark iteration
 */
async function runBenchmarkIteration(
    version: VersionConfig,
    testCase: TestCase,
    apiKey: string,
    iteration: number,
    disableCache: boolean
): Promise<BenchmarkResult> {
    // Setup Figma mock for benchmarking
    setupFigmaMock();

    // Instrument fetch to track API call times
    instrumentFetch();

    const parseFn = await loadVersion(version);

    const startTime = performance.now();

    try {
        // Call parseExecutionPlan (the inference function)
        const result = await parseFn(testCase.input, apiKey);
        const endTime = performance.now();
        const totalTimeMs = endTime - startTime;

        // Extract API call times
        // The apiCallTimings array should have the actual fetch durations
        const apiCallTimes = apiCallTimings.map(t => t.duration);

        // If we don't have timings from fetch instrumentation, use timestamps from API calls
        if (apiCallTimes.length === 0 && result.apiCalls && result.apiCalls.length > 0) {
            // Estimate based on total time divided by number of calls
            // This is less precise but works if fetch instrumentation isn't available
            const estimatedTimePerCall = totalTimeMs / result.apiCalls.length;
            for (let i = 0; i < result.apiCalls.length; i++) {
                apiCallTimes.push(estimatedTimePerCall);
            }
        }

        const totalApiTimeMs = apiCallTimes.reduce((sum, time) => sum + time, 0);

        resetFetch();
        teardownFigmaMock();

        return {
            version: version.name,
            testCase: testCase.name,
            inputType: testCase.inputType,
            iteration,
            totalTimeMs,
            apiCallCount: result.apiCalls?.length || 0,
            apiCallTimes: apiCallTimes,
            totalApiTimeMs,
            success: true, // parseExecutionPlan doesn't return success, assume true if no error
            errors: [],
            planOperationsCount: result.plan?.operations?.length || 0,
            timestamp: Date.now()
        };
    } catch (error) {
        const endTime = performance.now();
        const totalTimeMs = endTime - startTime;

        resetFetch();
        teardownFigmaMock();

        return {
            version: version.name,
            testCase: testCase.name,
            inputType: testCase.inputType,
            iteration,
            totalTimeMs,
            apiCallCount: 0,
            apiCallTimes: [],
            totalApiTimeMs: 0,
            success: false,
            errors: [error instanceof Error ? error.message : String(error)],
            planOperationsCount: 0,
            timestamp: Date.now()
        };
    }
}

/**
 * Runs all benchmarks according to the configuration
 */
export async function runBenchmarks(config: BenchmarkConfig): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];

    console.log(`\n🚀 Starting benchmark suite...`);
    console.log(`   Versions: ${config.versions.map(v => v.name).join(', ')}`);
    console.log(`   Test cases: ${config.testCases.length}`);
    console.log(`   Iterations per test: ${config.iterations}`);
    console.log(`   Cache disabled: ${config.disableCache}\n`);

    for (const version of config.versions) {
        console.log(`\n📦 Testing version: ${version.name}`);

        for (const testCase of config.testCases) {
            console.log(`   📝 Test case: ${testCase.name} (${testCase.inputType})`);

            for (let i = 1; i <= config.iterations; i++) {
                process.stdout.write(`      Iteration ${i}/${config.iterations}... `);

                const result = await runBenchmarkIteration(
                    version,
                    testCase,
                    config.apiKey,
                    i,
                    config.disableCache
                );
                results.push(result);

                const status = result.success ? '✅' : '❌';
                const timeStr = `${result.totalTimeMs.toFixed(2)}ms`;
                const apiCallsStr = result.apiCallCount > 0 ? ` (${result.apiCallCount} API calls)` : '';
                const errorStr = result.errors.length > 0 ? ` - Error: ${result.errors[0].substring(0, 100)}` : '';
                console.log(`${status} ${timeStr}${apiCallsStr}${errorStr}`);

                // Delay between iterations to avoid rate limiting and ensure no caching
                if (i < config.iterations) {
                    console.log(`      ⏳ Waiting 20s before next iteration to avoid rate limits...`);
                    await new Promise(resolve => setTimeout(resolve, 20000)); // 20 seconds
                }
            }

            // Delay between test cases to avoid rate limiting
            if (testCase !== config.testCases[config.testCases.length - 1]) {
                console.log(`   ⏳ Waiting 20s before next test case to avoid rate limits...`);
                await new Promise(resolve => setTimeout(resolve, 20000)); // 20 seconds
            }
        }

        // Delay between versions to avoid rate limiting
        if (version !== config.versions[config.versions.length - 1]) {
            console.log(`⏳ Waiting 20s before next version to avoid rate limits...`);
            await new Promise(resolve => setTimeout(resolve, 20000)); // 20 seconds
        }
    }

    return results;
}

/**
 * Saves results to a JSON file
 */
export async function saveResults(results: BenchmarkResult[], filePath: string): Promise<void> {
    // Try to use Node.js fs, fall back to Bun's if available
    let writeFile: (path: string, data: string, encoding: string) => Promise<void>;

    try {
        const fs = await import('fs/promises');
        writeFile = fs.writeFile;
    } catch {
        // Fall back to Bun's file system API
        const { writeFile: bunWriteFile } = await import('bun');
        writeFile = async (path: string, data: string) => {
            await bunWriteFile(path, data);
        };
    }

    // Load existing results if file exists
    let existingData: any = { results: [] };
    try {
        const fs = await import('fs/promises');
        const existingContent = await fs.readFile(filePath, 'utf-8');
        existingData = JSON.parse(existingContent);
    } catch {
        // File doesn't exist or can't be read, start fresh
    }

    // Append new results to existing ones
    const allResults = [...(existingData.results || []), ...results];

    const data = {
        metadata: {
            generatedAt: new Date().toISOString(),
            totalResults: allResults.length,
            lastUpdate: new Date().toISOString()
        },
        results: allResults
    };

    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`\n💾 Results saved to ${filePath} (${allResults.length} total results)`);
}

/**
 * Generates a summary table from results
 */
export function generateSummaryTable(results: BenchmarkResult[]): string {
    // Group results by version and test case
    const grouped = new Map<string, BenchmarkResult[]>();

    for (const result of results) {
        const key = `${result.version}::${result.testCase}`;
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key)!.push(result);
    }

    // Calculate statistics for each group
    const stats: Array<{
        version: string;
        testCase: string;
        inputType: string;
        avgTimeMs: number;
        minTimeMs: number;
        maxTimeMs: number;
        stdDevMs: number;
        avgApiCalls: number;
        avgApiTimeMs: number;
        successRate: number;
        iterations: number;
    }> = [];

    for (const [key, groupResults] of grouped) {
        const [version, testCase] = key.split('::');
        const times = groupResults.map(r => r.totalTimeMs);
        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        const variance = times.reduce((sum, time) => sum + Math.pow(time - avgTime, 2), 0) / times.length;
        const stdDev = Math.sqrt(variance);
        const avgApiCalls = groupResults.reduce((sum, r) => sum + r.apiCallCount, 0) / groupResults.length;
        const avgApiTime = groupResults.reduce((sum, r) => sum + r.totalApiTimeMs, 0) / groupResults.length;
        const successCount = groupResults.filter(r => r.success).length;
        const successRate = (successCount / groupResults.length) * 100;

        stats.push({
            version,
            testCase,
            inputType: groupResults[0].inputType,
            avgTimeMs: avgTime,
            minTimeMs: minTime,
            maxTimeMs: maxTime,
            stdDevMs: stdDev,
            avgApiCalls: avgApiCalls,
            avgApiTimeMs: avgApiTime,
            successRate,
            iterations: groupResults.length
        });
    }

    // Sort by version, then test case
    stats.sort((a, b) => {
        if (a.version !== b.version) return a.version.localeCompare(b.version);
        return a.testCase.localeCompare(b.testCase);
    });

    // Generate table
    let table = '\n' + '='.repeat(120) + '\n';
    table += 'BENCHMARK SUMMARY TABLE\n';
    table += '='.repeat(120) + '\n\n';

    // Header
    table += 'Version'.padEnd(15);
    table += 'Test Case'.padEnd(30);
    table += 'Type'.padEnd(15);
    table += 'Avg (ms)'.padEnd(12);
    table += 'Min (ms)'.padEnd(12);
    table += 'Max (ms)'.padEnd(12);
    table += 'StdDev (ms)'.padEnd(14);
    table += 'API Calls'.padEnd(12);
    table += 'API Time (ms)'.padEnd(15);
    table += 'Success %'.padEnd(12);
    table += 'Iterations\n';
    table += '-'.repeat(140) + '\n';

    // Rows
    for (const stat of stats) {
        table += stat.version.padEnd(15);
        table += stat.testCase.padEnd(30);
        table += stat.inputType.padEnd(15);
        table += stat.avgTimeMs.toFixed(2).padEnd(12);
        table += stat.minTimeMs.toFixed(2).padEnd(12);
        table += stat.maxTimeMs.toFixed(2).padEnd(12);
        table += stat.stdDevMs.toFixed(2).padEnd(14);
        table += stat.avgApiCalls.toFixed(1).padEnd(12);
        table += stat.avgApiTimeMs.toFixed(2).padEnd(15);
        table += `${stat.successRate.toFixed(1)}%`.padEnd(12);
        table += `${stat.iterations}\n`;
    }

    table += '\n' + '='.repeat(140) + '\n';

    return table;
}

/**
 * Compares versions side-by-side
 */
export function generateComparisonTable(results: BenchmarkResult[]): string {
    // Group by test case first
    const byTestCase = new Map<string, Map<string, BenchmarkResult[]>>();

    for (const result of results) {
        if (!byTestCase.has(result.testCase)) {
            byTestCase.set(result.testCase, new Map());
        }
        const byVersion = byTestCase.get(result.testCase)!;
        if (!byVersion.has(result.version)) {
            byVersion.set(result.version, []);
        }
        byVersion.get(result.version)!.push(result);
    }

    let table = '\n' + '='.repeat(120) + '\n';
    table += 'VERSION COMPARISON TABLE\n';
    table += '='.repeat(120) + '\n\n';

    for (const [testCase, versions] of byTestCase) {
        table += `Test Case: ${testCase}\n`;
        table += '-'.repeat(120) + '\n';

        // Get all versions for this test case
        const versionNames = Array.from(versions.keys()).sort();

        // Header
        table += 'Metric'.padEnd(20);
        for (const version of versionNames) {
            table += version.padEnd(20);
        }
        table += '\n';
        table += '-'.repeat(120) + '\n';

        // Calculate averages for each version
        const versionStats = new Map<string, { avg: number; min: number; max: number }>();
        for (const version of versionNames) {
            const versionResults = versions.get(version)!;
            const times = versionResults.map(r => r.totalTimeMs);
            versionStats.set(version, {
                avg: times.reduce((a, b) => a + b, 0) / times.length,
                min: Math.min(...times),
                max: Math.max(...times)
            });
        }

        // Average time
        table += 'Avg Time (ms)'.padEnd(20);
        for (const version of versionNames) {
            const stat = versionStats.get(version)!;
            table += stat.avg.toFixed(2).padEnd(20);
        }
        table += '\n';

        // Min time
        table += 'Min Time (ms)'.padEnd(20);
        for (const version of versionNames) {
            const stat = versionStats.get(version)!;
            table += stat.min.toFixed(2).padEnd(20);
        }
        table += '\n';

        // Max time
        table += 'Max Time (ms)'.padEnd(20);
        for (const version of versionNames) {
            const stat = versionStats.get(version)!;
            table += stat.max.toFixed(2).padEnd(20);
        }
        table += '\n';

        // Success rate
        table += 'Success Rate %'.padEnd(20);
        for (const version of versionNames) {
            const versionResults = versions.get(version)!;
            const successCount = versionResults.filter(r => r.success).length;
            const successRate = (successCount / versionResults.length) * 100;
            table += `${successRate.toFixed(1)}%`.padEnd(20);
        }
        table += '\n';

        // Average API calls
        table += 'Avg API Calls'.padEnd(20);
        for (const version of versionNames) {
            const versionResults = versions.get(version)!;
            const avgApiCalls = versionResults.reduce((sum, r) => sum + r.apiCallCount, 0) / versionResults.length;
            table += avgApiCalls.toFixed(1).padEnd(20);
        }
        table += '\n\n';
    }

    table += '='.repeat(120) + '\n';

    return table;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

/**
 * Parse command line arguments
 */
function parseArgs(): { versions?: string[]; iterations?: number } {
    const args = process.argv.slice(2);
    const result: { versions?: string[]; iterations?: number } = {};

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--version' || args[i] === '-v') {
            // Support multiple versions: --version v1 v2 or --version v1,v2
            const versionArg = args[i + 1];
            if (versionArg) {
                result.versions = versionArg.includes(',')
                    ? versionArg.split(',').map(v => v.trim())
                    : [versionArg];
                i++; // Skip the next argument
            }
        } else if (args[i] === '--iterations' || args[i] === '-i') {
            const iterationsArg = args[i + 1];
            if (iterationsArg) {
                result.iterations = parseInt(iterationsArg, 10);
                i++; // Skip the next argument
            }
        } else if (args[i].startsWith('--version=')) {
            // Support --version=v1,v2 format
            const versionArg = args[i].split('=')[1];
            result.versions = versionArg.includes(',')
                ? versionArg.split(',').map(v => v.trim())
                : [versionArg];
        } else if (args[i].startsWith('--iterations=')) {
            // Support --iterations=5 format
            const iterationsArg = args[i].split('=')[1];
            result.iterations = parseInt(iterationsArg, 10);
        }
    }

    return result;
}

/**
 * Main function to run benchmarks
 */
export async function main() {
    // Get API key from environment variable
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.error('❌ Error: OPENAI_API_KEY environment variable is not set');
        console.error('   Please set it before running benchmarks:');
        console.error('   export OPENAI_API_KEY=your-api-key');
        process.exit(1);
    }

    // Parse command line arguments
    const args = parseArgs();

    // Available versions configuration
    // 
    // TO ADD A NEW VERSION FOR BENCHMARKING:
    // 1. Create a copy of operations.ts (e.g., operations-v2.ts)
    // 2. Make your modifications (prompts, functions, etc.) while maintaining the same function signatures
    // 3. Add the version to the allVersions array below:
    //    {
    //        name: 'v2',
    //        importPath: './operations-v2',
    //        functionName: 'parseExecutionPlan'  // Must match the exported function name
    //    }
    // 4. The benchmark will automatically test both versions and compare results
    //
    const allVersions: VersionConfig[] = [
        {
            name: 'v1',
            importPath: './operations', // operations.ts
            functionName: 'parseExecutionPlan'
            // V1: gpt-4o-2024-08-06 with temperature 0.2 (baseline)
        },
        {
            name: 'v2',
            importPath: './operations-v2', // operations-v2.ts
            functionName: 'parseExecutionPlan'
            // V2: gpt-4o-2024-08-06 with temperature 0.2 (modified prompts/functions)
        },
        {
            name: 'v3',
            importPath: './operations-v3', // operations-v3.ts
            functionName: 'parseExecutionPlan'
            // V3: gpt-4o-mini with temperature 0.2 (faster, lower cost alternative to gpt-4o)
        },
        {
            name: 'v4',
            importPath: './operations-v4', // operations-v4.ts
            functionName: 'parseExecutionPlan'
            // V4: gpt-3.5-turbo with temperature 0.2 (older, faster, lower cost model)
        },
        {
            name: 'v5',
            importPath: './operations-v5', // operations-v5.ts
            functionName: 'parseExecutionPlan'
            // V5: gpt-4o-2024-08-06 with temperature 0 (same as v1 but deterministic, faster inference)
            // Compare v1 vs v5 to measure speedup from temperature reduction
        },
        {
            name: 'v6',
            importPath: './operations-v6', // operations-v6.ts
            functionName: 'parseExecutionPlan'
            // V6: gpt-4o-2024-08-06 with temperature 0.2
            // OPTIMIZATION: Skip DOM collection - Removed collectFigmaDOMInfo() call and DOM info from prompt
            // This significantly reduces prompt size and token count, especially for pages with many nodes
        },
        {
            name: 'v7',
            importPath: './operations-v7', // operations-v7.ts
            functionName: 'parseExecutionPlan'
            // V7: gpt-4o-2024-08-06 with temperature 0.2
            // OPTIMIZATION: Shortened prompts - Removed verbose explanations, examples, and detailed instructions
            // This reduces token count significantly, potentially speeding up API calls
        },
        {
            name: 'v8',
            importPath: './operations-v8', // operations-v8.ts
            functionName: 'parseExecutionPlan'
            // V8: gpt-4o-2024-08-06 with temperature 0.2
            // OPTIMIZATION: Non-strict JSON schema - Changed strict: true to strict: false
            // This may speed up validation and reduce processing time
        }
    ];

    // Filter versions based on command line argument
    let versionsToTest: VersionConfig[];
    if (args.versions && args.versions.length > 0) {
        versionsToTest = allVersions.filter(v => args.versions!.includes(v.name));
        if (versionsToTest.length === 0) {
            console.error(`❌ Error: No matching versions found for: ${args.versions.join(', ')}`);
            console.error(`   Available versions: ${allVersions.map(v => v.name).join(', ')}`);
            process.exit(1);
        }
        console.log(`📌 Testing only version(s): ${versionsToTest.map(v => v.name).join(', ')}`);
    } else {
        versionsToTest = allVersions;
        console.log(`📌 Testing all versions: ${versionsToTest.map(v => v.name).join(', ')}`);
    }

    const config: BenchmarkConfig = {
        apiKey,
        versions: versionsToTest,
        testCases: DEFAULT_TEST_CASES,
        iterations: args.iterations || 10, // Use command line arg or default to 10
        resultsFile: './benchmark-results.json',
        disableCache: true // Ensure no caching for consistent testing
    };

    console.log('🔬 Execution Benchmarking Suite');
    console.log('================================\n');
    console.log('Configuration:');
    console.log(`  Versions: ${config.versions.map(v => v.name).join(', ')}`);
    console.log(`  Test cases: ${config.testCases.length}`);
    console.log(`  Iterations per test: ${config.iterations}`);
    console.log(`  Results file: ${config.resultsFile}`);
    console.log('\n💡 Tip: Use --version v2 to test only specific versions');
    console.log('   Example: bun run benchmark --version v2\n');

    // Run benchmarks
    const results = await runBenchmarks(config);

    // Save results
    await saveResults(results, config.resultsFile);

    // Generate and display summary
    const summary = generateSummaryTable(results);
    console.log(summary);

    // Generate and display comparison
    if (config.versions.length > 1) {
        const comparison = generateComparisonTable(results);
        console.log(comparison);
    }

    console.log('\n✅ Benchmarking complete!');
}

// Run if executed directly (Node.js/Bun)
if (typeof require !== 'undefined' && require.main === module) {
    main().catch(error => {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    });
}

// Also export for programmatic use
export { DEFAULT_TEST_CASES };

