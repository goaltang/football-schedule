import { useLayoutEffect, useRef } from 'react';
import { LEAGUES } from '../../config.js';
import { dayKeyOf } from '../../data.js';
import { tonightRange } from '../domain/tonight.js';
import type { NearbyDay, ViewProps } from '../types';
import { fmtDayLabel, weekdayOf, relativeLabel } from '../domain/format.js';
import { monthDay, weekSummary, uiText } from './Hero';
import { MatchRow } from './MatchRow';
import { Logo } from './Logo';
import { NoFollowedTeams } from './ScheduleScope';
function Skeleton() { return <div className="skel" role="status" aria-label={uiText.loading}>{Array.from({ length: 5 }, (_, i) => <div key={i} className="skel-row" />)}</div>; }
function Retry({ api }: Pick<ViewProps, 'api'>) { return <button className="btn" id="retry" onClick={() => api.reload({ force: true })}>{uiText.retry}</button>; }
function NearbyButton({ day, label, api }: Pick<ViewProps, 'api'> & { day?: NearbyDay; label: string }) {
  return day ? <button className="btn near" data-goto={day.dayKey} onClick={() => api.gotoDay(day.dayKey)}>{label} · {fmtDayLabel(day.dayKey)} {weekdayOf(day.dayKey)} · {day.count}场{day.partial ? '（赛程待确认）' : ''}</button> : null;
}
function LoadError({ api }: Pick<ViewProps, 'api'>) { return <div className="panel err"><p>{uiText.unavailable}</p><p className="sub">请稍后重新加载。</p><Retry api={api} /></div>; }
export function DaySchedule(props: ViewProps) {
  const { state, api } = props;
  const data = state.data;
  if (state.onlyFollowed && !state.followed.length) return <NoFollowedTeams {...props} />;
  if (state.loading && !data) return <Skeleton />;
  if (state.error && (!data || !data.matches.length)) return <LoadError api={api} />;
  if (!data) return null;
  if (data.matches.length) {
    const notice = api.scheduleNotice(data);
    const followed = data.matches.filter(api.matchHasFollowed);
    let number = 0;
    return <>{notice && <div className="warn" role="status">{notice}</div>}
      {followed.length > 0 && <section className="league" key="followed"><header className="lg-head"><h2>★ 我的关注</h2><span className="lg-en">Followed</span><span className="lg-count">{followed.length}场</span></header>{followed.map((match) => <MatchRow {...props} match={match} key={match.id} tag copy="followed" />)}</section>}
      {!state.onlyFollowed && LEAGUES.map((league) => {
        const matches = data.matches.filter((match) => match.league === league.id && state.enabled.has(league.id));
        if (!matches.length) return null;
        number++;
        const meta = data.leagueMeta?.get(league.id);
        return <section className="league" key={league.id}><header className="lg-head">{meta?.logo && <Logo id={league.id} url={meta.logo} size={18} crest />}<span className="lg-no">{String(number).padStart(2, '0')}</span><h2>{league.zh}</h2><span className="lg-en">{league.en}</span><span className="lg-count">{matches.length}场</span></header>{matches.map((match) => <MatchRow {...props} match={match} key={match.id} />)}</section>;
      })}</>;
  }
  const updating = state.loading || data.pending;
  const uncertain = data.failed?.length || data.stale || !data.fetchedAt;
  const preview = state.preview;
  return <>{updating ? <div className="panel" role="status"><p>{uiText.loading}</p></div> : <div className={`panel${uncertain ? '' : ' empty'}`}>
    <p>{uncertain ? uiText.unconfirmed : state.onlyFollowed ? '当天暂无关注球队的比赛' : '当天暂无所选赛事或关注球队的比赛'}</p><p className="sub">{uncertain ? '暂时无法确认当天是否有比赛，请稍后重新加载。' : state.onlyFollowed ? '可切换到7天视图，或查看全部比赛。' : '可切换日期或调整赛事筛选。'}</p>
    {!uncertain && state.onlyFollowed && <button className="btn" onClick={() => api.setView('week')}>查看7天赛程</button>}
    {uncertain && <Retry api={api} />}<div className="nearby"><NearbyButton api={api} day={state.nearby?.prev} label="← 查看更早比赛" /><NearbyButton api={api} day={state.nearby?.next} label="查看之后比赛 →" /></div></div>}
    {preview && <section className="league"><header className="lg-head"><h2>{preview.kind === 'followed' ? '关注球队赛程预览' : '赛程预览'}</h2><span className="lg-count">{preview.count}场</span></header><p className="preview-date">{fmtDayLabel(preview.dayKey)} {weekdayOf(preview.dayKey)}</p>
      {preview.partial && <p className="preview-note">其他日期可能还有比赛，以下赛程仅供参考。</p>}{preview.matches.slice(0, 8).map((match) => <MatchRow {...props} match={match} key={match.id} tag={preview.kind === 'followed'} copy="preview" />)}
      <div className="more"><button className="btn" data-goto={preview.dayKey} onClick={() => api.gotoDay(preview.dayKey)}>查看当天比赛 →</button></div></section>}
  </>;
}
export function WeekSchedule(props: ViewProps) {
  const { state, api } = props;
  if (state.onlyFollowed && !state.followed.length) return <NoFollowedTeams {...props} />;
  const days = state.weekDays;
  const summary = weekSummary(state);
  const status = api.scheduleStatus(summary, state.error, state.loading);
  if (state.loading && !days) return <Skeleton />;
  if (state.error && !summary?.matches.length) return <LoadError api={api} />;
  if (!days) return null;
  return <>{days.map((day) => {
    const dayStatus = api.scheduleStatus(day);
    if (!day.matches.length && dayStatus === 'ready') return null;
    const followed = day.matches.filter(api.matchHasFollowed).length;
    const relative = relativeLabel(day.dayKey);
    return <section className="wday" id={`wday-${day.dayKey}`} key={day.dayKey}><h3 className="wday-head"><b>{monthDay(day.dayKey)}</b> {weekdayOf(day.dayKey)}
      {day.matches.length ? <>{relative !== weekdayOf(day.dayKey) ? ' · ' + relative : ''} · {day.matches.length} 场{followed ? <> · <i className="fav">关注 {followed}</i></> : null}{dayStatus !== 'ready' ? ' · ' + uiText[dayStatus] : ''}</> : ` · ${dayStatus === 'updating' ? uiText.loading : uiText.unconfirmed}`}</h3>
      {day.matches.map((match) => <MatchRow {...props} match={match} key={match.id} compact />)}</section>;
  })}{status === 'updating' && !summary?.matches.length ? <div className="panel" role="status"><p>{uiText.loading}</p></div>
    : status !== 'ready' && status !== 'updating' ? <div className="panel"><p>{summary?.matches.length ? (status === 'stale' ? '比赛时间和比分可能有变动。' : state.error ? '暂时无法更新这7天的赛程。' : '部分日期的赛程未能加载。') : uiText.unconfirmed}</p><p className="sub">{summary?.matches.length ? '可重新加载查看最新赛程。' : '暂时无法确认这7天是否有比赛，请稍后重新加载。'}</p><Retry api={api} /></div>
      : !summary?.matches.length ? <div className="panel"><p>{state.onlyFollowed ? '这7天暂无关注球队的比赛' : uiText.emptyWeek}</p><p className="sub">{state.onlyFollowed ? '可切换日期，或查看全部比赛。' : '可切换日期或调整赛事筛选。'}</p></div> : null}</>;
}
export function TonightSchedule(props: ViewProps) {
  const { state, api } = props;
  const data = state.data;
  if (state.onlyFollowed && !state.followed.length) return <NoFollowedTeams {...props} />;
  if (state.loading && !data) return <Skeleton />;
  if (state.error && !data?.matches.length) return <LoadError api={api} />;
  if (!data) return null;
  const status = api.scheduleStatus(data, state.error, state.loading);
  const notice = api.scheduleNotice(data);
  if (data.matches.length) return <>
    {notice && <div className="warn" role="status">{notice} <Retry api={api} /></div>}
    {tonightRange(state.dayKey).dayKeys.map((key, index) => {
      const matches = data.matches.filter((match) => dayKeyOf(new Date(match.start)) === key);
      if (!matches.length) return null;
      const followed = matches.filter(api.matchHasFollowed).length;
      return <section className="wday" key={key} aria-label={`${fmtDayLabel(key)}${index ? '凌晨' : '晚间'}比赛`}>
        <h3 className="wday-head"><b>{monthDay(key)}</b> {weekdayOf(key)} · {index ? '次日凌晨' : '晚间'} · {matches.length} 场{followed ? <> · <i className="fav">关注 {followed}</i></> : null}</h3>
        {matches.map((match) => <MatchRow {...props} match={match} key={match.id} compact copy="tonight" />)}
      </section>;
    })}
  </>;
  if (status === 'updating') return <div className="panel" role="status"><p>{uiText.loading}</p></div>;
  const uncertain = status !== 'ready' || !data.fetchedAt;
  return <div className={`panel${uncertain ? '' : ' empty'}`}>
    <p>{uncertain ? uiText.unconfirmed : state.onlyFollowed ? '今晚暂无关注球队的比赛' : '今晚暂无所选赛事或关注球队的比赛'}</p>
    <p className="sub">{uncertain ? '暂时无法确认今晚是否有比赛，请稍后重新加载。' : state.onlyFollowed ? '可查看7天赛程，或切换到全部比赛。' : '可查看今天的其他比赛，或调整赛事筛选。'}</p>
    {uncertain ? <Retry api={api} /> : <button className="btn" onClick={() => state.onlyFollowed ? api.setView('week') : api.gotoDay(dayKeyOf(new Date(state.now)))}>{state.onlyFollowed ? '查看7天赛程' : '查看今天比赛'}</button>}
  </div>;
}
export function ScheduleList(props: ViewProps) {
  const host = useRef<HTMLElement>(null);
  const focused = useRef<HTMLButtonElement | null>(null);
  const interimFocused = useRef<number | null>(null);
  const revealed = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (props.state.view === 'week' && !props.state.previewReveal) host.current?.querySelector(`#wday-${props.state.dayKey}`)?.scrollIntoView({ block: 'start' });
  }, [props.state.dayKey, props.state.view]);
  useLayoutEffect(() => {
    const { state } = props;
    const request = state.previewReveal;
    const list = host.current;
    if (!request || !list || revealed.current === request.id || request.dayKey !== state.dayKey) return;
    const day = state.view === 'week' ? state.weekDays?.find((day) => day.dayKey === request.dayKey) : state.data;
    const noFollows = state.onlyFollowed && !state.followed.length;
    const focusResult = (target: HTMLElement) => {
      focused.current = null;
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
      // Instant scrolling also respects reduced motion; account for the sticky controls.
      target.scrollIntoView({ block: target === list ? 'start' : 'center', behavior: 'instant' });
      const controls = document.querySelector('.sticky-bar');
      const top = controls ? controls.getBoundingClientRect().bottom + 8 : 0;
      const offset = target.getBoundingClientRect().top - top;
      if (offset < 0) window.scrollBy({ top: offset, behavior: 'instant' });
    };
    if (state.loading || (!noFollows && ((!day && !state.error) || day?.pending))) {
      // Keep focus in a stable named region without consuming the final reveal.
      if (interimFocused.current !== request.id) {
        interimFocused.current = request.id;
        focusResult(list);
      }
      return;
    }
    // Failed refreshes may retain old rows. Reveal the honest result notice instead.
    const match = day?.matches.find((match) => match.id === request.matchId && match.league === request.league);
    const failed = state.error || day?.error || day?.stale || match?.refreshFailed
      || day?.failed?.includes(request.league) || day?.failed?.includes('*');
    const rows = failed || noFollows ? [] : [...list.querySelectorAll<HTMLElement>('.match')].filter((row) =>
      row.dataset.match === request.matchId && row.dataset.league === request.league && row.dataset.copy !== 'preview');
    const target = rows.find((row) => row.dataset.copy === 'followed') || rows[0]
      || list.querySelector<HTMLElement>('.panel, .warn') || list;
    revealed.current = request.id;
    focusResult(target);
  });
  useLayoutEffect(() => {
    const previous = focused.current;
    if (!previous || previous.isConnected || document.activeElement !== document.body) return;
    const buttons = [...(host.current?.querySelectorAll<HTMLButtonElement>('button') || [])];
    const same = buttons.filter((button) => previous.dataset.match && button.dataset.match === previous.dataset.match && button.dataset.side === previous.dataset.side);
    const next = same.find((button) => button.dataset.copy === previous.dataset.copy) || same[0]
      || buttons.find((button) => previous.id ? button.id === previous.id : previous.dataset.goto && button.dataset.goto === previous.dataset.goto) || buttons[0];
    next?.focus({ preventScroll: true });
    focused.current = null;
  });
  return <main id="list" className="list" ref={host} tabIndex={-1} aria-label="赛程结果" onFocusCapture={(event) => {
    if (event.target instanceof HTMLButtonElement) focused.current = event.target;
  }}>{props.state.view === 'tonight' ? <TonightSchedule {...props} /> : props.state.view === 'week' ? <WeekSchedule {...props} /> : <DaySchedule {...props} />}</main>;
}
