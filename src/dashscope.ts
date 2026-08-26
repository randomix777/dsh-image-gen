/** DashScope (Aliyun Wanx & Qwen-Image) image-generation and editing adapter. */
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'

export interface DashScopeImageOptions {
  apiKey: string
  endpoint: string
  model: string
  prompt: string
  size?: string
  maxBytes: number
  signal?: AbortSignal
}

export interface DashScopeEditOptions extends DashScopeImageOptions {
  sourceImage: { data: Uint8Array; mediaType: ImageMediaType }
}

interface DashScopeOutputResult {
  url?: string
}

interface DashScopeChoiceMessageContent {
  text?: string
  image?: string
  image_url?: string
  url?: string
}

interface DashScopeTaskResponse {
  output?: {
    task_id?: string
    task_status?: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'
    results?: DashScopeOutputResult[]
    choices?: Array<{ message?: { content?: DashScopeChoiceMessageContent[] } }>
    message?: string
  }
  message?: string
  code?: string
}

/** Call DashScope image synthesis/generation API and handle both synchronous output & async task polling. */
export async function generateDashScopeImage(options: DashScopeImageOptions): Promise<{
  data: Uint8Array
  mediaType: ImageAttachmentRef['mediaType']
}> {
  const base = options.endpoint.replace(/\/+$/, '')
  const formattedSize = (options.size ?? '1024*1024').replace('x', '*')
  const isQwenImage = qwenImageModel(options.model)

  const submitUrl = isQwenImage
    ? `${base}/services/aigc/multimodal-generation/generation`
    : `${base}/services/aigc/text2image/image-synthesis`

  const requestBody = isQwenImage
    ? {
        model: options.model,
        input: {
          messages: [{ role: 'user', content: [{ text: options.prompt }] }],
        },
        parameters: { size: formattedSize },
      }
    : {
        model: options.model,
        input: { prompt: options.prompt },
        parameters: { size: formattedSize, n: 1 },
      }

  return submitAndResolve(submitUrl, requestBody, options)
}

/** Edit an image with DashScope Qwen Image multimodal generation. */
export async function editDashScopeImage(options: DashScopeEditOptions): Promise<{
  data: Uint8Array
  mediaType: ImageAttachmentRef['mediaType']
}> {
  if (!qwenImageModel(options.model)) {
    throw new Error(`DashScope image editing requires a qwen-image model; configured model is ${options.model}`)
  }
  const base = options.endpoint.replace(/\/+$/, '')
  const submitUrl = `${base}/services/aigc/multimodal-generation/generation`
  const formattedSize = options.size?.replace('x', '*')
  const requestBody = {
    model: options.model,
    input: {
      messages: [{
        role: 'user',
        content: [
          { image: toDataUrl(options.sourceImage) },
          { text: options.prompt },
        ],
      }],
    },
    parameters: {
      prompt_extend: true,
      ...(formattedSize === undefined || formattedSize.length === 0 ? {} : { size: formattedSize }),
    },
  }
  return submitAndResolve(submitUrl, requestBody, options)
}

function qwenImageModel(model: string): boolean {
  return model.toLowerCase().startsWith('qwen-image')
}

function toDataUrl(image: { data: Uint8Array; mediaType: ImageMediaType }): string {
  return `data:${image.mediaType};base64,${Buffer.from(image.data).toString('base64')}`
}

async function submitAndResolve(
  submitUrl: string,
  requestBody: unknown,
  options: DashScopeImageOptions,
): Promise<{ data: Uint8Array; mediaType: ImageAttachmentRef['mediaType'] }> {
  const base = options.endpoint.replace(/\/+$/, '')
  const submitResponse = await fetch(submitUrl, {
    method: 'POST',
    ...(options.signal ? { signal: options.signal } : {}),
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.apiKey}`,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify(requestBody),
  })

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text()
    throw new Error(`DashScope image request failed (${String(submitResponse.status)}): ${errorText}`)
  }

  const submitResult = (await submitResponse.json()) as DashScopeTaskResponse
  const directImageUrl = extractImageUrl(submitResult)
  if (directImageUrl !== undefined) return downloadImageBlob(directImageUrl, options)

  const taskId = submitResult.output?.task_id
  if (taskId === undefined || taskId.length === 0) {
    throw new Error(`DashScope did not return an image URL or task_id: ${submitResult.message ?? JSON.stringify(submitResult)}`)
  }

  const taskQueryUrl = `${base}/tasks/${taskId}`
  const startTime = Date.now()
  const timeoutMs = 60_000

  while (Date.now() - startTime < timeoutMs) {
    if (options.signal?.aborted) throw new Error('DashScope image task polling aborted')
    await waitForPoll(options.signal)

    const taskResponse = await fetch(taskQueryUrl, {
      method: 'GET',
      ...(options.signal ? { signal: options.signal } : {}),
      headers: { authorization: `Bearer ${options.apiKey}` },
    })

    if (!taskResponse.ok) {
      const errorText = await taskResponse.text()
      throw new Error(`DashScope task query failed (${String(taskResponse.status)}): ${errorText}`)
    }

    const taskResult = (await taskResponse.json()) as DashScopeTaskResponse
    const status = taskResult.output?.task_status
    if (status === 'SUCCEEDED') {
      const imageUrl = extractImageUrl(taskResult)
      if (imageUrl === undefined || imageUrl.length === 0) throw new Error('DashScope task succeeded but returned no image URL')
      return downloadImageBlob(imageUrl, options)
    }
    if (status === 'FAILED') {
      throw new Error(`DashScope image request failed: ${taskResult.output?.message ?? taskResult.message ?? 'Unknown error'}`)
    }
  }

  throw new Error(`DashScope image request timed out after ${String(timeoutMs / 1000)} seconds`)
}

function waitForPoll(signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 1500)
    if (signal !== undefined) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new Error('DashScope image request aborted'))
      }, { once: true })
    }
  })
}

function extractImageUrl(response: DashScopeTaskResponse): string | undefined {
  const resultUrl = response.output?.results?.[0]?.url
  if (resultUrl !== undefined && resultUrl.length > 0) return resultUrl
  const contents = response.output?.choices?.[0]?.message?.content
  if (Array.isArray(contents)) {
    for (const item of contents) {
      if (item.image !== undefined && item.image.length > 0) return item.image
      if (item.image_url !== undefined && item.image_url.length > 0) return item.image_url
      if (item.url !== undefined && item.url.length > 0) return item.url
    }
  }
  return undefined
}

async function downloadImageBlob(
  imageUrl: string,
  options: DashScopeImageOptions,
): Promise<{ data: Uint8Array; mediaType: ImageAttachmentRef['mediaType'] }> {
  const imageResponse = await fetch(imageUrl, { ...(options.signal ? { signal: options.signal } : {}) })
  if (!imageResponse.ok) throw new Error(`Failed to fetch DashScope image from URL (${String(imageResponse.status)})`)
  const buffer = await imageResponse.arrayBuffer()
  if (buffer.byteLength > options.maxBytes) {
    throw new Error(`DashScope generated image (${String(buffer.byteLength)} bytes) exceeds the ${String(options.maxBytes)} byte limit`)
  }
  const contentType = imageResponse.headers.get('content-type')
  const mediaType: ImageAttachmentRef['mediaType'] =
    contentType?.includes('png') ? 'image/png' :
    contentType?.includes('webp') ? 'image/webp' :
    'image/jpeg'
  return { data: new Uint8Array(buffer), mediaType }
}
