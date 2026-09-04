/**
 * Стадия требования по артефактам репозитория.
 *
 * Плагин, из которого взят этот раздел, брал стадию только из доски Backlog.md
 * и без неё показывал пустой экран. Для poh-bft-writer это неверно: стадия
 * записана в самом документе (`stage` во frontmatter) и видна по составу
 * файлов эпика. Поэтому доска здесь — уточнение, а не условие работы.
 *
 * Что можно вывести честно, а что нет:
 *
 * | Артефакты эпика                   | Стадия      |
 * |-----------------------------------|-------------|
 * | ничего                            | To Do       |
 * | `{slug}-fast.md`                  | FAST-DONE   |
 * | `{slug}.md`, `stage: deep`        | DEEP-REVIEW |
 * | то же и страница опубликована     | DEEP-DONE   |
 *
 * `DEEP-WORK`, `REVIEW-DONE` и `Cancelled` по файлам не отличаются от соседей:
 * это состояния процесса, а не документа. Гадать о них по косвенным признакам
 * значило бы показать PO уверенную неправду, поэтому их даёт только доска —
 * а `stageSource` в модели говорит, откуда стадия взялась.
 */
import type { BftArtifacts, BftStage } from './model.js'
import { isPublished, parseFrontmatter } from './frontmatter.js'

export interface EpicFiles {
  /** Имена файлов в каталоге эпика. */
  entries: readonly string[]
  /** Текст единого документа `{slug}.md`, если он есть. */
  deepDocument?: string | null
}

export function artifactsOf(slug: string, entries: readonly string[]): BftArtifacts {
  const has = (name: string) => entries.some(entry => entry.toLowerCase() === name.toLowerCase())
  return {
    fast: has(`${slug}-fast.md`),
    deep: has(`${slug}.md`),
    html: has(`${slug}.html`) || has(`${slug}-fast.html`),
  }
}

export function stageFromArtifacts(slug: string, files: EpicFiles): BftStage {
  const artifacts = artifactsOf(slug, files.entries)
  if (!artifacts.deep) return artifacts.fast ? 'FAST-DONE' : 'To Do'

  const frontmatter = parseFrontmatter(files.deepDocument ?? '')
  // Единый документ есть, но stage в нём ещё fast — deep не доработал до конца.
  // Это ровно «шапка собрана», то же, что даёт отдельный -fast.md.
  if (frontmatter.stage && frontmatter.stage !== 'deep') return 'FAST-DONE'
  return isPublished(frontmatter) ? 'DEEP-DONE' : 'DEEP-REVIEW'
}
