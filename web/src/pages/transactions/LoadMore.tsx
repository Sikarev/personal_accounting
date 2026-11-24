import { Button, Paper, Text } from '@mantine/core'
import { useEffect, useState } from 'react'

import { useT } from '../../shared/i18n'
import { TransactionListSkeleton } from '../../shared/ui'
import classes from './TransactionsPage.module.css'

type LoadMoreProps = {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  /** Следующую страницу загрузить не удалось. */
  isNextPageError: boolean
  /** Лента сейчас перезапрашивается целиком — подгружать следующую страницу рано. */
  isRefetching: boolean
  /** Число загруженных страниц: после каждой наблюдатель проверяет конец списка заново. */
  pageCount: number
  fetchNextPage: () => unknown
}

/**
 * Подгрузка при прокрутке (requirements 5.8): `IntersectionObserver` следит за концом
 * списка и подгружает следующую страницу заранее, за экран до конца. Кнопка «Показать ещё» —
 * запасной путь для клавиатуры и браузера без наблюдателя. Ошибка следующей страницы —
 * строка с «Повторить» под списком: загруженное не пропадает, сама подгрузка не повторяется
 * в цикле.
 */
export function LoadMore({
  hasNextPage,
  isFetchingNextPage,
  isNextPageError,
  isRefetching,
  pageCount,
  fetchNextPage,
}: LoadMoreProps) {
  const t = useT()
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null)
  const autoLoad = hasNextPage && !isFetchingNextPage && !isNextPageError && !isRefetching

  useEffect(() => {
    if (!sentinel || !autoLoad || typeof IntersectionObserver === 'undefined') return
    // Новый наблюдатель сразу сообщает текущее пересечение: если после загрузки страницы
    // конец списка всё ещё на экране (короткие страницы), подгрузится следующая.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void fetchNextPage()
      },
      { rootMargin: '0px 0px 100% 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [sentinel, autoLoad, pageCount, fetchNextPage])

  if (!hasNextPage) return null
  return (
    <div ref={setSentinel} className={classes.loadMore}>
      {isNextPageError ? (
        <Paper withBorder radius="lg" p="md" className={classes.inlineError} role="alert">
          <Text size="sm">{t.feed.nextPageError}</Text>
          <Button
            variant="default"
            size="md"
            className={classes.touchButton}
            onClick={() => void fetchNextPage()}
          >
            {t.errors.retry}
          </Button>
        </Paper>
      ) : (
        <>
          {isFetchingNextPage && <TransactionListSkeleton groups={1} rowsPerGroup={2} />}
          {/* Без loading: отключённая кнопка потеряла бы фокус клавиатуры. */}
          <Button
            variant="default"
            size="md"
            className={classes.touchButton}
            onClick={() => {
              if (!isFetchingNextPage) void fetchNextPage()
            }}
          >
            {t.feed.showMore}
          </Button>
        </>
      )}
    </div>
  )
}
