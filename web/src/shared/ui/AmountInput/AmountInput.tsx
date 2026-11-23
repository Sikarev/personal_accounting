import { Text, TextInput, UnstyledButton } from '@mantine/core'
import { useMergedRef } from '@mantine/hooks'
import { useRef, type ReactNode, type Ref } from 'react'

import { useT } from '../../i18n'
import { AMOUNT_INPUT_MAX_LENGTH, evaluateAmount } from '../../lib/amountExpression'
import { useMobileLayout } from '../../lib/useMobileLayout'
import { Money } from '../Money/Money'
import classes from './AmountInput.module.css'

export type AmountInputProps = {
  /** Подпись поля: «Сумма», «Списано», «Зачислено». */
  label: string
  /** Текст поля как есть: число или выражение (`350+120*2`). */
  value: string
  onChange: (value: string) => void
  /** Валюта счёта: код справа в поле и итог выражения. */
  currency: string
  /** Знаков в минимальной единице валюты (`GET /currencies`): округление итога. */
  minorUnits: number
  error?: ReactNode
  /**
   * Ряд кнопок `+ − × ÷ ( )` под полем. По умолчанию — в мобильной раскладке:
   * на цифровой клавиатуре телефона этих знаков нет.
   */
  showOperators?: boolean
  /** Фокус в поле при появлении (быстрый ввод: «фокус сразу в сумме»). */
  autoFocus?: boolean
  inputRef?: Ref<HTMLInputElement>
  required?: boolean
}

// Что вставляет кнопка и как она подписана для экранного диктора.
const OPERATORS = [
  { symbol: '+', label: 'plus' },
  { symbol: '−', label: 'minus' },
  { symbol: '×', label: 'times' },
  { symbol: '÷', label: 'divide' },
  { symbol: '(', label: 'open' },
  { symbol: ')', label: 'close' },
] as const

/**
 * Поле суммы операции — калькулятор (ux.md, «Быстрый ввод»): `350+120*2` → под полем
 * «= 590 ₽». Разбор и округление — `evaluateAmount` (shared/lib/amountExpression.ts);
 * ошибку («Сумма должна быть больше нуля») форма показывает при сохранении, а не на
 * каждый символ: недописанное «350+» — ещё не ошибка.
 *
 * - `inputmode="decimal"`: на телефоне — цифровая клавиатура с запятой.
 * - Кнопки операторов не забирают фокус у поля (`mousedown` отменён): клавиатура телефона
 *   не прячется, знак вставляется в позицию курсора. В порядке Tab их нет — с физической
 *   клавиатуры знаки вводятся напрямую, а Tab из суммы ведёт сразу к категории.
 * - Enter — обычная отправка формы, в которой стоит поле.
 */
export function AmountInput({
  label,
  value,
  onChange,
  currency,
  minorUnits,
  error,
  showOperators,
  autoFocus,
  inputRef,
  required,
}: AmountInputProps) {
  const t = useT()
  const mobile = useMobileLayout()
  const ownRef = useRef<HTMLInputElement>(null)
  const ref = useMergedRef(ownRef, inputRef)
  const result = evaluateAmount(value, minorUnits, t)
  const operators = showOperators ?? mobile

  const insert = (symbol: string) => {
    const input = ownRef.current
    const start = input?.selectionStart ?? value.length
    const end = input?.selectionEnd ?? value.length
    const next = (value.slice(0, start) + symbol + value.slice(end)).slice(
      0,
      AMOUNT_INPUT_MAX_LENGTH,
    )
    onChange(next)
    const caret = Math.min(start + symbol.length, next.length)
    // Курсор — после вставленного знака, когда React уже записал новое значение.
    requestAnimationFrame(() => {
      if (!input) return
      if (document.activeElement !== input) input.focus()
      input.setSelectionRange(caret, caret)
    })
  }

  return (
    <div className={classes.root}>
      <TextInput
        ref={ref}
        size="md"
        label={label}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        inputMode="decimal"
        autoComplete="off"
        maxLength={AMOUNT_INPUT_MAX_LENGTH}
        required={required}
        withAsterisk={false}
        autoFocus={autoFocus}
        data-autofocus={autoFocus || undefined}
        error={error}
        // Итог выражения — под полем (описание входит в aria-describedby поля).
        inputWrapperOrder={['label', 'input', 'description', 'error']}
        description={
          result.ok && result.isExpression && currency ? (
            <span className={classes.result}>
              = <Money amount={result.value} currency={currency} minorUnits={minorUnits} />
            </span>
          ) : undefined
        }
        classNames={{ input: classes.input, description: classes.description }}
        rightSection={
          <Text size="sm" c="dimmed" aria-hidden>
            {currency}
          </Text>
        }
        rightSectionPointerEvents="none"
      />
      {operators && (
        <div role="group" aria-label={t.amountInput.operatorsLabel} className={classes.operators}>
          {OPERATORS.map(({ symbol, label: key }) => (
            <UnstyledButton
              key={key}
              type="button"
              tabIndex={-1}
              className={classes.operator}
              aria-label={t.amountInput.operators[key]}
              // Фокус остаётся в поле: иначе на телефоне спрячется клавиатура.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insert(symbol)}
            >
              {symbol}
            </UnstyledButton>
          ))}
        </div>
      )}
    </div>
  )
}
