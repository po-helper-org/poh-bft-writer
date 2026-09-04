/**
 * Сборка браузерного клиента раздела.
 *
 * Рецепт повторяет тот, которым харнесс собирает свои клиенты
 * (`harness-ui/packages/client/tsdown.client.ts`, функция `clientConfig`), для
 * плагина вне его дерева: бандл зовёт `window.__ModuleLoader__.load({id, factory})`
 * и разрешает внешние пакеты через переданный `require` — таблицу модулей
 * оболочки. Серверную половину (`lib/index.js`) выпускает tsc, поэтому `clean`
 * выключен: иначе этот бандл стирал бы её при каждой сборке.
 *
 * Почему бандл вообще нужен: `exports["./client"]` пакета указывает на
 * `lib/client.js`, а tsc даёт `lib/client/index.js` с голыми импортами вроде
 * `react` — в браузере такие спецификаторы не разрешаются.
 */
import { defineConfig } from 'tsdown'

/**
 * Пакеты, которые отвечает таблица модулей оболочки: импортируются как обычно и
 * остаются в бандле вызовами `require`. Всё остальное обязано встроиться.
 *
 * Список взят из `harness-ui/packages/client/web/src/platform.ts`
 * (`PLATFORM_MODULES` + `PRELOADED_CLIENT_EXTERNALS`, в этой версии харнесса
 * пустой) — из самого харнесса, а не из соседнего плагина: чужая копия списка
 * успевает разойтись с оболочкой.
 */
const CLIENT_EXTERNALS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/**
 * Слои контрактов, которые клиентскому бандлу можно встроить: браузеро-безопасные
 * описания без разделяемой рантайм-идентичности (ни Symbol, ни instanceof, ни
 * общего состояния). Повторяет `INLINE_SAFE` из `tsdown.client.ts` харнесса.
 */
const INLINE_SAFE = /^(?:@deepseek-ai\/dsh-(?:file-reference|session|llm|tools|brand|deque|typert-protocol|util-crypto|util-values|util-workspace-path)(?:\/|$)|@deepseek-ai\/dsh-token-meter\/client$|@deepseek-ai\/dsh-agent-presets\/display$)/

/** Вендоренные библиотеки фреймворка: обычные библиотеки, их бандл встраивает. */
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/

/** Сгенерированный вклад дескрипторов и кодеков, разделяемой идентичности нет. */
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

export default defineConfig({
  name: 'poh-bft-plugin/client',
  entry: { client: 'src/client/index.tsx' },
  // Один каталог артефактов с серверной половиной от tsc; entryFileNames
  // закрепляет бандл ровно на lib/client.js — туда смотрит exports пакета.
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  // Типы приезжают от tsc (lib/client/index.d.ts). Здесь dts завернул бы
  // banner/footer в .d.cts и сломал разбор.
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: (specifier: string) => CLIENT_EXTERNALS.includes(specifier),
    // Всё, чего нет в таблице модулей, обязано встроиться: require, на который
    // таблица не ответит, — гарантированное падение в рантайме.
    alwaysBundle: (specifier: string) => !CLIENT_EXTERNALS.includes(specifier),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
  plugins: [{
    // Сторож чистоты бандла: пакеты из таблицы модулей остаются внешними,
    // безопасные слои контрактов и вендоренные библиотеки встраиваются, а любой
    // другой value-импорт пакета харнесса — ошибка сборки: он либо встроит
    // второй экземпляр рантайма, либо потребует спецификатор, которого в
    // замороженной таблице нет. Type-only импорты стираются и сюда не доходят.
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.includes(source)) return null // платформенный модуль: внешний
      if (VENDORED_LIBRARY.test(source)) return null // вендоренная библиотека: встраиваем
      if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null // слой контракта
      throw new Error(
        `сторож чистоты: пакет "${source}" не входит ни в CLIENT_EXTERNALS, ни в inline-safe wire-слои, `
        + 'ни в сгенерированные /remote-вклады — value-импорты пакетов харнесса запрещены; '
        + 'сотрудничество идёт через службы cordis (type-only импорты стираются транспайлером и до этой проверки не доходят)',
      )
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "poh-bft-plugin", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
