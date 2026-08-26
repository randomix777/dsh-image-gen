/** Latest-DSH compatibility boundary for resolving conversation image references. */
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type {
  ImageAttachmentRef,
  ImageMediaType,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'

/** Provider-neutral image bytes passed across the DSH/provider boundary. */
export interface ResolvedReferenceImage {
  data: Uint8Array
  mediaType: ImageMediaType
}

/** The small latest-DSH session surface this Bundle depends on. */
export interface ReferenceImageAgent {
  session: {
    deriveMessages(): readonly Message[]
    header?: { cwd?: string }
  }
}

/** The small latest-DSH attachment surface this Bundle depends on. */
export interface ReferenceImageStore {
  readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>
}

/**
 * Resolve and read the image to edit from the current effective conversation.
 *
 * This is the only module allowed to know how DSH sessions expose effective
 * messages or how nested model-facing content stores durable image refs.
 */
export async function resolveReferenceImage(input: {
  agent?: ReferenceImageAgent
  attachments: ReferenceImageStore
  sourceAttachmentId?: string
  sourcePath?: string
  maxBytes?: number
  signal: AbortSignal
}): Promise<ResolvedReferenceImage> {
  if (input.sourceAttachmentId !== undefined && input.sourcePath !== undefined) {
    throw new Error('edit_image accepts either source_attachment_id or source_path, not both')
  }

  if (input.sourcePath !== undefined) {
    return readWorkspaceReferenceImage({
      sourcePath: input.sourcePath,
      ...(input.agent?.session.header?.cwd === undefined ? {} : { workspaceRoot: input.agent.session.header.cwd }),
      ...(input.maxBytes === undefined ? {} : { maxBytes: input.maxBytes }),
      signal: input.signal,
    })
  }

  if (input.agent === undefined) {
    throw new Error('edit_image requires an active DSH agent session to resolve a reference image')
  }

  const ref = findReferenceImage(input.agent.session.deriveMessages(), input.sourceAttachmentId)
  if (ref === undefined) {
    if (input.sourceAttachmentId !== undefined) {
      throw new Error(`edit_image could not find image attachment ${input.sourceAttachmentId} in the current conversation`)
    }
    throw new Error('edit_image requires an image in the current conversation; upload or generate an image first')
  }

  const stored = await input.attachments.readImage(ref, input.signal)
  return { data: stored.data, mediaType: stored.ref.mediaType }
}

/**
 * Read an explicitly named workspace image without exposing filesystem or DSH
 * details to provider adapters. Both lexical and real-path containment are
 * enforced so absolute paths, parent traversal, and symlink escapes fail.
 */
async function readWorkspaceReferenceImage(input: {
  sourcePath: string
  workspaceRoot?: string
  maxBytes?: number
  signal: AbortSignal
}): Promise<ResolvedReferenceImage> {
  const requested = input.sourcePath.trim()
  if (requested.length === 0) throw new Error('edit_image source_path must not be empty')
  if (input.workspaceRoot === undefined) {
    throw new Error('edit_image source_path requires an active DSH session workspace')
  }

  const root = resolve(input.workspaceRoot)
  const candidate = isAbsolute(requested) ? resolve(requested) : resolve(root, requested)
  if (!containsPath(root, candidate)) {
    throw new Error('edit_image source_path must stay inside the session workspace: ' + requested)
  }

  let realRoot: string
  let realCandidate: string
  try {
    [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)])
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('edit_image could not find workspace image: ' + requested)
    }
    throw error
  }
  if (!containsPath(realRoot, realCandidate)) {
    throw new Error('edit_image source_path resolves outside the session workspace: ' + requested)
  }

  const file = await stat(realCandidate)
  if (!file.isFile()) throw new Error('edit_image source_path is not a file: ' + requested)
  if (input.maxBytes !== undefined && file.size > input.maxBytes) {
    throw new Error('edit_image source image is too large (' + file.size + ' bytes; maximum ' + input.maxBytes + ')')
  }

  const data = await readFile(realCandidate, { signal: input.signal })
  const mediaType = detectImageMediaType(data)
  if (mediaType === undefined) {
    throw new Error('edit_image source_path is not a supported PNG, JPEG, WebP, or GIF image: ' + requested)
  }
  return { data: new Uint8Array(data), mediaType }
}

/** Find the newest matching image in the effective, replacement-aware history. */
export function findReferenceImage(
  messages: readonly Message[],
  sourceAttachmentId?: string,
): ImageAttachmentRef | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const found = findInBlocks(messages[index]?.content ?? [], sourceAttachmentId)
    if (found !== undefined) return found
  }
  return undefined
}

/** Validate an untrusted serialized image reference at an HTTP/UI boundary. */
export function parseImageAttachmentRef(value: unknown): ImageAttachmentRef | undefined {
  const ref = record(value)
  if (ref === undefined) return undefined
  if (typeof ref.attachmentId !== 'string' || !imageMediaType(ref.mediaType)) return undefined
  if (!nonNegativeInteger(ref.bytes) || !positiveInteger(ref.width) || !positiveInteger(ref.height)) return undefined
  if (ref.name !== undefined && typeof ref.name !== 'string') return undefined

  const originalDimensions = ref.originalDimensions === undefined
    ? undefined
    : parseDimensions(ref.originalDimensions)
  if (ref.originalDimensions !== undefined && originalDimensions === undefined) return undefined

  return {
    attachmentId: ref.attachmentId as ImageAttachmentRef['attachmentId'],
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    ...(typeof ref.name === 'string' ? { name: ref.name } : {}),
    ...(originalDimensions === undefined ? {} : { originalDimensions }),
  }
}

function findInBlocks(
  blocks: readonly ContentBlock[],
  sourceAttachmentId?: string,
): ImageAttachmentRef | undefined {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block === undefined) continue
    if (block.type === 'image') {
      if (sourceAttachmentId === undefined || String(block.attachment.attachmentId) === sourceAttachmentId) {
        return block.attachment
      }
      continue
    }
    if (block.type === 'tool-result') {
      const nested = findInBlocks(block.content, sourceAttachmentId)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

function parseDimensions(value: unknown): { width: number; height: number } | undefined {
  const dimensions = record(value)
  if (dimensions === undefined || !positiveInteger(dimensions.width) || !positiveInteger(dimensions.height)) return undefined
  return { width: dimensions.width, height: dimensions.height }
}

function imageMediaType(value: unknown): value is ImageMediaType {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif'
}

function detectImageMediaType(data: Uint8Array): ImageMediaType | undefined {
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(data, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (ascii(data, 0, 6) === 'GIF87a' || ascii(data, 0, 6) === 'GIF89a') return 'image/gif'
  if (ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 4) === 'WEBP') return 'image/webp'
  return undefined
}

function startsWith(data: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => data[index] === byte)
}

function ascii(data: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...data.subarray(offset, offset + length))
}

function containsPath(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
