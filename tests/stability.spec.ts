import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateStabilityImage } from '../src/stability.js'

const signal = new AbortController().signal
const baseURL = 'https://api.stability.ai'
const imagePngBytes = Buffer.from('fake-stability-png-bytes')

afterEach(() => { vi.unstubAllGlobals() })

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

describe('generateStabilityImage', () => {
  it('posts with correct model, prompt, and dimensions', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      artifacts: [{ base64: Buffer.from('stability-b64').toString('base64'), finish_reason: 'SUCCESS' }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateStabilityImage({
      apiKey: 'stability-key',
      baseURL,
      model: 'stable-diffusion-xl-1.0',
      prompt: 'a cat',
      size: '1024x1024',
      maxBytes: 1024 * 1024,
      signal,
    })

    expect(result.mediaType).toBe('image/png')
    expect(result.data).toEqual(new Uint8Array(Buffer.from('stability-b64')))

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ authorization: 'Bearer stability-key' })
    const form = init.body as FormData
    expect(form.get('model')).toBe('stable-diffusion-xl-1.0')
    expect(form.get('prompt')).toBe('a cat')
    expect(form.get('width')).toBe('1024')
    expect(form.get('height')).toBe('1024')
  })

  it('throws on upstream error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Forbidden', { status: 403 })))
    await expect(generateStabilityImage({
      apiKey: 'bad-key', baseURL, model: 'model', prompt: 'test', size: '1024x1024', maxBytes: 1024, signal,
    })).rejects.toThrow('Stability image generation failed (403)')
  })

  it('throws when no image data returned', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ artifacts: [] })))
    await expect(generateStabilityImage({
      apiKey: 'key', baseURL, model: 'model', prompt: 'test', size: '1024x1024', maxBytes: 1024, signal,
    })).rejects.toThrow('returned no image data')
  })
})
