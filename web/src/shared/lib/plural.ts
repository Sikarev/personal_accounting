import { LOCALE } from '../i18n'

/**
 * Формы слова для русского языка: «1 операция», «2 операции», «5 операций».
 * `other` — для дробных чисел («1,5 операции»); если не задана, берётся `few`.
 */
export type PluralForms = {
  one: string
  few: string
  many: string
  other?: string
}

const rules = new Intl.PluralRules(LOCALE)
const numberFormat = new Intl.NumberFormat(LOCALE)

/** Подбирает форму слова под число: `plural(5, forms)` → «операций». */
export function plural(count: number, forms: PluralForms): string {
  switch (rules.select(count)) {
    case 'one':
      return forms.one
    case 'few':
      return forms.few
    case 'many':
      return forms.many
    default:
      return forms.other ?? forms.few
  }
}

/** Число вместе со словом: `formatCount(21, forms)` → «21 операция», `1500` → «1 500 операций». */
export function formatCount(count: number, forms: PluralForms): string {
  return `${numberFormat.format(count)} ${plural(count, forms)}`
}
