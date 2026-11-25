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
    // Открытый с одной стороны период: «с 1 ноября», «по 15 ноября 2025».
    since: (date: string) => `с ${date}`,
    until: (date: string) => `по ${date}`,
  },
  pages: {
    reports: {
      emptyTitle: 'Отчёты появятся вместе с операциями',
      emptyDescription: 'Покажем, куда уходят деньги и как меняется баланс от месяца к месяцу.',
    },
    accounts: {
      emptyTitle: 'Создайте первый счёт',
      emptyDescription:
        'Карты, наличные и вклады — общие для семьи и личные, которые видите только вы.',
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
  // Экран «Счета», формы счёта, AccountPicker, выбор цвета.
  accounts: {
    create: 'Создать счёт',
    total: 'Всего на счетах',
    shared: 'Общие',
    private: 'Личные',
    privateHint: 'Их видите только вы',
    listLabel: (group: string) => `${group} счета`,
    archive: (count: number) => `Архив (${count})`,
    excluded: 'не в общем балансе',
    types: {
      cash: 'Наличные',
      card: 'Карта',
      bank_account: 'Банковский счёт',
      deposit: 'Вклад',
      credit_card: 'Кредитная карта',
      other: 'Другое',
    },
    colors: {
      none: 'Без цвета',
      blue: 'Синий',
      cyan: 'Голубой',
      teal: 'Бирюзовый',
      green: 'Зелёный',
      lime: 'Салатовый',
      yellow: 'Жёлтый',
      orange: 'Оранжевый',
      red: 'Красный',
      pink: 'Розовый',
      grape: 'Пурпурный',
      violet: 'Фиолетовый',
      indigo: 'Индиго',
      gray: 'Серый',
    },
    form: {
      createTitle: 'Новый счёт',
      editTitle: 'Изменить счёт',
      name: 'Название',
      type: 'Тип',
      currency: 'Валюта',
      initialBalance: 'Начальный остаток',
      initialBalanceHint: 'Сколько денег на счёте сейчас. Может быть отрицательным',
      visibility: 'Кто видит счёт',
      visibilityShared: 'Общий',
      visibilitySharedHint: 'Видят все участники семьи',
      visibilityPrivate: 'Личный',
      visibilityPrivateHint: 'Видите только вы',
      includeInTotal: 'Учитывать в общем балансе',
      color: 'Цвет',
      readOnlyHint: 'Валюту и видимость после создания не изменить',
      nameRequired: 'Введите название',
      submitCreate: 'Создать счёт',
      submitEdit: 'Сохранить',
      moreSettings: 'Ещё настройки',
      presetsLabel: 'Быстрый выбор',
    },
    actions: {
      adjust: 'Корректировать остаток',
      archive: 'Архивировать',
      unarchive: 'Вернуть',
      unarchiveLong: 'Вернуть из архива',
      delete: 'Удалить',
      moveUp: 'Выше',
      moveDown: 'Ниже',
      orderLabel: 'Порядок в группе',
    },
    adjust: {
      title: 'Корректировка остатка',
      current: 'Остаток в приложении',
      actual: 'Фактический остаток',
      actualHint: 'Сколько денег на счёте на самом деле. Разницу запишем операцией-корректировкой',
      submit: 'Исправить остаток',
      done: 'Остаток исправлен:',
      unchanged: 'Остаток не изменился',
      undoFailed: 'Не удалось отменить корректировку',
    },
    toasts: {
      archived: (name: string) => `Счёт «${name}» в архиве`,
      unarchived: (name: string) => `Счёт «${name}» возвращён из архива`,
      deleted: (name: string) => `Счёт «${name}» удалён`,
      restoreFailed: (name: string) => `Не удалось вернуть счёт «${name}»`,
      hasTransactions: 'На счёте уже есть операции, удалить его нельзя. Его можно архивировать.',
    },
    loadError: 'Не удалось загрузить счета',
    picker: {
      label: 'Счёт',
      title: 'Выберите счёт',
      empty: 'Нет счетов',
    },
  },
  // Перетаскивание (SortableList): подсказки и объявления для экранного диктора.
  sortable: {
    roleDescription: 'перемещаемый элемент',
    handle: (name: string) => `Переместить «${name}»`,
    instructions:
      'Чтобы переместить, нажмите пробел или Enter, затем стрелки вверх и вниз. Пробел или Enter — поставить, Escape — отменить.',
    picked: (name: string, pos: number, total: number) =>
      `«${name}» взят. Позиция ${pos} из ${total}.`,
    moved: (name: string, pos: number, total: number) => `«${name}»: позиция ${pos} из ${total}.`,
    dropped: (name: string, pos: number, total: number) =>
      `«${name}» поставлен на позицию ${pos} из ${total}.`,
    cancelled: (name: string) => `Перемещение отменено, «${name}» на прежнем месте.`,
  },
  moneyInput: {
    invalid: 'Введите сумму цифрами, например 1 250,50',
    tooLarge: 'Слишком большая сумма',
    integerOnly: 'В этой валюте сумма без дробной части',
    tooManyDecimals: (digits: number) => `Не больше ${digits} знаков после запятой`,
  },
  // Поле суммы с калькулятором (AmountInput).
  amountInput: {
    required: 'Введите сумму',
    notPositive: 'Сумма должна быть больше нуля',
    divisionByZero: 'На ноль делить нельзя',
    invalidExpression: 'Не получается посчитать. Проверьте знаки и скобки',
    calculator: 'Калькулятор',
    operatorsLabel: 'Знаки для расчёта',
    operators: {
      plus: 'Плюс',
      minus: 'Минус',
      times: 'Умножить',
      divide: 'Разделить',
      open: 'Открывающая скобка',
      close: 'Закрывающая скобка',
    },
  },
  // Выбор даты операции (DateQuickPicker).
  datePicker: {
    label: 'Дата',
    other: 'Другой день',
    apply: 'Выбрать дату',
    invalid: 'Выберите дату',
  },
  // Операции: общая форма создания и правки (TransactionForm), тосты.
  transactions: {
    kindLabel: 'Вид операции',
    kinds: { expense: 'Расход', income: 'Доход', transfer: 'Перевод' },
    amount: 'Сумма',
    fromAmount: 'Списано',
    toAmount: 'Зачислено',
    account: 'Счёт',
    from: 'Откуда',
    to: 'Куда',
    comment: 'Комментарий',
    rate: (rate: string) => `Курс: ${rate}`,
    submit: {
      expense: 'Сохранить расход',
      income: 'Сохранить доход',
      transfer: 'Сохранить перевод',
    },
    errors: {
      categoryRequired: 'Выберите категорию',
      toAmountRequired: 'Введите сумму зачисления',
    },
    noAccounts: {
      title: 'Сначала создайте счёт',
      description: 'Операции вносятся на счёт: карту, наличные или вклад.',
      action: 'Создать счёт',
    },
    transferNeedsTwo: {
      title: 'Для перевода нужно два счёта',
      description: 'Перевод — это движение денег между вашими счетами. Создайте второй счёт.',
      action: 'Создать счёт',
    },
    loadError: 'Не удалось загрузить счета и категории',
    readonly: {
      adjustment: 'Корректировку остатка нельзя изменить. Если она лишняя, удалите её.',
      notEditable:
        'Эту операцию может изменить только владелец личного счёта, на который она записана.',
    },
    toasts: {
      expense: (amount: string, category: string) => `Расход ${amount} · ${category}`,
      income: (amount: string, category: string) => `Доход ${amount} · ${category}`,
      transfer: (amount: string, from: string, to: string) => `Перевод ${amount} · ${from} → ${to}`,
      undoFailed: 'Не удалось отменить операцию',
    },
  },
  quickAdd: {
    title: 'Новая операция',
  },
  // Главная: общий баланс, счета, последние операции и форма быстрого ввода (desktop).
  home: {
    balanceTitle: 'Всего на счетах',
    accountsCount: { one: 'счёт', few: 'счёта', many: 'счетов' },
    noActiveAccounts: 'Активных счетов нет — все в архиве.',
    allAccounts: 'Все счета',
    accountsLoadError: 'Не удалось загрузить счета.',
    recentTitle: 'Последние операции',
    allTransactions: 'Все операции',
    recentLoadError: 'Не удалось загрузить операции.',
    emptyTitle: 'Здесь появятся ваши операции',
    emptyDescriptionMobile: 'Расходы, доходы и переводы — по дням, последние сверху.',
    emptyDescriptionDesktop: 'Внесите первую в форме «Новая операция» на этой странице.',
    focusForm: 'Ввести операцию',
    formTitle: 'Новая операция',
  },
  // Общий баланс в рублях и эквивалент валютного счёта (главная, «Счета»).
  balance: {
    // Для экранного диктора перед «≈ 46 175 ₽»: знак «≈» он читает по-разному.
    approximately: 'примерно',
    // «Включая 500 $ и 1 200 € по курсу ЦБ»: суммы — между началом и концом.
    includesStart: 'Включая',
    includesEnd: 'по курсу ЦБ',
    and: 'и',
    withoutRate: (codes: string) => `Без учёта счетов в ${codes} — нет курса ЦБ`,
  },
  // Онбординг на главной: первый счёт, затем — где вносить операции.
  onboarding: {
    title: 'Создайте первый счёт',
    lead: 'Счёт — где лежат деньги: карта, наличные, вклад. Для начала хватит одного, остальные можно добавить потом в разделе «Счета».',
    // Быстрые варианты: заполняют название и тип счёта.
    presets: {
      card: 'Карта',
      cash: 'Наличные',
      creditCard: 'Кредитная карта',
    },
    introTitle: 'Готово, счёт создан',
    introHintMobile: 'Операции вносятся кнопкой «+» внизу экрана.',
    introHintDesktop:
      'Операции вносятся в форме «Новая операция» на этой странице или кнопкой «Добавить операцию» в меню слева.',
    addFirst: 'Внести первую операцию',
    dismiss: 'Понятно',
  },
  auth: {
    tagline: 'Учёт личных и семейных финансов',
    modeLabel: 'Вход или регистрация',
    fields: {
      name: 'Имя',
      email: 'E-mail',
      password: 'Пароль',
      newPassword: 'Новый пароль',
      passwordHint: 'Не меньше 8 символов',
    },
    showPassword: 'Показать пароль',
    login: {
      title: 'Вход',
      tab: 'Вход',
      submit: 'Войти',
      forgotPassword: 'Забыли пароль?',
    },
    register: {
      title: 'Регистрация',
      tab: 'Регистрация',
      submit: 'Создать аккаунт',
      // Подпись согласия собирается из частей: две ссылки внутри текста.
      consentStart: 'Принимаю ',
      consentTerms: 'пользовательское соглашение',
      consentMiddle: ' и даю согласие на ',
      consentPrivacy: 'обработку персональных данных',
      opensInNewTab: '(откроется в новой вкладке)',
    },
    validation: {
      nameRequired: 'Введите имя',
      emailRequired: 'Введите e-mail',
      emailInvalid: 'Проверьте адрес: в нём должны быть @ и домен',
      emailTaken: 'Этот e-mail уже зарегистрирован. Войдите или восстановите пароль',
      passwordRequired: 'Введите пароль',
      passwordTooShort: 'Пароль должен быть не короче 8 символов',
      passwordTooLong: 'Пароль должен быть не длиннее 128 символов',
      consentRequired: 'Чтобы создать аккаунт, примите условия',
    },
    forgot: {
      title: 'Восстановление пароля',
      description:
        'Укажите e-mail, с которым вы регистрировались, — пришлём ссылку для нового пароля.',
      submit: 'Отправить ссылку',
      sentTitle: 'Проверьте почту',
      sentDescription: (email: string) =>
        `Если аккаунт с адресом ${email} есть, мы отправили на него письмо со ссылкой. Ссылка действует 1 час.`,
      sentHint: 'Письма нет? Проверьте папку «Спам» или укажите другой адрес.',
      otherEmail: 'Указать другой e-mail',
      backToLogin: 'Вернуться ко входу',
    },
    reset: {
      title: 'Новый пароль',
      description:
        'Придумайте новый пароль. После сохранения вы войдёте в приложение, а на остальных устройствах нужно будет войти заново.',
      submit: 'Сохранить пароль',
      success: 'Пароль изменён, вы вошли в приложение',
      invalidTitle: 'Ссылка недействительна',
      invalidDescription:
        'Ссылка устарела или уже использована. Запросите новое письмо — ссылка в нём действует 1 час.',
      requestNew: 'Запросить новое письмо',
    },
    verify: {
      checkingTitle: 'Проверяем ссылку…',
      successTitle: 'E-mail подтверждён',
      successDescription: 'Спасибо, адрес подтверждён. Можно продолжать.',
      invalidTitle: 'Ссылка недействительна',
      invalidSignedIn:
        'Ссылка устарела или уже использована. Новое письмо можно отправить с главной.',
      invalidGuest:
        'Ссылка устарела или уже использована. Войдите — и на главной можно будет отправить новое письмо.',
      alreadyTitle: 'Адрес уже подтверждён',
      alreadyDescription: 'Этот e-mail уже подтверждён, ничего делать не нужно.',
      errorTitle: 'Не удалось подтвердить e-mail',
      toHome: 'Перейти на главную',
      toLogin: 'Войти',
    },
    banner: {
      title: 'Подтвердите e-mail',
      description: (email: string) => `Письмо со ссылкой отправлено на ${email}.`,
      resend: 'Отправить ещё раз',
      resent: (email: string) => `Письмо отправлено на ${email}`,
      hide: 'Скрыть напоминание',
    },
    logout: 'Выйти',
    session: {
      errorTitle: 'Не удалось загрузить приложение',
    },
  },
  settings: {
    categoriesDescription: 'Расходы и доходы, подкатегории',
    comingSoon: 'Профиль, семья, экспорт и импорт данных появятся здесь позже.',
    back: 'Назад к настройкам',
  },
  categories: {
    title: 'Категории',
    tabsLabel: 'Вид категорий',
    kinds: { expense: 'Расходы', income: 'Доходы' },
    add: 'Добавить категорию',
    addSub: 'Добавить подкатегорию',
    rename: 'Переименовать',
    moveUp: 'Выше',
    moveDown: 'Ниже',
    moveTo: 'Переместить в…',
    archive: 'Архивировать',
    remove: 'Удалить…',
    actionsLabel: (name: string) => `Действия с категорией «${name}»`,
    treeLabel: { expense: 'Категории расходов', income: 'Категории доходов' },
    emptyTitle: {
      expense: 'Здесь будут категории расходов',
      income: 'Здесь будут категории доходов',
    },
    emptyDescription: 'По категориям видно, куда уходят и откуда приходят деньги.',
    errorTitle: 'Не удалось загрузить категории',
    archiveTitle: (count: number) => `Архив (${count})`,
    archiveHint:
      'Архивные категории не предлагаются при вводе операций, операции в них сохраняются.',
    restore: 'Вернуть',
    restoreLabel: (name: string) => `Вернуть «${name}»`,
    archived: (name: string) => `Категория «${name}» в архиве`,
    moved: (name: string) => `Категория «${name}» перемещена`,
    // Родительный падеж после «и»: «и 1 подкатегории», «и 5 подкатегорий».
    subcategoriesOf: { one: 'подкатегории', few: 'подкатегорий', many: 'подкатегорий' },
    form: {
      name: 'Название',
      createTitle: 'Новая категория',
      createSubTitle: (parent: string) => `Новая подкатегория в «${parent}»`,
      renameTitle: 'Переименовать категорию',
      createSubmit: 'Создать категорию',
      createSubSubmit: 'Создать подкатегорию',
      renameSubmit: 'Сохранить название',
      nameRequired: 'Введите название',
      nameTooLong: 'Название — не длиннее 60 символов',
      nameTaken: 'Категория с таким названием уже есть — возможно, в архиве',
      nameInvalid: 'Уберите из названия служебные символы (перенос строки, табуляцию)',
    },
    move: {
      title: (name: string) => `Переместить «${name}»`,
      label: 'Куда переместить',
      topLevel: 'Верхний уровень',
      current: 'Сейчас здесь',
      hasChildren:
        'У категории есть подкатегории (в том числе в архиве), поэтому она может быть только на верхнем уровне.',
      submit: 'Переместить',
    },
    merge: {
      title: (name: string) => `Удалить «${name}»`,
      description: (name: string, children: string | null) =>
        children
          ? `Операции из «${name}» и ${children} перейдут в выбранную категорию. «${name}» и его подкатегории будут удалены.`
          : `Операции из «${name}» перейдут в выбранную категорию. «${name}» будет удалена.`,
      irreversible: 'Это нельзя отменить.',
      target: 'Куда перенести операции',
      targetRequired: 'Выберите категорию, в которую перенести операции',
      noTargets:
        'Нет другой категории этого вида. Сначала создайте категорию, в которую перенесутся операции.',
      submit: 'Перенести и удалить',
      done: (name: string, target: string) =>
        `Категория «${name}» удалена, операции перенесены в «${target}»`,
    },
    errors: {
      nameTaken: 'Там уже есть категория с таким названием — возможно, в архиве',
      invalidParent: 'Туда переместить нельзя. Обновите страницу и попробуйте снова',
      hasChildren: 'Категорию с подкатегориями нельзя сделать подкатегорией',
      invalidTarget: 'Эта категория не подходит. Выберите другую',
    },
    dnd: {
      handle: (name: string) => `Перетащить «${name}»`,
      roleDescription: 'перетаскиваемая категория',
      instructions:
        'Чтобы переместить категорию, нажмите пробел или Enter. Стрелки вверх и вниз меняют место, вправо — сделать подкатегорией, влево — вынести на верхний уровень. Пробел или Enter — положить, Esc — отменить.',
      picked: (name: string) => `Категория «${name}» взята.`,
      position: (name: string, place: string, index: number, total: number) =>
        `«${name}»: ${place}, место ${index} из ${total}.`,
      topLevel: 'верхний уровень',
      inParent: (parent: string) => `в «${parent}»`,
      notAllowed: (name: string) => `«${name}» сюда поставить нельзя.`,
      dropped: (name: string) => `Категория «${name}» перемещена.`,
      unchanged: (name: string) => `Категория «${name}» осталась на месте.`,
      cancelled: (name: string) => `Перемещение отменено, «${name}» на прежнем месте.`,
    },
    picker: {
      frequent: 'Частые категории',
      search: 'Категория',
      nothingFound: 'Ничего не нашлось',
    },
  },
  // Экран «Операции»: лента, фильтры, итоги, строка операции (TransactionRow).
  feed: {
    // Объявления для экранного диктора (role="status").
    updated: 'Лента обновлена',
    loadedMore: (count: string) => `Загружено ещё ${count}`,
    operations: { one: 'операция', few: 'операции', many: 'операций' },
    dayTotalLabel: 'Итог дня',
    loadError: 'Не удалось загрузить операции',
    nextPageError: 'Не удалось загрузить следующие операции.',
    showMore: 'Показать ещё',
    emptyTitle: 'Здесь появятся ваши операции',
    emptyDescription: 'Расходы, доходы и переводы — по дням, с поиском и фильтрами.',
    nothingFoundTitle: 'Ничего не найдено',
    nothingFoundDescription: 'Под эти фильтры не подходит ни одна операция.',
    resetFilters: 'Сбросить фильтры',
    resetAll: 'Сбросить всё',
    summary: {
      title: 'Итоги',
      filteredTitle: 'Итоги по фильтрам',
      expense: 'Расходы',
      income: 'Доходы',
      difference: 'Разница',
      empty: 'Расходов и доходов нет',
      loadError: 'Не удалось загрузить итоги.',
    },
    filters: {
      title: 'Фильтры',
      label: 'Фильтры операций',
      open: 'Фильтры',
      openWithCount: (count: number) => `Фильтры (${count})`,
      apply: 'Показать операции',
      search: 'Поиск по комментарию',
      period: 'Период',
      periods: {
        all: 'Всё время',
        thisMonth: 'Этот месяц',
        lastMonth: 'Прошлый месяц',
        thisYear: 'Этот год',
        custom: 'Свой период',
      },
      customLabel: 'Границы периода',
      from: 'Начало периода',
      to: 'Конец периода',
      kind: 'Вид операций',
      kinds: {
        expense: 'Расходы',
        income: 'Доходы',
        transfer: 'Переводы',
        adjustment: 'Корректировки',
      },
      accounts: 'Счета',
      categories: 'Категории',
      categoryGroups: { expense: 'Расходы', income: 'Доходы' },
      archived: (name: string) => `${name} (в архиве)`,
      nothingFound: 'Ничего не нашлось',
      clear: (field: string) => `Очистить поле «${field}»`,
      unknownCategory: 'Категория недоступна',
      activeLabel: 'Выбранные фильтры',
      remove: (label: string) => `Убрать фильтр: ${label}`,
      query: (q: string) => `«${q}»`,
    },
    row: {
      adjustment: 'Корректировка остатка',
      noCategory: 'Без категории',
      unknownAccount: 'Счёт недоступен',
      deletedAuthor: 'Удалённый участник',
      // Перевод с чужого личного счёта на общий или обратно: личный счёт скрыт,
      // вместо него — владелец (requirements, раздел 4).
      incomingFrom: (name: string) => `Пополнение: ${name}`,
      outgoingTo: (name: string) => `Снятие: ${name}`,
      actions: (title: string) => `Действия с операцией «${title}»`,
    },
    actions: {
      edit: 'Изменить',
      duplicate: 'Дублировать',
      delete: 'Удалить',
    },
    edit: {
      title: 'Изменить операцию',
      cancel: 'Отмена',
      inlineLabel: (title: string) => `Изменение операции «${title}»`,
      unsavedHint: 'Сохраните или отмените изменения',
    },
    toasts: {
      edited: 'Операция изменена',
      deleted: 'Операция удалена',
      restoreFailed: 'Не удалось вернуть операцию.',
    },
  },
  legal: {
    draftNotice: 'Это черновик: окончательный текст документа появится до запуска сервиса.',
    back: 'Вернуться в приложение',
    privacy: {
      title: 'Политика обработки персональных данных',
      paragraphs: [
        'Здесь будет описано, какие персональные данные мы собираем (имя, адрес электронной почты, данные о ваших финансовых операциях), зачем и как долго храним их.',
        'Данные хранятся на серверах в России и не передаются третьим лицам, кроме случаев, предусмотренных законом.',
        'Вы сможете в любой момент выгрузить свои данные или удалить аккаунт.',
      ],
    },
    terms: {
      title: 'Пользовательское соглашение',
      paragraphs: [
        'Здесь будут условия использования сервиса «Домашняя бухгалтерия»: права и обязанности сторон, порядок регистрации и удаления аккаунта.',
        'Сервис помогает вести учёт личных и семейных финансов и не является банком или платёжной системой.',
      ],
    },
  },
  lazyRoute: {
    errorTitle: 'Не удалось загрузить экран',
    errorDescription:
      'Возможно, пропала связь или вышла новая версия приложения. Обновите страницу.',
    reload: 'Обновить страницу',
  },
  errors: {
    network: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
    invalidCredentials: 'Неверный e-mail или пароль.',
    tooManyRequests: (wait: string) => `Слишком много попыток. Попробуйте через ${wait}.`,
    tooManyRequestsLater: 'Слишком много попыток. Попробуйте немного позже.',
    minutes: { one: 'минуту', few: 'минуты', many: 'минут' },
    sessionExpired: 'Сеанс завершён. Войдите снова.',
    forbiddenOrigin:
      'Запрос отклонён из соображений безопасности. Обновите страницу и попробуйте снова.',
    validation: 'Проверьте данные в форме.',
    notFound: 'Не нашли то, что вы искали. Возможно, это уже удалено.',
    accountHasTransactions:
      'На счёте есть операции, поэтому его нельзя удалить — только архивировать.',
    accountArchived: 'Счёт в архиве. Верните его из архива, чтобы исправить остаток.',
    transactionReadonly:
      'Эту операцию может изменить только владелец личного счёта, который в ней участвует.',
    adjustmentReadonly: 'Корректировку остатка нельзя изменить — только удалить.',
    reorderFailed: 'Не удалось сохранить порядок счетов.',
    server: 'На сервере что-то пошло не так. Попробуйте ещё раз через пару минут.',
    generic: 'Не получилось. Обновите страницу и попробуйте снова.',
    retry: 'Повторить',
    field: {
      required: 'Заполните это поле',
      tooLong: 'Слишком длинное значение',
      tooShort: 'Слишком короткое значение',
      invalidFormat: 'Проверьте формат',
      invalid: 'Проверьте значение',
      // Операции (docs/api.md → «Операции»).
      invalidAccount: 'Этот счёт недоступен — возможно, его архивировали. Выберите другой',
      sameAccount: 'Счета «Откуда» и «Куда» должны различаться',
      invalidCategory: 'Эта категория недоступна — возможно, её архивировали. Выберите другую',
      notAllowed: 'Это поле не подходит для такого вида операции',
      toAmountMismatch: 'У счетов одна валюта — суммы списания и зачисления должны совпадать',
    },
  },
  apiStatus: {
    label: 'Статус API',
    checking: 'API: проверка…',
    ok: 'API: работает',
    unavailable: 'API недоступен',
    // Второй бейдж — проверка связки «контракт → клиент orval → API → Postgres».
    currenciesChecking: 'Валюты: загрузка…',
    currenciesError: 'Валюты: ошибка',
    currencies: { one: 'валюта', few: 'валюты', many: 'валют' },
  },
} as const

/** Тип словаря без литеральных значений: другой язык обязан иметь те же ключи. */
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => R
    : { readonly [K in keyof T]: Widen<T[K]> }

export type Messages = Widen<typeof ru>
