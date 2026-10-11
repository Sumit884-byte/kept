// Link unfurlers, crawlers and scripts ask for an address without a person reading it.
const AUTOMATED = /(?<!cu)bot\b|crawl|spider|slurp|preview|unfurl|cardyb|facebookexternalhit|whatsapp|curl\/|wget\/|python|aiohttp|go-http|okhttp|axios|undici|^node$|java\/|apache-httpclient|libwww|httpie|postman|headless|monitor/i

export function isAutomated(userAgent) {
  const agent = String(userAgent || '').trim()
  return !agent || AUTOMATED.test(agent)
}
