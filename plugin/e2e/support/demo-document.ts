/**
 * Демонстрационный документ требования для снимка детальной страницы.
 *
 * Настоящий документ из `bft/documentation/` — внутренний текст целиком: архитектура,
 * решения, стейкхолдеры. Регулярки обезличивания вычистят названия и фамилии, но не смысл,
 * а картинка публичная. Поэтому на время снимка во фрейм подставляется этот документ — та же
 * раскладка, что у настоящего (шапка, статус, разделы, оглавление), и ни одного факта.
 */
export const DEMO_DOCUMENT = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
  body { margin: 0; font: 16px/1.6 Georgia, "Times New Roman", serif; color: #1a1a1a; background: #fff; }
  .page { display: grid; grid-template-columns: 1fr 220px; gap: 32px; padding: 32px 40px; }
  .meta { font: 12px/1.4 ui-monospace, Menlo, monospace; color: #6b6b6b; letter-spacing: .04em; }
  h1 { font-size: 30px; line-height: 1.2; margin: 8px 0 20px; }
  h2 { font-size: 22px; margin: 28px 0 10px; }
  h3 { font-size: 17px; margin: 20px 0 8px; }
  .status { border: 1px solid #1a1a1a; padding: 12px 16px; margin: 0 0 24px; background: #f6f6f6; }
  .toc { font: 13px/1.5 ui-monospace, Menlo, monospace; color: #444; }
  .toc div { margin: 0 0 6px; }
  .toc .head { color: #999; letter-spacing: .08em; margin-bottom: 12px; }
  ul, ol { padding-left: 22px; }
</style></head><body><div class="page"><main>
  <div class="meta">БФТ · initiative · v0.3 · deep · синк 2026-09-04</div>
  <h1>[БФТ] Возврат билета в личном кабинете покупателя</h1>
  <div class="status">Статус проработки: полный БФТ собран. Вход — карточка backlog и summary встречи с заказчиком; часть вопросов помечена как требующая уточнения.</div>
  <h2>Шапка (сутевое описание запроса)</h2>
  <p>Цель: покупатель оформляет возврат билета сам, без обращения в поддержку, а деньги возвращаются на исходный способ оплаты в регламентный срок.</p>
  <h3>How to demo</h3>
  <ol>
    <li>Открываю личный кабинет → заказ → «Вернуть билет» → подтверждаю.</li>
    <li>Вижу статус «Возврат оформлен» и ожидаемую дату зачисления.</li>
  </ol>
  <h3>Открытые вопросы</h3>
  <ul>
    <li>Заказчик — возврат части билетов одного заказа: разрешаем или только целиком?</li>
    <li>Финансы — комиссия сервиса при возврате: удерживаем или нет?</li>
  </ul>
  <h2>Бизнес-требования</h2>
  <ul>
    <li>БТ-1. Возврат доступен до начала мероприятия по правилам организатора.</li>
    <li>БТ-2. Покупатель видит сумму к возврату до подтверждения.</li>
  </ul>
</main><aside class="toc">
  <div class="head">НА СТРАНИЦЕ</div>
  <div>Шапка (сутевое описание запроса)</div><div>Бизнес-описание</div><div>Заинтересованные стороны</div>
  <div>Проблема, которую решаем</div><div>План демонстрации</div><div>Бизнес-требования</div>
  <div>Функциональные требования</div><div>Нефункциональные требования</div><div>Риски</div><div>Якоря истины</div>
</aside></div></body></html>`
