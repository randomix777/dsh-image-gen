import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateGlmImage } from '../src/glm.js'

const signal = new AbortController().signal
const baseURL = 'https://open.bigmodel.cn/api/paas/v4'
const imagePngBytes = Buffer.from('fake-glm-png-bytes')

afterEach(() => { vi.unstubAllGlobals() })

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function imageResponse(bytes: Buffer, contentType = 'image/png'): Response {
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': contentType },
  })
}

describe('generateGlmImage', () => {
  it('posts to the correct endpoint with url-only response then downloads', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/images/generations')) {
        return jsonResponse({ data: [{ url: 'https://example.com/glm-result.png' }] })
      }
      return imageResponse(imagePngBytes, 'image/png')
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateGlmImage({
      apiKey: 'zhipu-key',
      baseURL,
      model: 'glm-image',
      prompt: 'a cute cat',
      size: '1280x1280',
      maxBytes: 1024 * 1024,
      signal,
    })

    expect(result.mediaType).toBe('image/png')
    expect(result.data).toEqual(new Uint8Array(imagePngBytes))

    const [submitUrl, submitInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(submitUrl).toBe('https://open.bigmodel.cn/api/paas/v4/images/generations')
    expect(submitInit.headers).toMatchObject({ 'content-type': 'application/json', authorization: 'Bearer zhipu-key' })
    expect(JSON.parse(submitInit.body as string)).toEqual({
      model: 'glm-image',
      prompt: 'a cute cat',
      size: '1280x1280',
    })
  })

  it('throws on upstream error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Unauthorized', { status: 401 })))
    await expect(generateGlmImage({
      apiKey: 'bad-key', baseURL, model: 'glm-image', prompt: 'test', size: '1280x1280', maxBytes: 1024, signal,
    })).rejects.toThrow('GLM image generation failed (401)')
  })

  it('throws when no image URL in response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [] })))
    await expect(generateGlmImage({
      apiKey: 'key', baseURL, model: 'glm-image', prompt: 'test', size: '1280x1280', maxBytes: 1024, signal,
    })).rejects.toThrow('returned no image URL')
  })
})
