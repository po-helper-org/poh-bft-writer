/**
 * Контакты верификации из frontmatter документа БФТ (US-16, ADR-0005).
 *
 * Авторитет — поле `contacts:` документа (спека R7): письмо fast и personas.csv
 * производные, UI-чипы читают только frontmatter. Полный YAML не нужен:
 * блок — список встроенных карт `  - {role: …, name: …, email: …}` в духе
 * остального разбора этого репозитория (см. frontmatter.ts).
 *
 * Роль без контакта или контакт без email — не заглушка, а открытый вопрос:
 * «укажите контакт» (US-16). Пропущенная роль попадает туда же.
 */

/** Три роли верификации (спека, §User Stories 16). */
export type ContactRole = 'customer' | 'po' | 'tech-lead'

export const CONTACT_ROLES: readonly ContactRole[] = ['customer', 'po', 'tech-lead']

export const ROLE_TITLES: Record<ContactRole, string> = {
  customer: 'Заказчик',
  po: 'PO',
  'tech-lead': 'Техлид',
}

export interface Contact {
  role: ContactRole
  /** Имя может не знать даже fast-прогон — необязательное. */
  name?: string
  /** Пустого email нет в списке contacts: такие строки не пишем (см. parseContacts). */
  email?: string
}

export interface ContactsVerdict {
  contacts: Contact[]
  /** Роли, по которым есть открытый вопрос: нет строки, нет email. */
  missing: ContactRole[]
  /** Готовые формулировки открытых вопросов — в письмо и карточку результата. */
  questions: string[]
}

const ROW = /^\s*-\s*\{?\s*(.*)\}?\s*$/

/**
 * Разбирает блок `contacts:` тела документа. Непонятные строки пропускает:
 * разбор — не валидация, мусорная строка не должна ломать чтение документа.
 */
export function parseContacts(text: string): ContactsVerdict {
  const contacts: Contact[] = []
  const lines = text.split(/\r?\n/)

  let inBlock = false
  for (const line of lines) {
    if (/^contacts:\s*$/.test(line)) {
      inBlock = true
      continue
    }
    if (!inBlock) continue
    // Конец блока: следующий ключ верхнего уровня или fence.
    if (/^[A-Za-z_][A-Za-z0-9_]*:/.test(line) || line.trim() === '---') break
    const match = ROW.exec(line)
    if (!match) continue

    const body = match[1]
    const role = fieldValue(body, 'role') as ContactRole | undefined
    if (!role || !CONTACT_ROLES.includes(role)) continue
    const contact: Contact = { role }
    const name = fieldValue(body, 'name')
    if (name) contact.name = name
    const email = fieldValue(body, 'email')
    if (email) contact.email = email
    contacts.push(contact)
  }

  const missing: ContactRole[] = []
  for (const role of CONTACT_ROLES) {
    const found = contacts.find((c) => c.role === role)
    if (!found || !found.email) missing.push(role)
  }
  return { contacts, missing, questions: missing.map(questionFor) }
}

/** Формулировка открытого вопроса по роли (слова — из heuristics US-16). */
export function questionFor(role: ContactRole): string {
  return `Укажите контакт: ${ROLE_TITLES[role]} (email)` as const
}

/** Значение поля встроенной карты: `role: customer` до `,` или `}`. */
function fieldValue(body: string, field: string): string | undefined {
  const re = new RegExp(`(?:^|[,\\s])${field}:\\s*([^,}]+)`)
  const match = re.exec(body)
  if (!match) return undefined
  return unquote(match[1].trim())
}

function unquote(raw: string): string {
  if (raw.length >= 2) {
    const first = raw[0]
    if ((first === '"' || first === "'") && raw[raw.length - 1] === first) {
      return raw.slice(1, -1)
    }
  }
  return raw
}
