import { GEMMA_MODEL, cleanConclusion, gemmaMessages, generatedText } from './gemmaText.js'

let cached
let unavailable = false

export function gemmaPlans({ gpu = false, f16 = false, memory = 0, cores = 2, isolated = false } = {}) {
  const threads = isolated ? Math.max(1, Math.min(4, Number(cores) || 1)) : 1
  const light = Number(memory) > 0 && Number(memory) < 4
  const budget = light ? 800 : 1800
  const plans = []
  if (gpu && f16) plans.push({ device: 'webgpu', dtype: 'fp16', threads, budget })
  if (gpu) plans.push({ device: 'webgpu', dtype: 'fp32', threads, budget })
  plans.push({ device: 'wasm', dtype: 'fp32', threads, budget })
  return plans
}

export async function detectMachine() {
  const nav = typeof navigator === 'undefined' ? null : navigator
  let gpu = false
  let f16 = false
  if (nav?.gpu?.requestAdapter) {
    try {
      const adapter = await nav.gpu.requestAdapter()
      gpu = Boolean(adapter)
      f16 = Boolean(adapter?.features?.has?.('shader-f16'))
    } catch {
      gpu = false
    }
  }
  return {
    gpu,
    f16,
    memory: Number(nav?.deviceMemory) || 0,
    cores: Number(nav?.hardwareConcurrency) || 2,
    isolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
  }
}

async function openEngine(plan) {
  const key = `${plan.device}:${plan.dtype}:${plan.threads}`
  if (cached?.key === key) return cached.engine
  const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0')
  const wasm = env?.backends?.onnx?.wasm
  if (wasm) wasm.numThreads = plan.threads
  const engine = await pipeline('text-generation', GEMMA_MODEL, {
    dtype: plan.dtype,
    device: plan.device,
  })
  cached = { key, engine }
  return engine
}

async function sentence(engine, bundle, budget) {
  const output = await engine(gemmaMessages(bundle, budget), { max_new_tokens: 40, do_sample: false })
  return cleanConclusion(generatedText(output), bundle.name, bundle.files)
}

export function loadGemma() {
  return detectMachine().then((machine) => openEngine(gemmaPlans(machine)[0]))
}

export async function concludeWithGemma(bundle, generator) {
  if (generator) return sentence(generator, bundle, 1800)
  if (unavailable) throw new Error('unavailable')
  const plans = gemmaPlans(await detectMachine())
  let last = new Error('unavailable')
  let ran = false
  for (const plan of plans) {
    try {
      const engine = await openEngine(plan)
      ran = true
      const text = await sentence(engine, bundle, plan.budget)
      if (text) return text
    } catch (error) {
      last = error
      cached = null
    }
  }
  if (ran) return ''
  unavailable = true
  throw last
}
