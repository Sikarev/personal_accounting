import { useId } from 'react'

import { useT } from '../../shared/i18n'
import { FORM_KINDS, type TransactionFormKind } from './formState'
import classes from './KindSwitch.module.css'

/**
 * Переключатель «Расход / Доход / Перевод»: группа радиокнопок в виде сегментов.
 *
 * Свой, а не `SegmentedControl` Mantine: у того подписи в одну строку с индикатором,
 * который двигается по измеренным размерам, и при шрифте 200 % на 375 px слова рвутся
 * по буквам («Рас/ход»). Здесь сегменты — flex с переносом: не помещаются в строку — третий
 * уходит на следующую, слово целиком.
 *
 * Клавиатура — как у радиокнопок: Tab заходит в группу, стрелки переключают.
 */
export function KindSwitch({
  value,
  onChange,
}: {
  value: TransactionFormKind
  onChange: (kind: TransactionFormKind) => void
}) {
  const t = useT()
  const name = useId()
  return (
    <div role="radiogroup" aria-label={t.transactions.kindLabel} className={classes.root}>
      {FORM_KINDS.map((kind) => (
        <label key={kind} className={classes.item} data-active={kind === value || undefined}>
          <input
            type="radio"
            name={name}
            value={kind}
            checked={kind === value}
            onChange={() => onChange(kind)}
            className={classes.input}
          />
          {t.transactions.kinds[kind]}
        </label>
      ))}
    </div>
  )
}
