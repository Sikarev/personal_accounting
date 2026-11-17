// Все строки интерфейса. Новые тексты добавляем сюда, в компонентах — только `t.раздел.ключ`.
// Тон — по docs/ux.md, раздел 5: на «вы», без восклицательных знаков, кнопки — глаголы.

export const ru = {
  app: {
    name: 'Домашняя бухгалтерия',
  },
  nav: {
    label: 'Основное меню',
    home: 'Главная',
    transactions: 'Операции',
    reports: 'Отчёты',
    accounts: 'Счета',
    settings: 'Настройки',
    more: 'Ещё',
    addTransaction: 'Добавить операцию',
  },
  common: {
    close: 'Закрыть',
    undo: 'Отменить',
    loading: 'Загрузка…',
  },
  dates: {
    today: 'Сегодня',
    yesterday: 'Вчера',
  },
  pages: {
    home: {
      emptyTitle: 'Здесь появится ваш баланс',
      emptyDescription:
        'Когда вы добавите счета и операции, на главной будут общий баланс, счета и последние траты.',
    },
    transactions: {
      emptyTitle: 'Здесь появятся ваши операции',
      emptyDescription: 'Расходы, доходы и переводы — по дням, с поиском и фильтрами.',
    },
    reports: {
      emptyTitle: 'Отчёты появятся вместе с операциями',
      emptyDescription: 'Покажем, куда уходят деньги и как меняется баланс от месяца к месяцу.',
    },
    accounts: {
      emptyTitle: 'Здесь будут ваши счета',
      emptyDescription:
        'Карты, наличные и вклады — общие для семьи и личные, которые видите только вы.',
    },
    settings: {
      emptyTitle: 'Настройки скоро появятся',
      emptyDescription: 'Категории, семья, профиль, экспорт и импорт данных.',
    },
    more: {
      accountsDescription: 'Карты, наличные, вклады',
      settingsDescription: 'Категории, семья, профиль',
    },
    notFound: {
      title: 'Такой страницы нет',
      description: 'Возможно, ссылка устарела. Начните с главной.',
      action: 'Перейти на главную',
    },
  },
  quickAdd: {
    title: 'Новая операция',
    stubTitle: 'Быстрый ввод скоро появится',
    stubDescription: 'Здесь можно будет внести расход или доход за несколько секунд.',
  },
  apiStatus: {
    label: 'Статус API',
    checking: 'API: проверка…',
    ok: 'API: работает',
    unavailable: 'API недоступен',
  },
} as const

/** Тип словаря без литеральных значений: другой язык обязан иметь те же ключи. */
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => R
    : { readonly [K in keyof T]: Widen<T[K]> }

export type Messages = Widen<typeof ru>
