/**
 * Публичное ядро раздела «Управление требованиями».
 *
 * Всё, что здесь экспортируется, работает без DeepSeek Harness: конфиг, модель,
 * разбор документов, очередь. Host-слой добавляет к этому только запуск.
 */
export * from './model.js'
export * from './config.js'
export * from './frontmatter.js'
export * from './stage.js'
export * from './document-source.js'
export * from './queue.js'
export * from './worklog.js'
export * from './handoff.js'
export * from './reader.js'
export * from './bft-reader.js'
export * from './channel.js'
export * from './plugin-config.js'
export * from './ports.js'
export * from './errors.js'
