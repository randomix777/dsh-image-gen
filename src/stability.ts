/** Stability AI image generation adapter (multipart form POST). */
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { fetchWithRetry } from './http.js'

const ERROR_LIMIT = 4096

export interface StabilityImageOptions {
  apiKey: string
  baseURL: string
  model: string
  prompt: string
  size: string
  maxBytes: number
  signal: AbortSignal
}

/** Stable Diffusion XL style ratios mapped to aspect labels. */
const RATIO_MAP: Record<string, string> = {
  '1:1': '1:1',
  '3:4': '3:4',
  '4:3': '4:3',
  '9:16': '9:16',
  '16:9': '16:9',
  '2:3': '2:3',
  '3:2': '3:2',
}

export async function generateStabilityImage(input: StabilityImageOptions): Promise<{ data: Uint8Array; mediaType: ImageMediaType }> {
  const label = 'Stability image generation'
  const form = new FormData()
  form.append('model', input.model)
  form.append('prompt', input.prompt)
  form.append('width', parseWidth(input.size))
  form.append('height', parseHeight(input.size))
  form.append('output_format', 'png')
  form.append('num_inference_steps', '30')

  const response = await fetchWithRetry(`${input.baseURL}/v1beta/generation`, {
    method: 'POST',
    redirect: 'error',
    headers: { authorization: `Bearer ${input.apiKey}` },
    body: form,
  }, { signal: input.signal })

  const text = await readBoundedText(response, Math.ceil(input.maxBytes * 1.4) + ERROR_LIMIT, label)
  if (!response.ok) throw new Error(`${label} failed (${response.status}): ${text.slice(0, ERROR_LIMIT)}`)

  // Text error response
  let mediaType: ImageMediaType | undefined
  let imageData: Uint8Array | undefined
  try {
    const json = JSON.parse(text) as { artifacts?: Array<{ base64?: string; finish_reason?: string }> }
    if (json.artifacts?.[0]?.base64) {
      const decoded = Buffer.from(json.artifacts[0].base64, 'base64')
      if (decoded.length > input.maxBytes) throw new Error(`${label} exceeded limit`)
      imageData = new Uint8Array(decoded)
      mediaType = 'image/png'
    }
  } catch {
    // Not JSON — try as raw image bytes
  }

  if (imageData !== undefined) {
    if (imageData.byteLength > input.maxBytes) throw new Error(`${label} exceeded the ${String(input.maxBytes)} byte limit`)
    return { data: imageData, mediaType: 'image/png' }
  }

  // Fallback: response might be raw image bytes already
  const contentType = response.headers.get('content-type')
  if (contentType?.startsWith('image/')) {
    const buffer = await readBoundedBytes(response, input.maxBytes)
    if (buffer.byteLength > input.maxBytes) throw new Error(`Image exceeded the ${String(input.maxBytes)} byte limit`)
    return { data: buffer, mediaType: contentType.includes('png') ? 'image/png' : 'image/jpeg' }
  }

  throw new Error(`${label} returned no image data: ${text.slice(0, ERROR_LIMIT)}`)
}

function parseWidth(size: string): string {
  const m = size.match(/^(\d+)x/)
  return m?.[1] ?? '1024'
}

function parseHeight(size: string): string {
  const m = size.match(/x(\d+)$/)
  return m?.[1] ?? '1024'
}

async function readBoundedText(response: Response, maxBytes: number, label: string): Promise<string> {
  return new TextDecoder().decode(await readBoundedBytes(response, maxBytes))
}

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > maxBytes) throw new Error(`Image response exceeded the ${String(maxBytes)} byte limit`)
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const joined = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
  return joined
}
