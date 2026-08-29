/** ChatGPT Codex subscription OAuth image adapter. */
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { fetchWithRetry } from './http.js'

const ERROR_LIMIT = 4096

export interface GeneratedCodexImage {
  data: Uint8Array
  mediaType: ImageMediaType
}

export async function generateCodexImage(input: {
  accessToken: string
  accountId: string
  prompt: string
  size: string
  quality?: string
  maxBytes: number
  signal: AbortSignal
  count?: number
}): Promise<GeneratedCodexImage> {
  const response = await fetchWithRetry('https://chatgpt.com/backend-api/codex/images/generations', {
    method: 'POST', redirect: 'error',
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      'chatgpt-account-id': input.accountId,
      originator: 'codex_cli_rs',
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt: input.prompt,
      ...(input.size.length > 0 ? { size: input.size } : {}),
      ...(input.quality && input.quality !== 'auto' ? { quality: input.quality } : {}),
      n: input.count ?? 1,
    }),
  }, { signal: input.signal })
  const text = await readBoundedText(response, input.maxBytes * 2 + ERROR_LIMIT)
  if (!response.ok) throw new Error(`Codex image request failed (${response.status}): ${text.slice(0, ERROR_LIMIT)}`)
  let payload: unknown
  try { payload = JSON.parse(text) } catch { throw new Error('Codex image request returned invalid JSON') }
  const record = payload as { data?: Array<{ b64_json?: string; mime_type?: string }> }
  const entries = Array.isArray(record?.data) ? record.data : []
  if (entries.length === 0) throw new Error('Codex image request returned no image data')
  const entry = entries[0]
  if (!entry || typeof entry.b64_json !== 'string' || entry.b64_json.length === 0) throw new Error('Codex image request returned no base64 data')
  const decoded = Buffer.from(entry.b64_json.replace(/\s+/g, ''), 'base64')
  if (decoded.length === 0) throw new Error('Codex image request returned empty image data')
  if (decoded.byteLength > input.maxBytes) throw new Error(`Codex image exceeded ${input.maxBytes} bytes`)
  const mediaType = sniffMediaType(decoded, entry.mime_type)
  return { data: decoded, mediaType }
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
