/** Agnes AI Image 2.1 Flash adapter (OpenAI-compatible with extra_body for images). */
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { fetchWithRetry } from './http.js'
import type { GeneratedCompatibleImage } from './openai-compatible.js'

const ERROR_LIMIT = 4096

/**
 * Agnes extra_body payload for image input and response format control.
 * Images are supplied as public URLs or Data URI base64 strings.
 */
interface AgnesExtraBody {
  image?: string[]
  response_format?: 'url' | 'b64_json'
}

export interface AgnesImageOptions {
  apiKey: string
  baseURL: string
  model: string
  prompt: string
  size: string
  maxBytes: number
  signal: AbortSignal
  /** Aspect ratio such as "1:1", "16:9", etc. Defaults to "1:1". */
  ratio?: string
}

export interface AgnesEditOptions extends AgnesImageOptions {
  sourceImages: Array<{ data: Uint8Array; mediaType: ImageMediaType }>
}

/** Generate one image via Agnes AI text-to-image. */
export async function generateAgnesImage(input: AgnesImageOptions): Promise<GeneratedCompatibleImage> {
  return requestAgnesImage({
    ...input,
    extraBody: { response_format: 'b64_json' },
  })
}

/** Edit one image via Agnes AI with source image(s). */
export async function editAgnesImage(input: AgnesEditOptions): Promise<GeneratedCompatibleImage> {
  const images = input.sourceImages.map(toDataUrl)
  return requestAgnesImage({
    ...input,
    extraBody: { image: images, response_format: 'b64_json' },
  })
}

interface AgnesRequestBase extends Omit<AgnesImageOptions, 'sourceImages'> {
  extraBody: AgnesExtraBody
}

async function requestAgnesImage(input: AgnesRequestBase): Promise<GeneratedCompatibleImage> {
  const label = 'Agnes image generation'
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    size: input.size,
    ...(typeof input.ratio === 'string' && input.ratio.length > 0 ? { ratio: input.ratio } : {}),
    extra_body: input.extraBody,
  }
  const response = await fetchWithRetry(
    `${input.baseURL.endsWith('/') ? input.baseURL : `${input.baseURL}/`}` + 'images/generations',
    {
      method: 'POST',
      redirect: 'error',
      headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    { signal: input.signal },
  )
  return parseImageResponse(response, label, input.maxBytes)
}

async function parseImageResponse(
  response: Response,
  label: string,
  maxBytes: number,
): Promise<GeneratedCompatibleImage> {
  const text = await readBoundedText(response, Math.ceil(maxBytes * 1.4) + ERROR_LIMIT, label)
  if (!response.ok) throw new Error(`${label} failed (${response.status}): ${text.slice(0, ERROR_LIMIT)}`)
  let payload: unknown
  try { payload = JSON.parse(text) } catch { throw new Error(`${label} returned invalid JSON`) }
  const image = firstImage(payload)
  if (image === undefined) throw new Error(`${label} returned no image: ${text.slice(0, ERROR_LIMIT)}`)
  if (image.b64_json !== undefined) {
    const data = decodeBase64(image.b64_json, label)
    const mediaType = imageMediaType(image.mime_type) ?? 'image/png'
    if (data.byteLength > maxBytes) throw new Error(`${label} exceeded the ${String(maxBytes)} byte image limit`)
    return { data, mediaType }
  }
  if (image.url !== undefined) return downloadImage(image.url, label, { maxBytes, signal: undefined })
  throw new Error(`${label} returned no image data`)
}

function firstImage(value: unknown): { b64_json?: string; url?: string; mime_type?: string } | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as { data?: unknown }
  const data = Array.isArray(record.data) ? record.data : undefined
  if (data === undefined || data.length === 0) return undefined
  const candidate = data[0]
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return undefined
  const item = candidate as { b64_json?: unknown; url?: unknown; mime_type?: unknown; mime?: unknown }
  const mime = typeof item.mime_type === 'string' ? item.mime_type : typeof item.mime === 'string' ? item.mime : undefined
  return typeof item.b64_json === 'string'
    ? { b64_json: item.b64_json, ...(mime === undefined ? {} : { mime_type: mime }) }
    : typeof item.url === 'string'
      ? { url: item.url, ...(mime === undefined ? {} : { mime_type: mime }) }
      : undefined
}

async function downloadImage(
  url: string,
  label: string,
  input: { maxBytes: number; signal: AbortSignal | undefined },
): Promise<GeneratedCompatibleImage> {
  const response = await fetchWithRetry(url, {}, { retries: 2, ...(input.signal === undefined ? {} : { signal: input.signal }) })
  if (!response.ok) throw new Error(`${label} image download failed (${response.status})`)
  const mediaType = imageMediaType(response.headers.get('content-type'))
  if (mediaType === undefined) throw new Error(`${label} image download returned unsupported content type`)
  const data = await readBoundedBytes(response, input.maxBytes)
  return { data, mediaType }
}

function toDataUrl(image: { data: Uint8Array; mediaType: ImageMediaType }): string {
  return `data:${image.mediaType};base64,${Buffer.from(image.data).toString('base64')}`
}

function decodeBase64(value: string, label: string): Uint8Array {
  const clean = value.replace(/\s+/g, '')
  if (clean.length === 0) throw new Error(`${label} returned invalid base64 image data`)
  const decoded = Buffer.from(clean, 'base64')
  if (decoded.length === 0) throw new Error(`${label} returned invalid base64 image data`)
  return new Uint8Array(decoded)
}

function imageMediaType(value: string | null | undefined): ImageMediaType | undefined {
  const mt = value?.split(';', 1)[0]?.trim().toLowerCase()
  return mt === 'image/png' || mt === 'image/jpeg' || mt === 'image/webp' || mt === 'image/gif' ? mt : undefined
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
