import { Text, VisuallyHidden } from '@mantine/core'

import type { Account } from '../../api'
import { useT } from '../../i18n'
import { BASE_CURRENCY, baseEquivalent, isNegativeBalanceProblem } from '../../lib/accounts'
import { Money, type MoneyProps } from '../Money/Money'
import classes from './AccountBalance.module.css'

export type AccountBalanceProps = {
  account: Pick<Account, 'type' | 'balance' | 'currency' | 'baseBalance'>
  /** Насыщенность суммы счёта (у эквивалента — обычная). */
  fw?: MoneyProps['fw']
  /** Перенос огромной суммы по разрядам (`Money wrap`) — в строках списка. */
  wrap?: boolean
  className?: string
}

/**
 * Остаток счёта (ux.md, «Деньги»): сумма в валюте счёта, у валютного под ней мелко
 * и приглушённо — эквивалент в рублях по курсу ЦБ («≈ 46 175 ₽»).
 *
 * Эквивалент всегда до рублей: он приблизительный, копейки изображали бы точность,
 * которой у курса нет. Отрицательный — со знаком, но не красным: проблему уже показывает
 * сумма счёта (`isNegativeBalanceProblem`). У рублёвого счёта и у валюты без курса
 * эквивалента нет — без прочерков и предупреждений (пояснение — у общего баланса).
 *
 * Выравнивание — по правому краю (`text-align: end`); узкая строка может переопределить.
 */
export function AccountBalance({ account, fw, wrap = false, className }: AccountBalanceProps) {
  const t = useT()
  const equivalent = baseEquivalent(account)
  return (
    <span className={className ? `${classes.root} ${className}` : classes.root}>
      <Money
        amount={account.balance}
        currency={account.currency}
        variant={isNegativeBalanceProblem(account) ? 'balance' : 'plain'}
        fw={fw}
        wrap={wrap}
        display="block"
      />
      {equivalent !== null && (
        <Text component="span" display="block" size="xs" c="dimmed">
          {/* Неразрывный пробел: «≈» не остаётся один на строке. */}
          <span aria-hidden>≈{' '}</span>
          <VisuallyHidden component="span">{t.balance.approximately} </VisuallyHidden>
          <Money amount={equivalent} currency={BASE_CURRENCY} roundToMajor wrap={wrap} />
        </Text>
      )}
    </span>
  )
}
