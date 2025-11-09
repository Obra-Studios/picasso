// ============================================================================
// API UTILITIES
// Retry logic for OpenAI API calls with exponential backoff
// ============================================================================

interface OpenAIRequestOptions {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
}

interface RetryOptions {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
}

/**
 * Makes a fetch request to OpenAI API with automatic retry on rate limit errors
 */
export async function fetchWithRetry(
    options: OpenAIRequestOptions,
    retryOptions: RetryOptions = {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
    const {
        maxRetries = 3,
        initialDelayMs = 1000,
        maxDelayMs = 10000,
        backoffMultiplier = 2,
    } = retryOptions;

    let lastError: Error | null = null;
    let delayMs = initialDelayMs;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            console.log(`API request attempt ${attempt + 1}/${maxRetries + 1}`);
            
            const response = await fetch(options.url, {
                method: options.method,
                headers: options.headers,
                body: options.body,
            });

            // Check if we got a rate limit error (429) or server error (5xx)
            if (response.status === 429) {
                // Rate limit error
                const errorData = await response.json().catch(() => ({})) as { error?: { message?: string } };
                const errorMessage = errorData.error?.message || 'Rate limit exceeded';
                
                console.warn(`⚠️ Rate limit error (attempt ${attempt + 1}/${maxRetries + 1}): ${errorMessage}`);
                
                // Check if there's a Retry-After header
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const retryAfter = (response as any).headers?.get?.('Retry-After');
                if (retryAfter) {
                    const retryDelaySeconds = parseInt(retryAfter, 10);
                    if (!isNaN(retryDelaySeconds)) {
                        delayMs = Math.min(retryDelaySeconds * 1000, maxDelayMs);
                    }
                }
                
                lastError = new Error(`Rate limit error: ${errorMessage}`);
                
                // Don't retry if this was the last attempt
                if (attempt < maxRetries) {
                    console.log(`⏳ Waiting ${delayMs}ms before retry...`);
                    await sleep(delayMs);
                    delayMs = Math.min(delayMs * backoffMultiplier, maxDelayMs);
                    continue;
                }
            } else if (response.status >= 500 && response.status < 600) {
                // Server error
                const errorData = await response.json().catch(() => ({})) as { error?: { message?: string } };
                const errorMessage = errorData.error?.message || `Server error ${response.status}`;
                
                console.warn(`⚠️ Server error (attempt ${attempt + 1}/${maxRetries + 1}): ${errorMessage}`);
                
                lastError = new Error(`Server error: ${errorMessage}`);
                
                // Don't retry if this was the last attempt
                if (attempt < maxRetries) {
                    console.log(`⏳ Waiting ${delayMs}ms before retry...`);
                    await sleep(delayMs);
                    delayMs = Math.min(delayMs * backoffMultiplier, maxDelayMs);
                    continue;
                }
            }

            // Success or non-retryable error
            return response;
        } catch (error) {
            // Network error or other exception
            console.warn(`⚠️ Network error (attempt ${attempt + 1}/${maxRetries + 1}):`, error);
            lastError = error instanceof Error ? error : new Error(String(error));
            
            // Don't retry if this was the last attempt
            if (attempt < maxRetries) {
                console.log(`⏳ Waiting ${delayMs}ms before retry...`);
                await sleep(delayMs);
                delayMs = Math.min(delayMs * backoffMultiplier, maxDelayMs);
                continue;
            }
        }
    }

    // All retries exhausted
    throw lastError || new Error('All retry attempts failed');
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

