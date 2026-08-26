/** Multi-provider image-generation Bundle for DeepSeek Harness. */
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { defineTool, type ToolResult } from '@deepseek-ai/dsh-tools'
import { Config, resolveProvider, type AspectRatio, type ImageProvider, type ImageSize } from './config.js'
import { generateDashScopeImage } from './dashscope.js'
import { editGoogleImage, generateGoogleImage } from './google.js'
import { IMAGE_ROUTE, imageAttachmentFromMeta, serveImage } from './image-route.js'
import { generateOpenAICompatibleImage } from './openai-compatible.js'
import { resolveReferenceImage } from './reference-image.js'
import { IMAGE_GENERATION_NAMESPACE } from './shared.js'
import { saveImageToWorkspace } from './workspace-save.js'

export { Config } from './config.js'
export { IMAGE_ROUTE, imageAttachmentFromMeta } from './image-route.js'

/** Cordis plugin name. */
export const name = 'dsh-image-gen'
/** Host services required by the Bundle. */
export const inject = ['tools', 'attachments', 'credentials', 'webServer']

interface GeneratedValue {
  attachment: ImageAttachmentRef
  provider: ImageProvider
  model: string
  output: string
  /** Absolute path of the workspace file copy, when the image was saved to the session workspace. */
  savedTo?: string
  /** Why the workspace file copy could not be written, when generation still succeeded. */
  saveError?: string
}

/** Register settings, the image route, and the model-callable tool. */
export function apply(ctx: Context, config: Config = {}): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, settingsNamespace(IMAGE_GENERATION_NAMESPACE), Config, config, {
    setSource: source => { current = source }, onChange: () => {},
  })
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: IMAGE_ROUTE,
    handler: (req, res) => serveImage(req, res, { readImage: ref => ctx.attachments.readImage(ref) }),
  }), 'dsh-image-gen: image route')

  ctx.tools.register(defineTool({
    name: 'generate_image',
    description: 'Generate a new image with the configured provider. Use when the user asks to create or draw a new image; use edit_image instead when they want to change an existing image. Give a complete visual prompt including subject, composition, style, lighting, and any exact text that should appear. A successful image is attached directly to the conversation and may also be saved under the session workspace. Do not call read, glob, or other tools to locate or verify the image.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Complete description of the image to generate.' },
      aspect_ratio: { type: 'string', enum: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'], description: 'Optional output aspect ratio for Google Gemini.' },
      image_size: { type: 'string', enum: ['1K', '2K', '4K'], description: 'Optional output resolution for Google Gemini.' },
      size: { type: 'string', description: 'Optional dimensions or size tier for OpenAI, Seedream, or DashScope.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          attachment: { type: 'object', required: true, additionalProperties: false, properties: {
            attachmentId: { type: 'string', required: true }, mediaType: { type: 'string', required: true }, bytes: { type: 'integer', required: true }, width: { type: 'integer', required: true }, height: { type: 'integer', required: true }, name: { type: 'string' }, originalDimensions: { type: 'object', additionalProperties: false, properties: { width: { type: 'integer', required: true }, height: { type: 'integer', required: true } } },
          } },
          provider: { type: 'string', required: true }, model: { type: 'string', required: true }, output: { type: 'string', required: true },
          savedTo: { type: 'string' }, saveError: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const saved = typeof value.savedTo === 'string' ? ` It was also saved to the workspace as ${value.savedTo}.` : typeof value.saveError === 'string' ? ` Saving it to the workspace failed: ${value.saveError}.` : ' It has no local file path.'
        return [
          { type: 'text' as const, text: `Generated one image with ${value.provider}/${value.model} (${value.output}). Attachment ID: ${String(value.attachment.attachmentId)}. It is already attached to the conversation.${saved} Respond to the user without reading or searching for the image.` },
          { type: 'image' as const, attachment: value.attachment as ImageAttachmentRef },
        ]
      },
      presentationMeta: (args, value) => ({
        kind: 'dsh-image-gen',
        attachment: value.attachment,
        provider: value.provider,
        model: value.model,
        output: value.output,
        ...(typeof value.savedTo === 'string' ? { savedTo: value.savedTo } : {}),
        prompt: (args as { prompt: string }).prompt,
      }),
    },
    async execute(args, exec): Promise<GeneratedValue> {
      const active = resolveProvider(current())
      const credential = await ctx.credentials.resolve(credentialRef(active.apiKeyEnv))
      if (credential === undefined || credential.value.length === 0) throw new Error(`generate_image requires the ${active.apiKeyEnv} credential; configure it in Settings > Plugins > Image generation.`)
      if (active.provider === 'google') {
        const aspectRatio = (args.aspect_ratio ?? active.aspectRatio) as AspectRatio
        const imageSize = (args.image_size ?? active.imageSize) as ImageSize
        const generated = await generateGoogleImage({ apiKey: credential.value, endpoint: active.endpoint, model: active.model, prompt: args.prompt, aspectRatio, imageSize, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal: exec.signal })
        return saveGenerated(ctx, generated, active.provider, active.model, `${aspectRatio}, ${imageSize}`, current(), exec)
      }
      if (active.provider === 'dashscope') {
        const size = args.size ?? active.imageSize
        const generated = await generateDashScopeImage({ apiKey: credential.value, endpoint: active.endpoint, model: active.model, prompt: args.prompt, size, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal: exec.signal })
        return saveGenerated(ctx, generated, active.provider, active.model, size, current(), exec)
      }
      const size = args.size ?? active.imageSize
      const generated = await generateOpenAICompatibleImage({ provider: active.provider, apiKey: credential.value, baseURL: active.baseURL, model: active.model, prompt: args.prompt, size, maxBytes: ctx.attachments.imageLimits.maxImageBytes, signal: exec.signal })
      return saveGenerated(ctx, generated, active.provider, active.model, size, current(), exec)
    },
    presentResult: (_args, result) => imagePresentation(result),
  }))
  ctx.tools.register(defineTool({
    name: 'edit_image',
    description: 'Edit or restyle an existing image with the configured provider. For a named workspace file, pass its exact path as source_path. For a specific image still attached to the current conversation, pass source_attachment_id. Never provide both. Omit both only when the user clearly means the newest conversation image. If the user identifies an older image but its exact path or attachment id is unknown, do not silently edit the newest image: first use an image-reading tool to put the intended file into the conversation, then call edit_image without a source. Image editing currently supports only the Google provider.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Describe the changes to make while preserving everything else that should remain.' },
      source_attachment_id: { type: 'string', description: 'Optional attachment id of a specific image already present in the current conversation.' },
      source_path: { type: 'string', description: 'Optional absolute or workspace-relative path of a specific image file inside the active session workspace. Prefer this when the user names a saved file.' },
      aspect_ratio: { type: 'string', enum: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'], description: 'Optional output aspect ratio for Google Gemini.' },
      image_size: { type: 'string', enum: ['1K', '2K', '4K'], description: 'Optional output resolution for Google Gemini.' },

    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          attachment: { type: 'object', required: true, additionalProperties: false, properties: {
            attachmentId: { type: 'string', required: true }, mediaType: { type: 'string', required: true }, bytes: { type: 'integer', required: true }, width: { type: 'integer', required: true }, height: { type: 'integer', required: true }, name: { type: 'string' }, originalDimensions: { type: 'object', additionalProperties: false, properties: { width: { type: 'integer', required: true }, height: { type: 'integer', required: true } } },
          } },
          provider: { type: 'string', required: true }, model: { type: 'string', required: true }, output: { type: 'string', required: true },
          savedTo: { type: 'string' }, saveError: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const saved = typeof value.savedTo === 'string' ? ` It was also saved to the workspace as ${value.savedTo}.` : typeof value.saveError === 'string' ? ` Saving it to the workspace failed: ${value.saveError}.` : ' It has no local file path.'
        return [
          { type: 'text' as const, text: `Edited one image with ${value.provider}/${value.model} (${value.output}). Attachment ID: ${String(value.attachment.attachmentId)}. The edited image is attached to the conversation.${saved} Respond to the user without reading or searching for the image.` },
          { type: 'image' as const, attachment: value.attachment as ImageAttachmentRef },
        ]
      },
      presentationMeta: (args, value) => ({
        kind: 'dsh-image-gen',
        attachment: value.attachment,
        provider: value.provider,
        model: value.model,
        output: value.output,
        operation: 'edit',
        ...(typeof value.savedTo === 'string' ? { savedTo: value.savedTo } : {}),
        prompt: (args as { prompt: string }).prompt,
      }),
    },
    async execute(args, exec): Promise<GeneratedValue> {
      const active = resolveProvider(current())
      if (active.provider !== 'google') {
        throw new Error(`Image editing is not yet supported for provider ${active.provider}.`)
      }
      const credential = await ctx.credentials.resolve(credentialRef(active.apiKeyEnv))
      if (credential === undefined || credential.value.length === 0) throw new Error(`edit_image requires the ${active.apiKeyEnv} credential; configure it in Settings > Plugins > Image generation.`)

      const sourceImage = await resolveReferenceImage({
        ...(exec.agent === undefined ? {} : { agent: exec.agent }),
        attachments: ctx.attachments,
        ...(typeof args.source_attachment_id === 'string' ? { sourceAttachmentId: args.source_attachment_id } : {}),
        ...(typeof args.source_path === 'string' ? { sourcePath: args.source_path } : {}),
        maxBytes: ctx.attachments.imageLimits.maxImageBytes,
        signal: exec.signal,
      })
      const aspectRatio = (args.aspect_ratio ?? active.aspectRatio) as AspectRatio
      const imageSize = (args.image_size ?? active.imageSize) as ImageSize
      const generated = await editGoogleImage({
        apiKey: credential.value,
        endpoint: active.endpoint,
        model: active.model,
        prompt: args.prompt,
        sourceImage,
        aspectRatio,
        imageSize,
        maxBytes: ctx.attachments.imageLimits.maxImageBytes,
        signal: exec.signal,
      })
      return saveGenerated(ctx, generated, active.provider, active.model, `${aspectRatio}, ${imageSize}`, current(), exec)
    },
    presentResult: (_args, result) => imagePresentation(result),
  }))
}

/**
 * Persist the generated image as a durable attachment, then — when workspace
 * saving is enabled — also write it as a file under the calling agent's
 * session workspace. A workspace write failure never discards the generated
 * attachment: it is reported through `saveError` instead.
 */
async function saveGenerated(
  ctx: Context,
  generated: { data: Uint8Array; mediaType: ImageAttachmentRef['mediaType'] },
  provider: ImageProvider,
  model: string,
  output: string,
  config: Config,
  exec: { agent?: { session: { header: { cwd?: string } } }; signal: AbortSignal },
): Promise<GeneratedValue> {
  if (!ctx.attachments.imageLimits.mediaTypes.includes(generated.mediaType)) throw new Error(`This DSH deployment does not accept ${generated.mediaType} generated images`)
  const attachment = await ctx.attachments.saveImage({ data: generated.data, mediaType: generated.mediaType, name: 'generated-image' })
  const value: GeneratedValue = { attachment, provider, model, output }
  if (config.saveToWorkspace === false) return value
  const workspaceRoot = exec.agent?.session.header.cwd
  if (workspaceRoot === undefined) return value
  try {
    value.savedTo = await saveImageToWorkspace({
      workspaceRoot,
      folder: config.workspaceFolder,
      attachmentId: attachment.attachmentId,
      mediaType: generated.mediaType,
      data: generated.data,
      signal: exec.signal,
    })
  } catch (error) {
    // A cancellation is never reported as a (partial) success: rethrow it even
    // if the workspace write had already finished when the signal fired.
    exec.signal.throwIfAborted()
    ctx.logger.warn(`dsh-image-gen: failed to save image to workspace: ${error instanceof Error ? error.message : String(error)}`)
    value.saveError = error instanceof Error ? error.message : String(error)
  }
  return value
}

function imagePresentation(result: ToolResult) {
  const attachment = imageAttachmentFromMeta(result.meta)
  return attachment === undefined ? undefined : { card: 'generic' as const, title: 'Generated image', content: [{ type: 'image' as const, attachment }] }
}
