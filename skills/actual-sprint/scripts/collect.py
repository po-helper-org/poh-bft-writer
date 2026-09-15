#!/usr/bin/env python3
"""Сборщик данных отчёта по спринту команды.

Забирает из JIRA всё, что нужно одной команде: эпики с историями и подзадачами,
метрики за 3 спринта, burndown, диаграмму управления, velocity и ленту активности.
Результат — один JSON на команду, который подставляется в report_template.html.

Запуск:
    python3 collect.py --board 16383 --team "GDS / Live" --slug gds-live
    python3 collect.py --board 6834  --team "LIVE"       --slug live

Токен берётся из JIRA_PERSONAL_TOKEN, база — из JIRA_URL (по умолчанию jira.mts.ru).
"""
import argparse, json, os, re, ssl, statistics, sys, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

JIRA = os.environ.get('JIRA_URL', 'https://jira.mts.ru').rstrip('/')
TOKEN = os.environ.get('JIRA_PERSONAL_TOKEN')
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

STORY_TYPES = ('История', 'История Enabler', 'Story')
DONE_EXACT = {'закрыт', 'закрыта', 'закрыто', 'готово', 'сделано', 'выполнено', 'выполнена',
              'завершено', 'завершена', 'отменен', 'отменён', 'отменена', 'отменено',
              'отклонен', 'отклонён', 'отклонена', 'отклонено', 'решён', 'решен', 'решена'}


def api(path, **params):
    url = JIRA + path + ('?' + urllib.parse.urlencode(params) if params else '')
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + TOKEN})
    with urllib.request.urlopen(req, context=CTX, timeout=120) as r:
        return json.load(r)


def parse(ts):
    return datetime.fromisoformat(ts)


def bucket(name, cat):
    """Реальный статус JIRA -> один из шести бакетов. Правила — resources/status_mapping.md."""
    s = (name or '').strip().lower()
    if cat == 'Выполнено' or s in DONE_EXACT:
        return 'done'
    if re.search(r'блок|ожида|пауза|hold|wait|отложен|приостановл', s):
        return 'blocked'
    if re.search(r'тест|qa', s):
        return 'testing'
    if re.search(r'ревью|review|проверк|приемк|приёмк|согласован|утвержд', s):
        return 'review'
    return 'open' if cat == 'К выполнению' else 'progress'


def stats(vals):
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return {'mean': round(statistics.mean(vals), 1),
            'median': round(statistics.median(vals), 1),
            'count': len(vals)}


def status_categories():
    """Карта «id статуса -> категория». По id, а не по имени: в changelog имена
    приходят на языке workflow (Closed/In progress), а /status отдаёт русские."""
    return {str(s['id']): s['statusCategory']['name'] for s in api('/rest/api/2/status')}


def epic_link_field():
    for f in api('/rest/api/2/field'):
        if f['name'].strip().lower() in ('ссылка на эпик', 'epic link'):
            return f['id']
    return None


def paged(path, key='values', **params):
    """Обходит постраничный ответ JIRA целиком.
    Без этого у досок с длинной историей спринтов первая страница отдаёт
    самые старые записи, и активный спринт в выборку не попадает."""
    out, start = [], 0
    while True:
        d = api(path, startAt=start, maxResults=50, **params)
        vals = d.get(key, [])
        out += vals
        start += len(vals)
        if d.get('isLast', True) or not vals:
            return out


def sprint_issues(sprint_id, fields, expand=None):
    out, start = [], 0
    while True:
        params = {'fields': fields, 'maxResults': 200, 'startAt': start}
        if expand:
            params['expand'] = expand
        d = api(f'/rest/agile/1.0/sprint/{sprint_id}/issue', **params)
        out += d['issues']
        start += len(d['issues'])
        if start >= d.get('total', 0) or not d['issues']:
            return out


def last_status_change(issue, cats):
    """Дата последней смены статуса. Нет смен — дата создания.
    fields.updated не годится: двигается от любой правки."""
    last = None
    for h in issue.get('changelog', {}).get('histories', []):
        for it in h['items']:
            if it['field'] == 'status' and (last is None or h['created'] > last):
                last = h['created']
    return last or issue['fields']['created']


def lead_cycle(issue, cats):
    """(lead, cycle, done_at) в днях. Переоткрытие сбрасывает дату закрытия."""
    f = issue['fields']
    created = parse(f['created'])
    done_at = start_at = None
    for h in sorted(issue.get('changelog', {}).get('histories', []), key=lambda x: x['created']):
        for it in h['items']:
            if it['field'] != 'status':
                continue
            cat = cats.get(str(it.get('to')))
            when = parse(h['created'])
            if cat == 'В работе' and start_at is None:
                start_at = when
            if cat == 'Выполнено':
                done_at = when
            elif done_at is not None:
                done_at = None
    is_done = cats.get(str(f['status']['id'])) == 'Выполнено'
    if not (is_done and done_at):
        return None, None, None
    lead = round((done_at - created).total_seconds() / 86400, 2)
    cycle = round((done_at - start_at).total_seconds() / 86400, 2) if start_at else None
    return lead, cycle, done_at


def in_progress_since(issue, cats):
    """Когда задачу взяли в работу, если она до сих пор не закрыта. Иначе None."""
    if cats.get(str(issue['fields']['status']['id'])) == 'Выполнено':
        return None
    start = None
    for h in sorted(issue.get('changelog', {}).get('histories', []), key=lambda x: x['created']):
        for it in h['items']:
            if it['field'] == 'status' and cats.get(str(it.get('to'))) == 'В работе' and start is None:
                start = parse(h['created'])
    return start


def collect(board_id, team_name, slug, now):
    cats = status_categories()
    epic_field = epic_link_field()

    board = next((b for b in paged('/rest/agile/1.0/board') if b['id'] == board_id), None)
    board_name = board['name'] if board else f'board {board_id}'

    sprints = [s for s in paged(f'/rest/agile/1.0/board/{board_id}/sprint', state='closed,active')
               if s.get('originBoardId') == board_id]
    sprints.sort(key=lambda s: s.get('startDate') or '')
    if not sprints:
        sys.exit(f'у доски {board_id} нет спринтов')
    # активный спринт — якорь отчёта; последние 3 отсчитываем от него, а не от конца списка
    active = next((s for s in reversed(sprints) if s['state'] == 'active'), sprints[-1])
    idx = sprints.index(active)
    last3 = sprints[max(0, idx - 2):idx + 1]

    FIELDS = 'key,summary,status,issuetype,created,creator,assignee,subtasks'
    if epic_field:
        FIELDS += ',' + epic_field  # иначе пришлось бы делать запрос на каждую историю
    per_sprint = {s['id']: sprint_issues(s['id'], FIELDS, expand='changelog') for s in last3}
    extra = {s['id']: sprint_issues(s['id'], 'key,summary,issuetype,created,creator,comment')
             for s in last3}

    # ---------- таблица эпиков по активному спринту ----------
    issues = per_sprint[active['id']]
    stories = [i for i in issues if i['fields']['issuetype']['name'] in STORY_TYPES]
    epic_cache, groups, order = {}, {}, []

    # ключи эпиков уже пришли в полях историй; названия добираем одним запросом на все
    epic_keys = sorted({st['fields'].get(epic_field) for st in stories
                        if epic_field and st['fields'].get(epic_field)})
    if epic_keys:
        jql = 'key in (' + ','.join(epic_keys) + ')'
        found = api('/rest/api/2/search', jql=jql, fields='summary', maxResults=200)['issues']
        epic_cache = {i['key']: i['fields']['summary'] for i in found}

    for st in stories:
        f = st['fields']
        ek = f.get(epic_field) if epic_field else None
        gkey = ek or 'no-epic'
        row = groups.setdefault(gkey, {
            'rowId': gkey, 'epicKey': ek,
            'epicTitle': epic_cache.get(ek) if ek else 'Без эпика', 'stories': []})
        if gkey not in order:
            order.append(gkey)
        row['stories'].append({
            'key': st['key'], 'title': f['summary'],
            'status': f['status']['name'],
            'category': cats.get(str(f['status']['id'])) or '',
            'statusChanged': last_status_change(st, cats),
            'assignee': (f.get('assignee') or {}).get('displayName'),
            'subtasks': [{
                'key': s['key'], 'summary': s['fields']['summary'],
                'status': s['fields']['status']['name'],
                'category': s['fields']['status']['statusCategory']['name'],
                'statusChanged': None, 'assignee': None,
            } for s in (f.get('subtasks') or [])],
        })

    # даты и исполнители подзадач — из общего списка спринта, без запроса на каждую
    by_key = {i['key']: i for i in issues}
    for row in groups.values():
        for st in row['stories']:
            for sub in st['subtasks']:
                src = by_key.get(sub['key'])
                if src:
                    sub['statusChanged'] = last_status_change(src, cats)
                    sub['assignee'] = (src['fields'].get('assignee') or {}).get('displayName')
    epics = [groups[k] for k in order]

    # ---------- метрики за 3 спринта ----------
    sprint_rows, all_closed, velocity = [], [], []
    for s in last3:
        rows = []
        counts = dict.fromkeys(('open', 'blocked', 'progress', 'testing', 'review', 'done'), 0)
        for i in per_sprint[s['id']]:
            f = i['fields']
            counts[bucket(f['status']['name'], cats.get(str(f['status']['id'])))] += 1
            lead, cycle, _ = lead_cycle(i, cats)
            rows.append({'lead': lead, 'cycle': cycle,
                         'story': f['issuetype']['name'] in STORY_TYPES,
                         'subtask': bool(f['issuetype'].get('subtask')),
                         'done': lead is not None})
        closed = [r for r in rows if r['done']]
        all_closed += closed
        sprint_rows.append({
            'name': s['name'], 'total': len(rows), 'closed': len(closed),
            'open': len(rows) - len(closed),
            'throughputPct': round(100 * len(closed) / len(rows)) if rows else 0,
            'lead': stats([r['lead'] for r in closed]),
            'cycle': stats([r['cycle'] for r in closed]),
            'leadStory': stats([r['lead'] for r in closed if r['story']]),
            'leadTask': stats([r['lead'] for r in closed if not r['story'] and not r['subtask']]),
            'points': sorted(r['lead'] for r in closed if r['lead'] is not None),
        })
        velocity.append({'name': s['name'], 'planned': sum(counts.values()),
                         'done': counts['done'], 'split': counts})

    metrics = {'sprints': sprint_rows, 'overall': {
        'lead': stats([r['lead'] for r in all_closed]),
        'cycle': stats([r['cycle'] for r in all_closed]),
        'leadStory': stats([r['lead'] for r in all_closed if r['story']]),
        'leadTask': stats([r['lead'] for r in all_closed if not r['story'] and not r['subtask']]),
        'total': sum(s['total'] for s in sprint_rows), 'closed': len(all_closed)}}

    # ---------- burndown активного спринта ----------
    start, end = parse(active['startDate']), parse(active['endDate'])
    members = []
    for i in issues:
        entered = left = None
        for h in sorted(i.get('changelog', {}).get('histories', []), key=lambda x: x['created']):
            for it in h['items']:
                if it['field'].lower() != 'sprint':
                    continue
                was = active['name'] in (it.get('fromString') or '')
                now_in = active['name'] in (it.get('toString') or '')
                if now_in and not was:
                    entered = parse(h['created'])
                if was and not now_in:
                    left = parse(h['created'])
        _, _, done_at = lead_cycle(i, cats)
        members.append({'entered': entered or start, 'left': left, 'doneAt': done_at})

    days, cur = [], start
    today = now.date().isoformat()
    while cur <= end:
        scope = closed_n = 0
        for m in members:
            if m['entered'] > cur or (m['left'] and m['left'] <= cur):
                continue
            scope += 1
            if m['doneAt'] and m['doneAt'] <= cur:
                closed_n += 1
        days.append({'date': cur.date().isoformat(), 'scope': scope,
                     'remaining': scope - closed_n, 'closed': closed_n,
                     'weekend': cur.weekday() >= 5, 'future': cur.date().isoformat() > today})
        cur += timedelta(days=1)
    burndown = {'sprintName': active['name'], 'start': start.date().isoformat(),
                'end': end.date().isoformat(), 'days': days}

    # ---------- диаграммы управления: отдельно истории и подзадачи ----------
    # Точки — закрытые за 30 дней (Cycle Time). Зона риска — НЕзакрытые задачи,
    # которые уже в работе дольше медианы своей группы: их и подсвечиваем жёлтым.
    since30 = now - timedelta(days=30)
    closed_by_group = {'stories': {}, 'subtasks': {}}
    open_by_group = {'stories': [], 'subtasks': []}

    for s_ in last3:
        for i in per_sprint[s_['id']]:
            f = i['fields']
            grp = 'subtasks' if f['issuetype'].get('subtask') else 'stories'
            lead, cycle, done_at = lead_cycle(i, cats)
            if done_at and cycle is not None and done_at >= since30:
                closed_by_group[grp][i['key']] = {
                    'key': i['key'], 'title': f['summary'],
                    'status': f['status']['name'],
                    'category': cats.get(str(f['status']['id'])) or '',
                    'doneAt': done_at.date().isoformat(), 'cycle': cycle}
                continue
            started = in_progress_since(i, cats)
            if started:
                open_by_group[grp].append({
                    'key': i['key'], 'title': f['summary'],
                    'status': f['status']['name'],
                    'category': cats.get(str(f['status']['id'])) or '',
                    'assignee': (f.get('assignee') or {}).get('displayName'),
                    'elapsed': round((now - started).total_seconds() / 86400, 2)})

    def build_chart(group):
        points = sorted(closed_by_group[group].values(), key=lambda p: p['doneAt'])
        if not points:
            return {'points': [], 'risks': [], 'days': 30}
        vals = [p['cycle'] for p in points]
        mean, median = statistics.mean(vals), statistics.median(vals)
        sd = statistics.pstdev(vals)
        limit = round(mean + sd, 2)
        for p in points:
            p['outlier'] = p['cycle'] > limit
        # в зоне риска — незакрытые, уже в работе дольше медианы
        seen_risk = {}
        for r in open_by_group[group]:
            if r['elapsed'] > median and r['key'] not in seen_risk:
                seen_risk[r['key']] = r
        risks = sorted(seen_risk.values(), key=lambda r: -r['elapsed'])
        return {'points': points, 'risks': risks, 'days': 30,
                'mean': round(mean, 1), 'median': round(median, 1), 'sd': round(sd, 1),
                'limit': limit, 'outliers': sum(1 for p in points if p['outlier']),
                'today': now.date().isoformat()}

    control = {'stories': build_chart('stories'), 'subtasks': build_chart('subtasks'), 'days': 30}

    # ---------- лента активности за 7 дней ----------
    since7 = now - timedelta(days=7)
    events, seen = [], set()
    for s in last3:
        for i in per_sprint[s['id']]:
            f = i['fields']
            for h in i.get('changelog', {}).get('histories', []):
                when = parse(h['created'])
                if when < since7:
                    continue
                for it in h['items']:
                    if it['field'] != 'status':
                        continue
                    uid = f"st:{h['id']}:{i['key']}"
                    if uid in seen:
                        continue
                    seen.add(uid)
                    events.append({'kind': 'status', 'key': i['key'], 'title': f['summary'],
                                   'author': (h.get('author') or {}).get('displayName') or 'Система',
                                   'at': when.isoformat(),
                                   'from': it.get('fromString') or '—',
                                   'to': it.get('toString') or '—',
                                   'toCat': cats.get(str(it.get('to'))) or ''})
        for i in extra[s['id']]:
            f = i['fields']
            created = parse(f['created'])
            if created >= since7 and f'cr:{i["key"]}' not in seen:
                seen.add(f'cr:{i["key"]}')
                events.append({'kind': 'created', 'key': i['key'], 'title': f['summary'],
                               'author': (f.get('creator') or {}).get('displayName') or 'Система',
                               'at': created.isoformat(),
                               'issueType': f['issuetype']['name']})
            for c in (f.get('comment') or {}).get('comments', []):
                when = parse(c['created'])
                if when < since7 or f'cm:{c["id"]}' in seen:
                    continue
                seen.add(f'cm:{c["id"]}')
                body = ' '.join((c.get('body') or '').split())
                events.append({'kind': 'comment', 'key': i['key'], 'title': f['summary'],
                               'author': (c.get('author') or {}).get('displayName') or 'Система',
                               'at': when.isoformat(),
                               'body': body[:160] + '…' if len(body) > 160 else body})
    events.sort(key=lambda e: e['at'], reverse=True)
    authors, kinds = {}, {}
    for e in events:
        authors[e['author']] = authors.get(e['author'], 0) + 1
        kinds[e['kind']] = kinds.get(e['kind'], 0) + 1
    logs = {'events': events, 'days': 7, 'kinds': kinds,
            'authors': sorted(authors.items(), key=lambda x: -x[1])}

    return {'slug': slug, 'team': team_name, 'boardId': board_id, 'boardName': board_name,
            'boardUrl': f'{JIRA}/secure/RapidBoard.jspa?rapidView={board_id}',
            'jiraBase': JIRA, 'sprintName': active['name'],
            'epics': epics, 'metrics': metrics, 'burndown': burndown,
            'control': control, 'logs': logs, 'velocity':
                {'sprints': velocity, 'unit': 'задач',
                 'avgDone': round(sum(v['done'] for v in velocity) / len(velocity), 1)}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--board', type=int, required=True)
    ap.add_argument('--team', required=True)
    ap.add_argument('--slug', required=True)
    ap.add_argument('--out', default=None)
    a = ap.parse_args()
    if not TOKEN:
        sys.exit('нет JIRA_PERSONAL_TOKEN в окружении')
    data = collect(a.board, a.team, a.slug, datetime.now(timezone.utc))
    out = a.out or f'{a.slug}-data.json'
    with open(out, 'w') as fh:
        json.dump(data, fh, ensure_ascii=False)
    m = data['metrics']['overall']
    print(f"{a.team}: доска «{data['boardName']}», спринт «{data['sprintName']}» | "
          f"эпиков {len(data['epics'])} | закрыто {m['closed']} из {m['total']} | "
          f"событий {len(data['logs']['events'])} -> {out}")


if __name__ == '__main__':
    main()
