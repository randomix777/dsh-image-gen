/** Values shared by the Host and browser Bundle faces. */

/** Browser route used by the generated-image card. */
export const IMAGE_ROUTE = '/plugins/dsh-image-gen/image'
/** Namespace persisted through DSH Settings. */
export const IMAGE_GENERATION_NAMESPACE = 'image-generation'

/** Supported providers. */
export const IMAGE_PROVIDERS = ['google', 'openai', 'seedream', 'dashscope', 'comfyui', 'agnes', 'glm', 'stability', 'codex', 'grok'] as const
export type ImageProvider = typeof IMAGE_PROVIDERS[number]

/** Default endpoints and base URLs. */
export const DEFAULT_GOOGLE_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions'
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_SEEDREAM_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
export const DEFAULT_DASHSCOPE_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1'
export const DEFAULT_COMFYUI_BASE_URL = 'http://127.0.0.1:8188'
export const DEFAULT_COMFYUI_TIMEOUT_MS = 300_000
export const DEFAULT_COMFYUI_WORKFLOW_LABEL = 'API workflow'
export const MAX_COMFYUI_WORKFLOW_BYTES = 5 * 1024 * 1024
export const DEFAULT_AGNES_BASE_URL = 'https://apihub.agnes-ai.com/v1'
export const DEFAULT_GLM_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
export const DEFAULT_STABILITY_BASE_URL = 'https://api.stability.ai'
export const DEFAULT_CODEX_IMAGE_URL = 'https://chatgpt.com/backend-api/codex/images/generations'
export const DEFAULT_GROK_IMAGE_URL = 'https://api.x.ai/v1/images/generations'

/** Default model names. */
export const DEFAULT_GOOGLE_MODEL = 'gemini-3.1-flash-image'
export const DEFAULT_OPENAI_MODEL = 'gpt-image-2'
export const DEFAULT_SEEDREAM_MODEL = 'doubao-seedream-5-0-260128'
export const DEFAULT_DASHSCOPE_MODEL = 'qwen-image-3.0'
export const DEFAULT_AGNES_MODEL = 'agnes-image-2.1-flash'
export const DEFAULT_GLM_MODEL = 'glm-image'
export const DEFAULT_STABILITY_MODEL = 'stable-diffusion-xl-1.0'
export const DEFAULT_CODEX_MODEL = 'gpt-image-2'
export const DEFAULT_GROK_MODEL = 'grok-imagine-image-2.0'

export const DEFAULT_MODELS: Record<ImageProvider, string> = {
  google: DEFAULT_GOOGLE_MODEL,
  openai: DEFAULT_OPENAI_MODEL,
  seedream: DEFAULT_SEEDREAM_MODEL,
  dashscope: DEFAULT_DASHSCOPE_MODEL,
  comfyui: DEFAULT_COMFYUI_WORKFLOW_LABEL,
  agnes: DEFAULT_AGNES_MODEL,
  glm: DEFAULT_GLM_MODEL,
  stability: DEFAULT_STABILITY_MODEL,
  codex: DEFAULT_CODEX_MODEL,
  grok: DEFAULT_GROK_MODEL,
}

export const DEFAULT_BASE_URLS: Record<ImageProvider, string> = {
  google: DEFAULT_GOOGLE_ENDPOINT,
  openai: DEFAULT_OPENAI_BASE_URL,
  seedream: DEFAULT_SEEDREAM_BASE_URL,
  dashscope: DEFAULT_DASHSCOPE_ENDPOINT,
  comfyui: DEFAULT_COMFYUI_BASE_URL,
  agnes: DEFAULT_AGNES_BASE_URL,
  glm: DEFAULT_GLM_BASE_URL,
  stability: DEFAULT_STABILITY_BASE_URL,
  codex: DEFAULT_CODEX_IMAGE_URL,
  grok: DEFAULT_GROK_IMAGE_URL,
}
