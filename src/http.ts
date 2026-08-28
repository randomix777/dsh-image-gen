/**
 * Shared HTTP primitives for provider adapters.
 *
 * Adds a hard request timeout and optional exponential-backoff retry on top of
 * the caller-provided AbortSignal. Timeouts apply to every request so a hung
 * upstream can never leave a tool call running forever. Retries are opt-in and
 * meant for idempotent GET downloads only: generation/edit POST requests are
 * never retried automatically because an interrupted upload is not safely
 * idempotent (avoid double-billing).
 */

/** Default wall-clock timeout for a single HTTP attempt, in milliseconds. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000

/**
 * Build an AbortSignal that fires when either the parent signal aborts or the
 * timeout elapses, whichever comes first. Returns undefined signal when no
 * timeout is requested and no parent signal is provided.
 */
export function withTimeout(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal | null; cleanup: () => void } {
  if (timeoutMs <= 0) return { signal: parent ?? null, cleanup: () => {} }
  // AbortSignal.timeout gives us the timeout half; combine with the parent.
  const timeout = AbortSignal.timeout(timeoutMs)
  if (parent === undefined) return { signal: timeout, cleanup: () => {} }
  if (parent.aborted) return { signal: parent, cleanup: () => {} }

  const controller = new AbortController()
  const onParentAbort = () => controller.abort()
  const onTimeout = () => controller.abort()
  parent.addEventListener('abort', onParentAbort, { once: true })
  timeout.addEventListener('abort', onTimeout, { once: true })
  controller.signal.addEventListener('abort', () => {
    parent.removeEventListener('abort', onParentAbort)
    timeout.removeEventListener('abort', onTimeout)
  }, { once: true })
  return {
    signal: controller.signal,
    cleanup: () => {
      parent.removeEventListener('abort', onParentAbort)
      timeout.removeEventListener('abort', onTimeout)
    },
  }
}

/** True for HTTP statuses worth retrying: 429 and all 5xx. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599)
}

const RETRYABLE_DELAYS_MS = [1_000, 2_500, 5_000]
const MAX_RETRY_INDEX = RETRYABLE_DELAYS_MS.length - 1

/**
 * Fetch with a hard timeout and, when `retries` is set, exponential-backoff
 * retry on transient network failures and retryable HTTP statuses (429/5xx).
 * A caller abort always surfaces immediately and never triggers a retry.
 *
 * @returns the successful Response (consumer still checks `.ok` as usual).
 */
export async function fetchWithRetry(
  input: string | URL | Request,
  init: RequestInit = {},
  options: {
    signal?: AbortSignal
    timeoutMs?: number
    retries?: number
    onRetry?: (attempt: number, error: unknown) => void
  } = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const retries = options.retries ?? 0
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const { signal, cleanup } = withTimeout(options.signal, timeoutMs)
    try {
      const fetchInit: RequestInit = { ...init }
      if (signal !== null) fetchInit.signal = signal
      const response = await fetch(input, fetchInit)
      cleanup()
      if (!isRetryableStatus(response.status) || attempt === retries) {
        return response
      }
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      cleanup()
      // Never swallow an intentional cancellation.
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      if (error instanceof Error && error.name === 'AbortError') throw error
      if (attempt === retries) throw error
      lastError = error
    }
    options.onRetry?.(attempt + 1, lastError)
    const delayMs = RETRYABLE_DELAYS_MS[Math.min(attempt, MAX_RETRY_INDEX)]
    if (delayMs === undefined) throw new Error('fetch failed')
    await sleep(delayMs)
  }
  throw lastError ?? new Error('fetch failed')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
