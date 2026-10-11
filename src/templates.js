export const TEMPLATE_IDS = ['classic', 'plain']

export function templateId(value) {
  return TEMPLATE_IDS.includes(value) ? value : TEMPLATE_IDS[0]
}
