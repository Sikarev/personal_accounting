import { apiErrorText, fieldErrorTexts, type FieldErrorOverrides } from '../../../shared/api'
import type { Messages } from '../../../shared/i18n'

/**
 * Тексты ошибок полей категорий по кодам нарушений (docs/api.md → «Ошибки»): `name_taken`
 * у имени — в форме, у `parentId` — при перемещении; `invalid_target` — при слиянии.
 */
export function categoryErrorOverrides(t: Messages): FieldErrorOverrides {
  const f = t.categories.form
  const e = t.categories.errors
  return {
    name: {
      name_taken: f.nameTaken,
      required: f.nameRequired,
      too_short: f.nameRequired,
      too_long: f.nameTooLong,
      invalid_format: f.nameInvalid,
    },
    parentId: {
      name_taken: e.nameTaken,
      invalid_parent: e.invalidParent,
      has_children: e.hasChildren,
    },
    targetId: { invalid_target: e.invalidTarget },
  }
}

/**
 * Текст ошибки действия без формы (перемещение, архив) — для тоста: ошибка поля из 422,
 * если она есть, иначе общий текст по коду ответа.
 */
export function categoryActionErrorText(error: unknown, t: Messages): string {
  const fields = fieldErrorTexts(error, t, categoryErrorOverrides(t))
  return fields.parentId ?? fields.name ?? fields.targetId ?? apiErrorText(error, t)
}
