/** Zhipu AI GLM-Image adapter (URL-only response, downloads to bytes). */
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { fetchWithRetry } from './http.js'

const ERROR_LIMIT = 4096

export interface GlmImageOptions {
  apiKey: string
  baseURL: string
  model: string
  prompt: string
  size: string
  maxBytes: number
  signal: AbortSignal
}

export async function generateGlmImage(input: GlmImageOptions): Promise<{ data: Uint8Array; mediaType: ImageMediaType }> {
  const label = 'GLM image generation'
  const response = await fetchWithRetry(`${input.baseURL}/images/generations`, {
    method: 'POST',
    redirect: 'error',
    headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: input.model, prompt: input.prompt, size: input.size }),
  }, { signal: input.signal })

  const text = await readBoundedText(response, Math.ceil(input.maxBytes * 1.4) + ERROR_LIMIT, label)
  if (!response.ok) throw new Error(`${label} failed (${response.status}): ${text.slice(0, ERROR_LIMIT)}`)
  let payload: unknown
  try { payload = JSON.parse(text) } catch { throw new Error(`${label} returned invalid JSON`) }
  const url = extractImageUrl(payload)
  if (url === undefined) throw new Error(`${label} returned no image URL: ${text.slice(0, ERROR_LIMIT)}`)
  return downloadImage(url, label, { maxBytes: input.maxBytes, signal: input.signal })
}

function extractImageUrl(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as { data?: unknown }
  const data = Array.isArray(record.data) ? record.data : undefined
  if (data === undefined || data.length === 0) return undefined
  const item = data[0] as { url?: unknown }
  return typeof item.url === 'string' ? item.url : undefined
}

async function downloadImage(
  url: string,
  label: string,
  input: { maxBytes: number; signal: AbortSignal },
): Promise<{ data: Uint8Array; mediaType: ImageMediaType }> {
  const response = await fetchWithRetry(url, {}, { signal: input.signal, retries: 2 })
  if (!response.ok) throw new Error(`${label} image download failed (${response.status})`)
  const buffer = await readBoundedBytes(response, input.maxBytes)
  const contentType = response.headers.get('content-type')
  const mediaType: ImageMediaType =
    contentType?.includes('png') ? 'image/png' :
    contentType?.includes('webp') ? 'image/webp' :
    contentType?.includes('gif') ? 'image/gif' :
    'image/jpeg'
  return { data: buffer, mediaType }
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
