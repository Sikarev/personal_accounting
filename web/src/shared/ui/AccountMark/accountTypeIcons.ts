import {
  IconBuildingBank,
  IconCash,
  IconCreditCard,
  IconCreditCardPay,
  IconPigMoney,
  IconWallet,
  type Icon,
} from '@tabler/icons-react'

import type { AccountType } from '../../api'

/** Иконка типа счёта (один набор — Tabler). */
export const accountTypeIcons: Record<AccountType, Icon> = {
  cash: IconCash,
  card: IconCreditCard,
  bank_account: IconBuildingBank,
  deposit: IconPigMoney,
  credit_card: IconCreditCardPay,
  other: IconWallet,
}
