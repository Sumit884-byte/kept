import { GEMMA_MODEL, cleanConclusion, gemmaMessages, generatedText } from './gemmaText.js'

let enginePromise

async function createEngine() {
  const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0')
  const dtype = 'q4f16'
  if (navigator.gpu) return pipeline('text-generation', GEMMA_MODEL, { dtype, device: 'webgpu' })
  return pipeline('text-generation', GEMMA_MODEL, { dtype, device: 'wasm' })
}

export function loadGemma() {
  if (!enginePromise) {
    enginePromise = createEngine().catch((error) => {
      enginePromise = null
      throw error
    })
  }
  return enginePromise
}

export async function concludeWithGemma(bundle, generator) {
  const run = generator || await loadGemma()
  const output = await run(gemmaMessages(bundle), { max_new_tokens: 40, do_sample: false })
  return cleanConclusion(generatedText(output), bundle.name, bundle.files)
}
