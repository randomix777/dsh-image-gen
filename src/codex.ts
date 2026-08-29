/** ChatGPT Codex subscription OAuth image adapter with streaming preview. */
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { fetchWithRetry } from './http.js'

const ERROR_LIMIT = 4096
const SSE_MAX_EVENT_BYTES = 8 * 1024 * 1024
const SSE_MAX_TOTAL_BYTES = 64 * 1024 * 1024

export interface PartialCodexImage {
  kind: 'partial'
  data: string
  mediaType: ImageMediaType | undefined
}

export interface GeneratedCodexImage {
  data: Uint8Array
  mediaType: ImageMediaType
  revisedPrompt: string | undefined
}

export type CodexProgressCallback = (event: PartialCodexImage | { kind: 'completed'; image: GeneratedCodexImage }) => void

export async function generateCodexImage(input: {
  accessToken: string
  accountId: string
  prompt: string
  size: string
  quality?: string
  maxBytes: number
  signal: AbortSignal
  count?: number
  onProgress?: CodexProgressCallback
}): Promise<GeneratedCodexImage> {
  const response = await fetch('https://chatgpt.com/backend-api/codex/images/generations', {
    method: 'POST', redirect: 'error',
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      'chatgpt-account-id': input.accountId,
      originator: 'codex_cli_rs',
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt: input.prompt,
      ...(input.size.length > 0 ? { size: input.size } : {}),
      ...(input.quality && input.quality !== 'auto' ? { quality: input.quality } : {}),
      n: input.count ?? 1,
    }),
    signal: input.signal,
  })

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('event-stream')) {
    return parseJsonFallback(response, input.maxBytes, input.signal)
  }

  if (!response.ok) throw new Error(`Codex image request failed (${response.status})`)
  if (response.body === null) throw new Error('Codex image request returned no response body')
  return parseSseStream(response.body, input.maxBytes, input.signal, input.onProgress)
}

async function parseJsonFallback(response: Response, maxBytes: number, signal: AbortSignal): Promise<GeneratedCodexImage> {
  const text = await readBoundedText(response, maxBytes * 2 + ERROR_LIMIT)
  if (!response.ok) throw new Error(`Codex image request failed (${response.status}): ${text.slice(0, ERROR_LIMIT)}`)
  let payload: unknown
  try { payload = JSON.parse(text) } catch { throw new Error('Codex image request returned invalid JSON') }
  const record = payload as { data?: Array<{ b64_json?: string; mime_type?: string; revised_prompt?: string }> }
  const entries = Array.isArray(record?.data) ? record.data : []
  if (entries.length === 0) throw new Error('Codex image request returned no image data')
  const entry = entries[0]
  if (!entry || typeof entry.b64_json !== 'string' || entry.b64_json.length === 0) throw new Error('Codex image request returned no base64 data')
  const decoded = Buffer.from(entry.b64_json.replace(/\s+/g, ''), 'base64')
  if (decoded.length === 0) throw new Error('Codex image request returned empty image data')
  if (decoded.byteLength > maxBytes) throw new Error(`Codex image exceeded ${maxBytes} bytes`)
  return { data: decoded, mediaType: sniffMediaType(decoded, entry.mime_type), revisedPrompt: typeof entry.revised_prompt === 'string' ? entry.revised_prompt : undefined }
}

async function parseSseStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal: AbortSignal,
  onProgress?: CodexProgressCallback,
): Promise<GeneratedCodexImage> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let totalBytes = 0
  let finalImage: GeneratedCodexImage | undefined

  const abort = () => { void reader.cancel(signal.reason).catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })

  try {
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > SSE_MAX_TOTAL_BYTES) throw new Error('Codex SSE stream exceeded size limit')
      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '')

      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        if (boundary > SSE_MAX_EVENT_BYTES) throw new Error('Codex SSE event exceeded size limit')
        processSseEvent(buffer.slice(0, boundary), maxBytes, signal, (event) => {
          if ('kind' in event && (event as any).kind === 'partial' && onProgress) onProgress(event)
          if ('image' in event) finalImage = (event as any).image
        })
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')
      }
      if (buffer.length > SSE_MAX_EVENT_BYTES) throw new Error('Codex SSE event exceeded size limit')
    }

    if (buffer.trim().length > 0) {
      processSseEvent(buffer.trim(), maxBytes, signal, (event) => {
        if ('image' in event) finalImage = (event as any).image
      })
    }
  } finally {
    signal.removeEventListener('abort', abort)
    if (finalImage === undefined) {
      try { await reader.cancel(signal.reason) } catch {}
    }
    reader.releaseLock()
  }

  if (finalImage === undefined) throw new Error('Codex image generation did not return a completed image')
  return finalImage
}

function processSseEvent(
  block: string,
  maxBytes: number,
  signal: AbortSignal,
  callback: (event: PartialCodexImage | { kind: 'completed'; image: GeneratedCodexImage }) => void,
): void {
  const lines = block.split('\n')
  let eventType = ''
  let eventData = ''

  for (const line of lines) {
    if (line.startsWith('event:')) eventType = line.slice(6).trim()
    else if (line.startsWith('data:')) eventData += line.slice(5).trimStart() + '\n'
  }

  if (!eventData) return

  if (eventType === 'image_generation.partial' || eventType === 'partial') {
    let parsed: { b64_json?: string; mime_type?: string } | undefined
    try { parsed = JSON.parse(eventData) as typeof parsed } catch { return }
    if (!parsed || typeof parsed.b64_json !== 'string' || parsed.b64_json.length === 0) return
    callback({ kind: 'partial', data: parsed.b64_json, mediaType: parsed.mime_type as ImageMediaType | undefined })
  }

  if (eventType === 'image_generation.completed' || eventType === 'completed') {
    let parsed: { b64_json?: string; mime_type?: string; revised_prompt?: string } | undefined
    try { parsed = JSON.parse(eventData) as typeof parsed } catch { return }
    if (!parsed || typeof parsed.b64_json !== 'string' || parsed.b64_json.length === 0) return
    const decoded = Buffer.from(parsed.b64_json.replace(/\s+/g, ''), 'base64')
    if (decoded.length === 0) return
    if (decoded.byteLength > maxBytes) throw new Error(`Codex image exceeded ${maxBytes} bytes`)
    callback({ kind: 'completed', image: { data: decoded, mediaType: sniffMediaType(decoded, parsed.mime_type), revisedPrompt: typeof parsed.revised_prompt === 'string' ? parsed.revised_prompt : undefined } })
  }

  if ((eventType === 'image_generation.error' || eventType === 'error') && eventData) {
    let parsed: { message?: string } | undefined
    try { parsed = JSON.parse(eventData) as typeof parsed } catch { return }
    throw new Error(`Codex image generation error: ${parsed?.message ?? eventData}`)
  }
}

function sniffMediaType(data: Uint8Array, mimeHint?: string): ImageMediaType {
  if (mimeHint === 'image/jpeg' || mimeHint === 'image/webp' || mimeHint === 'image/png') return mimeHint as ImageMediaType
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (data.length >= 12 && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250) return 'image/webp'
  return 'image/png'
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
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
      if (bytes > maxBytes) throw new Error(`Response exceeded ${maxBytes} bytes`)
      chunks.push(next.value)
    }
  } finally { reader.releaseLock() }
  const joined = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
  return joined
}
