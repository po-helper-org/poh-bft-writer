// Единый стиль страницы полного БФТ (ADR-0029).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withPageTheme } from '../lib-test/page-theme.js'

test('слой стиля — в конце страницы, скрипт синтаксически цел', () => {
  const page = withPageTheme('<html><body><main>БФТ</main><script>x()</script></body></html>')
  assert.ok(page.indexOf('id="bft-page-theme"') > page.indexOf('x()'), 'после остальных слоёв')
  assert.ok(page.trim().endsWith('</body></html>'))
  const js = /<script id="bft-page-theme-js">([\s\S]*?)<\/script>/.exec(page)[1]
  assert.doesNotThrow(() => new Function(js))
  assert.match(page, /nav\.cs-rail \.cs-rail-tab\{/, 'вкладки рейки перекрывают свои цвета слоёв (в т.ч. «В Confluence»)')
  assert.ok(!page.includes('#agList:empty'), 'пустая колонка агента — без пояснений (решение владельца)')
})
