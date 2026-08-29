/** User-facing configuration for supported image providers. */
import z from '@deepseek-ai/schemastery'

import {
  DEFAULT_AGNES_BASE_URL,
  DEFAULT_AGNES_MODEL,
  DEFAULT_CODEX_IMAGE_URL,
  DEFAULT_COMFYUI_BASE_URL,
  DEFAULT_COMFYUI_TIMEOUT_MS,
  DEFAULT_COMFYUI_WORKFLOW_LABEL,
  DEFAULT_DASHSCOPE_ENDPOINT,
  DEFAULT_DASHSCOPE_MODEL,
  DEFAULT_GLM_BASE_URL,
  DEFAULT_GLM_MODEL,
  DEFAULT_GOOGLE_ENDPOINT,
  DEFAULT_GOOGLE_MODEL,
  DEFAULT_GROK_IMAGE_URL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_SEEDREAM_BASE_URL,
  DEFAULT_SEEDREAM_MODEL,
  DEFAULT_STABILITY_BASE_URL,
  DEFAULT_STABILITY_MODEL,
  IMAGE_PROVIDERS,
  type ImageProvider,
} from './shared.js'

export {
  DEFAULT_AGNES_BASE_URL,
  DEFAULT_AGNES_MODEL,
  DEFAULT_CODEX_IMAGE_URL,
  DEFAULT_COMFYUI_BASE_URL,
  DEFAULT_COMFYUI_TIMEOUT_MS,
  DEFAULT_COMFYUI_WORKFLOW_LABEL,
  DEFAULT_DASHSCOPE_ENDPOINT,
  DEFAULT_DASHSCOPE_MODEL,
  DEFAULT_GLM_BASE_URL,
  DEFAULT_GLM_MODEL,
  DEFAULT_GOOGLE_ENDPOINT,
  DEFAULT_GOOGLE_MODEL,
  DEFAULT_GROK_IMAGE_URL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_SEEDREAM_BASE_URL,
  DEFAULT_SEEDREAM_MODEL,
  DEFAULT_STABILITY_BASE_URL,
  DEFAULT_STABILITY_MODEL,
  IMAGE_PROVIDERS,
  type ImageProvider,
}

/** Default workspace subfolder that receives generated image files. */
export const DEFAULT_WORKSPACE_FOLDER = 'dsh-image-gen'

/** Google API credential reference. */
export const GOOGLE_API_KEY_ENV = 'GEMINI_API_KEY'
/** OpenAI Platform or compatible relay credential reference. */
export const OPENAI_API_KEY_ENV = 'OPENAI_API_KEY'
/** Volcengine Ark credential reference. */
export const SEEDREAM_API_KEY_ENV = 'ARK_API_KEY'
/** DashScope credential reference. */
export const DASHSCOPE_API_KEY_ENV = 'DASHSCOPE_API_KEY'
/** ComfyUI local server credential reference. */
export const COMFYUI_API_KEY_ENV = ''
/** Codex ChatGPT subscription access token. */
export const CODEX_ACCESS_TOKEN_ENV = 'CODEX_ACCESS_TOKEN'
/** Codex ChatGPT account ID. */
export const CODEX_ACCOUNT_ID_ENV = 'CODEX_ACCOUNT_ID'
/** Agnes AI credential reference. */
export const AGNES_API_KEY_ENV = 'AGNES_API_KEY'
/** Zhipu AI (GLM) credential reference. */
export const GLM_API_KEY_ENV = 'ZHIPU_API_KEY'
/** Stability AI credential reference. */
export const STABILITY_API_KEY_ENV = 'STABILITY_API_KEY'
/** X AI Grok subscription access token. */
export const GROK_ACCESS_TOKEN_ENV = 'GROK_ACCESS_TOKEN'

/** Google tool-level controls. */
export const ASPECT_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'] as const
export const IMAGE_SIZES = ['1K', '2K', '4K'] as const
export type AspectRatio = typeof ASPECT_RATIOS[number]
export type ImageSize = typeof IMAGE_SIZES[number]

/** Bundle configuration from the profile patch and the Web settings page. */
export interface Config {
  provider?: ImageProvider
  googleModel?: string
  googleEndpoint?: string
  openaiBaseURL?: string
  openaiModel?: string
  seedreamBaseURL?: string
  seedreamModel?: string
  dashscopeEndpoint?: string
  dashscopeModel?: string
  comfyuiBaseURL?: string
  /** ComfyUI API-format workflow JSON imported through the Web settings page. */
  comfyuiWorkflowJson?: string
  /** Original imported file name, used as a human-readable result label. */
  comfyuiWorkflowName?: string
  comfyuiTimeoutMs?: number
  agnesBaseURL?: string
  agnesModel?: string
  glmBaseURL?: string
  glmModel?: string
  stabilityBaseURL?: string
  stabilityModel?: string
  /** Codex ChatGPT access token (OAuth session token). */
  codexAccessToken?: string
  /** Codex ChatGPT account ID. */
  codexAccountId?: string
  /** Quality preset: low | medium | high | auto. */
  quality?: string
  /** Output format: png | jpeg | webp. */
  outputFormat?: string
  /** X AI Grok access token (OAuth session token). */
  grokAccessToken?: string
  /** Number of images to generate per call; defaults to 1. */
  count?: number
  /** Also write every generated image as a file under the session workspace. */
  saveToWorkspace?: boolean
  /** Workspace subfolder for generated images; empty means the workspace root. */
  workspaceFolder?: string
}

/** Cordis configuration schema. */
export const Config: z<Config> = z.object({
  provider: z.union(IMAGE_PROVIDERS).default('google'),
  googleModel: z.string().default(DEFAULT_GOOGLE_MODEL),
  googleEndpoint: z.string().default(DEFAULT_GOOGLE_ENDPOINT),
  openaiBaseURL: z.string().default(DEFAULT_OPENAI_BASE_URL),
  openaiModel: z.string().default(DEFAULT_OPENAI_MODEL),
  seedreamBaseURL: z.string().default(DEFAULT_SEEDREAM_BASE_URL),
  seedreamModel: z.string().default(DEFAULT_SEEDREAM_MODEL),
  dashscopeEndpoint: z.string().default(DEFAULT_DASHSCOPE_ENDPOINT),
  dashscopeModel: z.string().default(DEFAULT_DASHSCOPE_MODEL),
  comfyuiBaseURL: z.string().default(DEFAULT_COMFYUI_BASE_URL),
  comfyuiWorkflowJson: z.string().default(''),
  comfyuiWorkflowName: z.string().default(''),
  comfyuiTimeoutMs: z.number().min(1_000).max(3_600_000).default(DEFAULT_COMFYUI_TIMEOUT_MS),
  agnesBaseURL: z.string().default(DEFAULT_AGNES_BASE_URL),
  agnesModel: z.string().default(DEFAULT_AGNES_MODEL),
  glmBaseURL: z.string().default(DEFAULT_GLM_BASE_URL),
  glmModel: z.string().default(DEFAULT_GLM_MODEL),
  stabilityBaseURL: z.string().default(DEFAULT_STABILITY_BASE_URL),
  stabilityModel: z.string().default(DEFAULT_STABILITY_MODEL),
  codexAccessToken: z.string().default(''),
  codexAccountId: z.string().default(''),
  quality: z.string().default('auto'),
  outputFormat: z.string().default(''),
  grokAccessToken: z.string().default(''),
  count: z.number().min(1).max(16).default(1),
  saveToWorkspace: z.boolean().default(true),
  workspaceFolder: z.string().default(DEFAULT_WORKSPACE_FOLDER),
})

/** Resolve exactly one provider profile for a tool call. */
export function resolveProvider(config: Config):
  | { provider: 'google'; apiKeyEnv: string; model: string; endpoint: string; aspectRatio: AspectRatio; imageSize: ImageSize; count: number }
  | { provider: 'openai'; apiKeyEnv: string; model: string; baseURL: string; imageSize: string; count: number }
  | { provider: 'seedream'; apiKeyEnv: string; model: string; baseURL: string; imageSize: string; count: number }
  | { provider: 'dashscope'; apiKeyEnv: string; model: string; endpoint: string; imageSize: string; count: number }
  | { provider: 'comfyui'; baseURL: string; workflowJson: string; workflowName: string; timeoutMs: number; count: number }
  | { provider: 'agnes'; apiKeyEnv: string; model: string; baseURL: string; imageSize: string; count: number }
  | { provider: 'glm'; apiKeyEnv: string; model: string; baseURL: string; imageSize: string; count: number }
  | { provider: 'stability'; apiKeyEnv: string; model: string; baseURL: string; imageSize: string; count: number }
  | { provider: 'codex'; accessTokenEnv: string; accountIdEnv: string; model: string; size: string; imageSize: string; quality: string; outputFormat: string; count: number }
  | { provider: 'grok'; accessTokenEnv: string; model: string; size: string; imageSize: string; quality: string; outputFormat: string; count: number } {
  const count = config.count ?? 1
  switch (config.provider ?? 'google') {
    case 'openai': return { provider: 'openai', apiKeyEnv: OPENAI_API_KEY_ENV, model: config.openaiModel ?? DEFAULT_OPENAI_MODEL, baseURL: config.openaiBaseURL ?? DEFAULT_OPENAI_BASE_URL, imageSize: '1024x1024', count }
    case 'seedream': return { provider: 'seedream', apiKeyEnv: SEEDREAM_API_KEY_ENV, model: config.seedreamModel ?? DEFAULT_SEEDREAM_MODEL, baseURL: config.seedreamBaseURL ?? DEFAULT_SEEDREAM_BASE_URL, imageSize: '2K', count }
    case 'dashscope': return { provider: 'dashscope', apiKeyEnv: DASHSCOPE_API_KEY_ENV, model: config.dashscopeModel ?? DEFAULT_DASHSCOPE_MODEL, endpoint: config.dashscopeEndpoint ?? DEFAULT_DASHSCOPE_ENDPOINT, imageSize: '1024*1024', count }
    case 'comfyui': return {
      provider: 'comfyui',
      baseURL: config.comfyuiBaseURL ?? DEFAULT_COMFYUI_BASE_URL,
      workflowJson: config.comfyuiWorkflowJson ?? '',
      workflowName: config.comfyuiWorkflowName?.trim() || DEFAULT_COMFYUI_WORKFLOW_LABEL,
      timeoutMs: config.comfyuiTimeoutMs ?? DEFAULT_COMFYUI_TIMEOUT_MS,
      count,
    }
    case 'agnes': return { provider: 'agnes', apiKeyEnv: AGNES_API_KEY_ENV, model: config.agnesModel ?? DEFAULT_AGNES_MODEL, baseURL: config.agnesBaseURL ?? DEFAULT_AGNES_BASE_URL, imageSize: '1K', count }
    case 'glm': return { provider: 'glm', apiKeyEnv: GLM_API_KEY_ENV, model: config.glmModel ?? DEFAULT_GLM_MODEL, baseURL: config.glmBaseURL ?? DEFAULT_GLM_BASE_URL, imageSize: '1280x1280', count }
    case 'stability': return { provider: 'stability', apiKeyEnv: STABILITY_API_KEY_ENV, model: config.stabilityModel ?? DEFAULT_STABILITY_MODEL, baseURL: config.stabilityBaseURL ?? DEFAULT_STABILITY_BASE_URL, imageSize: '1024x1024', count }
    case 'codex': return { provider: 'codex', accessTokenEnv: CODEX_ACCESS_TOKEN_ENV, accountIdEnv: CODEX_ACCOUNT_ID_ENV, model: 'gpt-image-2', size: '1024x1024', imageSize: '1024x1024', quality: config.quality ?? 'auto', outputFormat: config.outputFormat ?? '', count }
    case 'grok': return { provider: 'grok', accessTokenEnv: GROK_ACCESS_TOKEN_ENV, model: 'grok-imagine-image-2.0', size: '1024x1024', imageSize: '1024x1024', quality: config.quality ?? 'auto', outputFormat: config.outputFormat ?? '', count }
    case 'google': return { provider: 'google', apiKeyEnv: GOOGLE_API_KEY_ENV, model: config.googleModel ?? DEFAULT_GOOGLE_MODEL, endpoint: config.googleEndpoint ?? DEFAULT_GOOGLE_ENDPOINT, aspectRatio: '1:1', imageSize: '1K', count }
  }
}
