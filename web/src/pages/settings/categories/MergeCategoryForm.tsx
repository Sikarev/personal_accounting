import { Alert, Button, Stack, Text } from '@mantine/core'
import { IconAlertCircle } from '@tabler/icons-react'
import { useMemo, useState, type FormEvent } from 'react'

import { apiErrorText, fieldErrorTexts, type Category } from '../../../shared/api'
import { useT } from '../../../shared/i18n'
import { categoryOptions, childrenOf } from '../../../shared/lib/categoryTree'
import { formatCount } from '../../../shared/lib/plural'
import { CategoryPicker } from '../../../shared/ui/CategoryPicker/CategoryPicker'
import { icons } from '../../../theme'
import { categoryErrorOverrides } from './categoryErrors'

/**
 * Удаление категории — только слиянием (docs/api.md → «Категории»): операции категории
 * и её подкатегорий переходят в выбранную, подкатегории и сама категория удаляются.
 * Необратимо, поэтому здесь подтверждение уместно (ux.md, принцип 4), а тоста с отменой нет.
 */
export function MergeCategoryForm({
  category,
  categories,
  onSubmit,
}: {
  category: Category
  /** Все категории семьи: цель выбирается среди активных того же вида. */
  categories: readonly Category[]
  /** Слить; промис отклоняется ошибкой API — форма покажет её. */
  onSubmit: (targetId: string) => Promise<unknown>
}) {
  const t = useT()
  const [targetId, setTargetId] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const children = useMemo(() => childrenOf(categories, category.id), [categories, category.id])
  const exclude = useMemo(
    () => [category.id, ...children.map((c) => c.id)],
    [category.id, children],
  )
  const hasTargets = categoryOptions(categories, category.kind, exclude).length > 0

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    if (targetId === null) return setFieldError(t.categories.merge.targetRequired)
    setPending(true)
    setError(null)
    try {
      await onSubmit(targetId)
    } catch (e) {
      const fields = fieldErrorTexts(e, t, categoryErrorOverrides(t))
      if (fields.targetId) setFieldError(fields.targetId)
      else setError(apiErrorText(e, t))
    } finally {
      setPending(false)
    }
  }

  const childrenText =
    children.length > 0 ? formatCount(children.length, t.categories.subcategoriesOf) : null

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Stack gap="md">
        <Text>
          {t.categories.merge.description(category.name, childrenText)}{' '}
          <Text span fw={600}>
            {t.categories.merge.irreversible}
          </Text>
        </Text>
        {error && (
          <Alert
            color="red"
            variant="light"
            role="alert"
            icon={<IconAlertCircle size={icons.size.md} stroke={icons.stroke} />}
          >
            {error}
          </Alert>
        )}
        {hasTargets ? (
          <>
            <CategoryPicker
              categories={categories}
              kind={category.kind}
              value={targetId}
              onChange={(id) => {
                setTargetId(id)
                setFieldError(null)
              }}
              exclude={exclude}
              label={t.categories.merge.target}
              error={fieldError}
              required
              autoFocus
            />
            {/* red.9: белый текст на нём — 5.6:1; оттенок темы по умолчанию (red.7) — ниже AA. */}
            <Button type="submit" size="md" color="red.9" fullWidth loading={pending}>
              {t.categories.merge.submit}
            </Button>
          </>
        ) : (
          <Text c="dimmed">{t.categories.merge.noTargets}</Text>
        )}
      </Stack>
    </form>
  )
}
