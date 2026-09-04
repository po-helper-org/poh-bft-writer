/**
 * Стадия требования по артефактам репозитория.
 *
 * Плагин, из которого взят этот раздел, брал стадию только из доски Backlog.md
 * и без неё показывал пустой экран. Для poh-bft-writer это неверно: стадия
 * записана в самом документе и видна по составу артефактов эпика. Доска здесь —
 * уточнение, а не условие работы.
 *
 * Стадия — не «какой файл появился», а **пройденный набор требований**:
 *
 * | Стадия      | Что должно быть                                                        |
 * |-------------|------------------------------------------------------------------------|
 * | `FAST-DONE` | документ и его страница ревью                                          |
 * | `DEEP-DONE` | единый документ со `stage: deep`, его страница, ссылки на Confluence и эпик |
 *
 * Набор неполон — задача не поднимается на стадию, а возвращается на
 * предыдущую: неполный deep уходит в `DEEP-REVIEW`, неполный fast — в `To Do`.
 * Чего именно не хватило, вердикт называет: «вернулось в DEEP-REVIEW» без этого
 * не отвечает на вопрос «что чинить».
 *
 * `DEEP-WORK`, `REVIEW-DONE` и `Cancelled` по артефактам не отличаются от
 * соседей — это состояния процесса, а не документа, и их даёт только доска.
 */
import { hasEpicKey, isPublished, parseFrontmatter, type Frontmatter } from './frontmatter.js'
import type { BftArtifacts, StageVerdict } from './model.js'

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
    fastHtml: has(`${slug}-fast.html`),
    deep: has(`${slug}.md`),
    deepHtml: has(`${slug}.html`),
  }
}

/** Требования стадии DEEP-DONE. Порядок — как их проверяет PO глазами. */
function deepGaps(artifacts: BftArtifacts, frontmatter: Frontmatter): string[] {
  const gaps: string[] = []
  if (!artifacts.deepHtml) gaps.push('страница ревью')
  if (!isPublished(frontmatter)) gaps.push('ссылка на страницу Confluence')
  if (!hasEpicKey(frontmatter)) gaps.push('ссылка на эпик JIRA')
  return gaps
}

/** Требования стадии FAST-DONE: документ и собранная по нему страница. */
function fastGaps(artifacts: BftArtifacts): string[] {
  const document = artifacts.fast || artifacts.deep
  const page = artifacts.fast ? artifacts.fastHtml : artifacts.deepHtml
  const gaps: string[] = []
  if (!document) gaps.push('документ БФТ')
  else if (!page) gaps.push('страница ревью')
  return gaps
}

export function stageFromArtifacts(slug: string, files: EpicFiles): StageVerdict {
  const artifacts = artifactsOf(slug, files.entries)
  const frontmatter = parseFrontmatter(files.deepDocument ?? '')

  // Единый документ есть, но `stage` в нём ещё не deep — глубокая проработка не
  // дошла до конца, и мерить его требованиями DEEP-DONE нечестно.
  if (artifacts.deep && frontmatter.stage === 'deep') {
    const gaps = deepGaps(artifacts, frontmatter)
    return gaps.length ? { stage: 'DEEP-REVIEW', missing: gaps } : { stage: 'DEEP-DONE', missing: [] }
  }

  const gaps = fastGaps(artifacts)
  return gaps.length ? { stage: 'To Do', missing: gaps } : { stage: 'FAST-DONE', missing: [] }
}
