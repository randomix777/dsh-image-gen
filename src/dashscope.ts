/** DashScope Qwen Image generation and editing adapter. */
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { fetchWithRetry } from './http.js'

const ERROR_LIMIT = 4096

export interface DashScopeImageOptions {
  apiKey: string
  endpoint: string
  model: string
  prompt: string
  size?: string
  maxBytes: number
  signal?: AbortSignal
  count?: number
}

export interface DashScopeEditOptions extends DashScopeImageOptions {
  sourceImages: Array<{ data: Uint8Array; mediaType: ImageMediaType }>
}

interface DashScopeChoiceMessageContent {
  text?: string
  image?: string
  image_url?: string
  url?: string
}

interface DashScopeResponse {
  output?: {
    choices?: Array<{ message?: { content?: DashScopeChoiceMessageContent[] } }>
  }
  message?: string
  code?: string
}

export async function generateDashScopeImage(options: DashScopeImageOptions): Promise<{
  data: Uint8Array
  mediaType: ImageAttachmentRef['mediaType']
}> {
  assertQwenImageModel(options.model)
  const formattedSize = formatSize(options.size)
  return requestQwenImage({
    ...options,
    requestBody: {
      model: options.model,
      input: {
        messages: [{ role: 'user', content: [{ text: options.prompt }] }],
      },
      parameters: {
        ...(formattedSize === undefined ? {} : { size: formattedSize }),
        ...(options.count !== undefined && options.count > 1 ? { n: options.count } : {}),
      },
    },
    operation: 'generation',
  })
}

export async function editDashScopeImage(options: DashScopeEditOptions): Promise<{
  data: Uint8Array
  mediaType: ImageAttachmentRef['mediaType']
}> {
  assertQwenImageModel(options.model)
  const formattedSize = formatSize(options.size)
  return requestQwenImage({
    ...options,
    requestBody: {
      model: options.model,
      input: {
        messages: [{
          role: 'user',
          content: [
            ...options.sourceImages.map(sourceImage => ({ image: toDataUrl(sourceImage) })),
            { text: options.prompt },
          ],
        }],
      },
      parameters: {
        prompt_extend: true,
        ...(formattedSize === undefined ? {} : { size: formattedSize }),
        ...(options.count !== undefined && options.count > 1 ? { n: options.count } : {}),
      },
    },
    operation: 'editing',
  })
}

function assertQwenImageModel(model: string): void {
  if (!model.toLowerCase().startsWith('qwen-image')) {
    throw new Error(`Unsupported DashScope image model ${model}. Configure a qwen-image model.`)
  }
}

function formatSize(size: string | undefined): string | undefined {
  if (size === undefined || size.length === 0) return undefined
  return size.replace('x', '*')
}

function toDataUrl(image: { data: Uint8Array; mediaType: ImageMediaType }): string {
  return `data:${image.mediaType};base64,${Buffer.from(image.data).toString('base64')}`
}

async function requestQwenImage(options: DashScopeImageOptions & {
  requestBody: unknown
  operation: 'generation' | 'editing'
}): Promise<{ data: Uint8Array; mediaType: ImageAttachmentRef['mediaType'] }> {
  const base = options.endpoint.replace(/\/+$/, '')
  const response = await fetchWithRetry(`${base}/services/aigc/multimodal-generation/generation`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(options.requestBody),
  }, { ...(options.signal === undefined ? {} : { signal: options.signal }) })

  const text = await readBoundedText(response, Math.ceil(options.maxBytes * 1.4) + ERROR_LIMIT)
  if (!response.ok) {
    throw new Error(`DashScope image ${options.operation} failed (${String(response.status)}): ${text.slice(0, ERROR_LIMIT)}`)
  }

  let payload: DashScopeResponse
  try {
    payload = JSON.parse(text) as DashScopeResponse
  } catch {
    throw new Error(`DashScope image ${options.operation} returned invalid JSON`)
  }
  const imageUrl = extractImageUrl(payload)
  if (imageUrl === undefined) {
    throw new Error(`DashScope image ${options.operation} returned no image URL: ${payload.message ?? JSON.stringify(payload)}`)
  }
  return downloadImageBlob(imageUrl, options)
}

function extractImageUrl(response: DashScopeResponse): string | undefined {
  const contents = response.output?.choices?.[0]?.message?.content
  if (!Array.isArray(contents)) return undefined
  for (const item of contents) {
    if (item.image !== undefined && item.image.length > 0) return item.image
    if (item.image_url !== undefined && item.image_url.length > 0) return item.image_url
    if (item.url !== undefined && item.url.length > 0) return item.url
  }
  return undefined
}

async function downloadImageBlob(
  imageUrl: string,
  options: DashScopeImageOptions,
): Promise<{ data: Uint8Array; mediaType: ImageAttachmentRef['mediaType'] }> {
  const imageResponse = await fetchWithRetry(imageUrl, {}, { retries: 2, ...(options.signal === undefined ? {} : { signal: options.signal }) })
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch DashScope image from URL (${String(imageResponse.status)})`)
  }
  const buffer = await readBoundedBytes(imageResponse, options.maxBytes)
  const contentType = imageResponse.headers.get('content-type')
  const mediaType: ImageAttachmentRef['mediaType'] =
    contentType?.includes('png') ? 'image/png' :
    contentType?.includes('webp') ? 'image/webp' :
    'image/jpeg'
  return { data: buffer, mediaType }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readBoundedBytes(response, maxBytes))
}

/** Stream the body with a hard byte cap so a runaway response cannot OOM. */
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
      if (bytes > maxBytes) throw new Error(`DashScope image response exceeded the ${String(maxBytes)} byte limit`)
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
