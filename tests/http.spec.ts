import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithRetry, withTimeout } from '../src/http.js'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('withTimeout', () => {
  it('returns the parent signal when no timeout is requested', () => {
    const signal = new AbortController().signal
    const { signal: out, cleanup } = withTimeout(signal, 0)
    expect(out).toBe(signal)
    cleanup()
  })

  it('creates a timed signal that reflects a parent abort', () => {
    const controller = new AbortController()
    const { signal, cleanup } = withTimeout(controller.signal, 10_000)
    expect(signal?.aborted).toBe(false)
    controller.abort()
    expect(signal?.aborted).toBe(true)
    cleanup()
  })
})

describe('fetchWithRetry', () => {
  it('resolves a successful response without retrying', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchWithRetry('https://example.com', {}, { signal: new AbortController().signal, retries: 2 })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry a 4xx client error', async () => {
    const fetchMock = vi.fn(async () => new Response('no', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchWithRetry('https://example.com', {}, { signal: new AbortController().signal, retries: 2 })
    expect(res.status).toBe(403)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a 5xx with backoff then succeeds', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const promise = fetchWithRetry('https://example.com', {}, { signal: new AbortController().signal, retries: 2 })
    await vi.advanceTimersByTimeAsync(1_100)
    const res = await promise
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('propagates an abort immediately without retrying', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMock = vi.fn(async () => { throw new DOMException('The operation was aborted.', 'AbortError') })
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchWithRetry('https://example.com', {}, { signal: controller.signal, retries: 3 }))
      .rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
