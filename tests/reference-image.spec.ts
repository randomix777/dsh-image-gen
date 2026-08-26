import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { Message } from '@deepseek-ai/dsh-llm'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  findReferenceImage,
  parseImageAttachmentRef,
  resolveReferenceImage,
} from '../src/reference-image.js'

const signal = new AbortController().signal

function imageRef(id: string, mediaType: ImageAttachmentRef['mediaType'] = 'image/png'): ImageAttachmentRef {
  return {
    attachmentId: id as ImageAttachmentRef['attachmentId'],
    mediaType,
    bytes: 12,
    width: 32,
    height: 24,
    name: `${id}.png`,
  }
}

function messages(content: unknown[]): Message[] {
  return [{ role: 'assistant', content }] as unknown as Message[]
}

describe('reference image compatibility boundary', () => {
  it('finds the newest image recursively inside tool-result content', () => {
    const older = imageRef('older')
    const newest = imageRef('newest')
    const history = [
      ...messages([{ type: 'image', attachment: older }]),
      ...messages([{
        type: 'tool-result',
        toolCallId: 'call-1',
        content: [
          { type: 'text', text: 'edited image' },
          { type: 'image', attachment: newest },
        ],
      }]),
    ]

    expect(findReferenceImage(history)).toBe(newest)
  })

  it('honors an explicit attachment id from an earlier effective message', () => {
    const selected = imageRef('selected')
    const newest = imageRef('newest')
    const history = [
      ...messages([{ type: 'image', attachment: selected }]),
      ...messages([{ type: 'image', attachment: newest }]),
    ]

    expect(findReferenceImage(history, 'selected')).toBe(selected)
  })

  it('derives effective messages and reads the full durable reference', async () => {
    const ref = imageRef('source', 'image/webp')
    const deriveMessages = vi.fn(() => messages([{ type: 'image', attachment: ref }]))
    const readImage = vi.fn(async (received: ImageAttachmentRef) => ({
      ref: received,
      data: new Uint8Array([1, 2, 3]),
    }))

    await expect(resolveReferenceImage({
      agent: { session: { deriveMessages } },
      attachments: { readImage },
      signal,
    })).resolves.toEqual({
      data: new Uint8Array([1, 2, 3]),
      mediaType: 'image/webp',
    })
    expect(deriveMessages).toHaveBeenCalledOnce()
    expect(readImage).toHaveBeenCalledWith(ref, signal)
  })

  it('fails clearly when the effective conversation has no image', async () => {
    await expect(resolveReferenceImage({
      agent: { session: { deriveMessages: () => messages([{ type: 'text', text: 'no image' }]) } },
      attachments: { readImage: vi.fn() },
      signal,
    })).rejects.toThrow('upload or generate an image first')
  })

  it('validates complete serialized refs including original dimensions', () => {
    expect(parseImageAttachmentRef({
      attachmentId: 'sha256:test',
      mediaType: 'image/jpeg',
      bytes: 20,
      width: 10,
      height: 8,
      name: 'test.jpg',
      originalDimensions: { width: 20, height: 16 },
    })).toMatchObject({
      attachmentId: 'sha256:test',
      mediaType: 'image/jpeg',
      originalDimensions: { width: 20, height: 16 },
    })
    expect(parseImageAttachmentRef({ attachmentId: 'fake' })).toBeUndefined()
  })
  it('reads an explicitly named image from the session workspace', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'dsh-image-gen-workspace-'))
    await mkdir(join(workspaceRoot, 'images'))
    await writeFile(join(workspaceRoot, 'images', 'source.jpg'), new Uint8Array([0xff, 0xd8, 0xff, 0x00]))
    const deriveMessages = vi.fn(() => messages([{ type: 'image', attachment: imageRef('newest') }]))

    await expect(resolveReferenceImage({
      agent: { session: { deriveMessages, header: { cwd: workspaceRoot } } },
      attachments: { readImage: vi.fn() },
      sourcePath: 'images/source.jpg',
      signal,
    })).resolves.toEqual({
      data: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
      mediaType: 'image/jpeg',
    })
    expect(deriveMessages).not.toHaveBeenCalled()
  })

  it('does not fall back to the newest conversation image when source_path is missing', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'dsh-image-gen-workspace-'))
    const readImage = vi.fn()

    await expect(resolveReferenceImage({
      agent: { session: { deriveMessages: () => messages([{ type: 'image', attachment: imageRef('newest') }]), header: { cwd: workspaceRoot } } },
      attachments: { readImage },
      sourcePath: 'missing.jpg',
      signal,
    })).rejects.toThrow('could not find workspace image')
    expect(readImage).not.toHaveBeenCalled()
  })

  it('rejects workspace traversal and symlink escapes', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dsh-image-gen-parent-'))
    const workspaceRoot = join(parent, 'workspace')
    const outside = join(parent, 'outside')
    await mkdir(workspaceRoot)
    await mkdir(outside)
    await writeFile(join(outside, 'source.png'), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    await symlink(outside, join(workspaceRoot, 'linked'), 'junction')
    const base = {
      agent: { session: { deriveMessages: () => [], header: { cwd: workspaceRoot } } },
      attachments: { readImage: vi.fn() },
      signal,
    }

    await expect(resolveReferenceImage({ ...base, sourcePath: '../outside/source.png' }))
      .rejects.toThrow('must stay inside')
    await expect(resolveReferenceImage({ ...base, sourcePath: 'linked/source.png' }))
      .rejects.toThrow('resolves outside')
  })

  it('rejects ambiguous explicit selectors instead of guessing', async () => {
    await expect(resolveReferenceImage({
      attachments: { readImage: vi.fn() },
      sourceAttachmentId: 'source',
      sourcePath: 'source.png',
      signal,
    })).rejects.toThrow('either source_attachment_id or source_path')
  })
})
