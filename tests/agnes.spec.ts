import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateAgnesImage, editAgnesImage } from '../src/agnes.js'

const signal = new AbortController().signal
const baseURL = 'https://apihub.agnes-ai.com/v1'
const image = Buffer.from('image bytes').toString('base64')

afterEach(() => { vi.unstubAllGlobals() })

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

describe('generateAgnesImage', () => {
  it('posts to the correct endpoint with b64_json format', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ b64_json: image, url: null }] }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateAgnesImage({
      apiKey: 'agnes-key',
      baseURL,
      model: 'agnes-image-2.1-flash',
      prompt: 'a bright cat',
      size: '1K',
      maxBytes: 1024,
      signal,
    })).resolves.toEqual({ data: new Uint8Array(Buffer.from('image bytes')), mediaType: 'image/png' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://apihub.agnes-ai.com/v1/images/generations')
    expect(init.headers).toMatchObject({ 'content-type': 'application/json', authorization: 'Bearer agnes-key' })
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('agnes-image-2.1-flash')
    expect(body.prompt).toBe('a bright cat')
    expect(body.size).toBe('1K')
    expect(body.extra_body).toEqual({ response_format: 'b64_json' })
  })

  it('includes ratio when provided', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ b64_json: image, url: null }] }))
    vi.stubGlobal('fetch', fetchMock)
    await generateAgnesImage({
      apiKey: 'key', baseURL, model: 'agnes-image-2.1-flash', prompt: 'cat',
      size: '2K', ratio: '16:9', maxBytes: 1024, signal,
    })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.ratio).toBe('16:9')
    expect(body.size).toBe('2K')
  })
})

describe('editAgnesImage', () => {
  it('includes source images as data URIs in extra_body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ b64_json: image, url: null }] }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(editAgnesImage({
      apiKey: 'agnes-key',
      baseURL,
      model: 'agnes-image-2.1-flash',
      prompt: 'make it orange',
      sourceImages: [
        { data: new Uint8Array(Buffer.from('source image')), mediaType: 'image/png' },
      ],
      size: '1K',
      maxBytes: 1024,
      signal,
    })).resolves.toMatchObject({ mediaType: 'image/png' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.extra_body.image).toHaveLength(1)
    expect(body.extra_body.image[0]).toMatch(/^data:image\/png;base64,/)
    expect(body.extra_body.response_format).toBe('b64_json')
  })
})
