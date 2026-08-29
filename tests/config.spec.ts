import { describe, expect, it } from 'vitest'
import {
  Config,
  DEFAULT_AGNES_BASE_URL,
  DEFAULT_AGNES_MODEL,
  DEFAULT_COMFYUI_BASE_URL,
  DEFAULT_COMFYUI_TIMEOUT_MS,
  DEFAULT_DASHSCOPE_ENDPOINT,
  DEFAULT_DASHSCOPE_MODEL,
  DEFAULT_GLM_BASE_URL,
  DEFAULT_GLM_MODEL,
  DEFAULT_GOOGLE_ENDPOINT,
  DEFAULT_GOOGLE_MODEL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_SEEDREAM_BASE_URL,
  DEFAULT_SEEDREAM_MODEL,
  DEFAULT_STABILITY_BASE_URL,
  DEFAULT_STABILITY_MODEL,
  resolveProvider,
} from '../src/config.js'

describe('resolveProvider', () => {
  it('resolves the Google defaults', () => {
    expect(resolveProvider({})).toEqual({ provider: 'google', apiKeyEnv: 'GEMINI_API_KEY', endpoint: DEFAULT_GOOGLE_ENDPOINT, model: DEFAULT_GOOGLE_MODEL, aspectRatio: '1:1', imageSize: '1K', count: 1 })
  })

  it('resolves editable OpenAI-compatible profiles independently', () => {
    expect(resolveProvider({ provider: 'openai' })).toEqual({ provider: 'openai', apiKeyEnv: 'OPENAI_API_KEY', baseURL: DEFAULT_OPENAI_BASE_URL, model: DEFAULT_OPENAI_MODEL, imageSize: '1024x1024', count: 1 })
    expect(resolveProvider({ provider: 'seedream' })).toEqual({ provider: 'seedream', apiKeyEnv: 'ARK_API_KEY', baseURL: DEFAULT_SEEDREAM_BASE_URL, model: DEFAULT_SEEDREAM_MODEL, imageSize: '2K', count: 1 })
  })

  it('resolves Agnes profile', () => {
    expect(resolveProvider({ provider: 'agnes' })).toEqual({
      provider: 'agnes',
      apiKeyEnv: 'AGNES_API_KEY',
      baseURL: DEFAULT_AGNES_BASE_URL,
      model: DEFAULT_AGNES_MODEL,
      imageSize: '1K',
      count: 1,
    })
  })

  it('resolves GLM profile', () => {
    expect(resolveProvider({ provider: 'glm' })).toEqual({
      provider: 'glm',
      apiKeyEnv: 'ZHIPU_API_KEY',
      baseURL: DEFAULT_GLM_BASE_URL,
      model: DEFAULT_GLM_MODEL,
      imageSize: '1280x1280',
      count: 1,
    })
  })

  it('resolves Stability profile', () => {
    expect(resolveProvider({ provider: 'stability' })).toEqual({
      provider: 'stability',
      apiKeyEnv: 'STABILITY_API_KEY',
      baseURL: DEFAULT_STABILITY_BASE_URL,
      model: DEFAULT_STABILITY_MODEL,
      imageSize: '1024x1024',
      count: 1,
    })
  })

  it('resolves DashScope profile', () => {
    expect(resolveProvider({ provider: 'dashscope' })).toEqual({
      provider: 'dashscope',
      apiKeyEnv: 'DASHSCOPE_API_KEY',
      endpoint: DEFAULT_DASHSCOPE_ENDPOINT,
      model: DEFAULT_DASHSCOPE_MODEL,
      imageSize: '1024*1024',
      count: 1,
    })
  })

  it('resolves ComfyUI profile', () => {
    const result = resolveProvider({ provider: 'comfyui' })
    expect(result.provider).toBe('comfyui')
    expect(result.baseURL).toBe(DEFAULT_COMFYUI_BASE_URL)
    expect(result.timeoutMs).toBe(DEFAULT_COMFYUI_TIMEOUT_MS)
    expect(result.count).toBe(1)
  })
})

describe('Config Schema validation', () => {
  it('validates provider: dashscope without rejection', () => {
    const validated = Config({ provider: 'dashscope' })
    expect(validated.provider).toBe('dashscope')
    expect(validated.dashscopeModel).toBe(DEFAULT_DASHSCOPE_MODEL)
    expect(validated.dashscopeEndpoint).toBe(DEFAULT_DASHSCOPE_ENDPOINT)
  })

  it('defaults count to 1', () => {
    const validated = Config({})
    expect(validated.count).toBe(1)
  })

  it('resolves custom count into provider profile', () => {
    const resolved = resolveProvider({ count: 4 })
    expect(resolved.count).toBe(4)
  })
})

