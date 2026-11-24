import { Text, TextInput, UnstyledButton } from '@mantine/core'
import { useMergedRef } from '@mantine/hooks'
import { IconCalculator } from '@tabler/icons-react'
import { useId, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react'

import { useT } from '../../i18n'
import { AMOUNT_INPUT_MAX_LENGTH, evaluateAmount } from '../../lib/amountExpression'
import { useMobileLayout } from '../../lib/useMobileLayout'
import { Money } from '../Money/Money'
import { icons } from '../../../theme'
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
   * Кнопка «Калькулятор» в поле: открывает под полем ряд `+ − × ÷ ( )`. По умолчанию —
   * в мобильной раскладке: на цифровой клавиатуре телефона этих знаков нет.
   */
  showOperators?: boolean
  /** Ряд знаков открыт сразу (Storybook, e2e). */
  defaultOperatorsOpen?: boolean
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
 * Поле суммы операции — калькулятор (ux.md, «Быстрый ввод»): `350+120*2` → «= 590 ₽»
 * в строке подписи справа (так поле не растёт в высоту и чипы категорий остаются над
 * клавиатурой телефона). Разбор и округление — `evaluateAmount`
 * (shared/lib/amountExpression.ts); ошибку («Сумма должна быть больше нуля») форма
 * показывает при сохранении, а не на каждый символ: недописанное «350+» — ещё не ошибка.
 *
 * - `inputmode="decimal"`: на телефоне — цифровая клавиатура с запятой.
 * - На mobile ряд знаков скрыт, открывается кнопкой «Калькулятор» в поле и остаётся открытым,
 *   пока форма на экране. Кнопки не забирают фокус у поля (`mousedown` отменён): клавиатура
 *   телефона не прячется, знак вставляется в позицию курсора. В порядке Tab их нет — с
 *   физической клавиатуры знаки вводятся напрямую, а Tab из суммы ведёт сразу к категории.
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
  defaultOperatorsOpen = false,
  autoFocus,
  inputRef,
  required,
}: AmountInputProps) {
  const t = useT()
  const mobile = useMobileLayout()
  const ownRef = useRef<HTMLInputElement>(null)
  const ref = useMergedRef(ownRef, inputRef)
  const result = evaluateAmount(value, minorUnits, t)
  const calculator = showOperators ?? mobile
  const [operatorsOpen, setOperatorsOpen] = useState(defaultOperatorsOpen)
  const operatorsId = useId()
  const pendingCaretRef = useRef<number | null>(null)

  const insert = (symbol: string) => {
    const input = ownRef.current
    const start = input?.selectionStart ?? value.length
    const end = input?.selectionEnd ?? value.length
    const next = (value.slice(0, start) + symbol + value.slice(end)).slice(
      0,
      AMOUNT_INPUT_MAX_LENGTH,
    )
    pendingCaretRef.current = Math.min(start + symbol.length, next.length)
    onChange(next)
  }

  // Курсор — после вставленного знака, сразу как React записал новое значение (layout-эффект
  // идёт до следующего ввода: при requestAnimationFrame быстрый набор успевал вклиниться).
  useLayoutEffect(() => {
    const caret = pendingCaretRef.current
    const input = ownRef.current
    if (caret === null || !input) return
    pendingCaretRef.current = null
    if (document.activeElement !== input) input.focus()
    input.setSelectionRange(caret, caret)
  }, [value])

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
        // Итог выражения — справа в строке подписи (описание входит в aria-describedby
        // поля). Раскладка строки — сеткой в CSS-модуле.
        inputWrapperOrder={['label', 'description', 'input', 'error']}
        description={
          result.ok && result.isExpression && currency ? (
            <span className={classes.result}>
              = <Money amount={result.value} currency={currency} minorUnits={minorUnits} />
            </span>
          ) : undefined
        }
        classNames={{
          root: classes.field,
          label: classes.label,
          description: classes.description,
          wrapper: classes.wrapper,
          error: classes.error,
          input: classes.input,
        }}
        rightSectionWidth={calculator ? 'calc(var(--app-touch-target) * 2)' : undefined}
        rightSection={
          <span className={classes.right}>
            <Text size="sm" c="dimmed" aria-hidden className={classes.currency}>
              {currency}
            </Text>
            {calculator && (
              <UnstyledButton
                type="button"
                tabIndex={-1}
                className={classes.toggle}
                aria-label={t.amountInput.calculator}
                aria-expanded={operatorsOpen}
                aria-controls={operatorsOpen ? operatorsId : undefined}
                data-active={operatorsOpen || undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setOperatorsOpen((open) => !open)}
              >
                <IconCalculator size={icons.size.md} stroke={icons.stroke} aria-hidden />
              </UnstyledButton>
            )}
          </span>
        }
      />
      {calculator && operatorsOpen && (
        <div
          id={operatorsId}
          role="group"
          aria-label={t.amountInput.operatorsLabel}
          className={classes.operators}
        >
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
