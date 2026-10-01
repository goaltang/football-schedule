import { addDays, parseDayKey } from '../../data.js';
import { weekdayOf, relativeLabel, fmtDayLabel, fmtTime } from '../domain/format.js';
import { tonightRange } from '../domain/tonight.js';
import { scoreUpdateInfo, updateTimeLabel } from '../domain/score-updates.js';
import type { DayData, ViewProps } from '../types';
import { UI_TEXT } from '../domain/presentation.js';
export const uiText = UI_TEXT;
export const monthDay = (key: string) => { const date = parseDayKey(key); return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`; };
export function weekSummary(state: ViewProps['state']): DayData | null {
  return state.weekDays && { matches: state.weekDays.flatMap((day) => day.matches), pending: state.weekDays.some((day) => day.pending),
    error: state.weekDays.some((day) => day.error || day.failed?.length), stale: state.weekDays.some((day) => day.stale), fetchedAt: Math.max(0, ...state.weekDays.map((day) => day.fetchedAt || 0)) };
}
export function Hero({ state, api }: ViewProps) {
  const weekly = state.view === 'week';
  const tonight = state.view === 'tonight';
  const night = tonightRange(state.dayKey);
  const data = weekly ? weekSummary(state) : state.data;
  const scoreDays = weekly ? state.weekDays : tonight ? state.tonightDays : null;
  const liveIds = new Set((data?.matches || []).filter((match) => match.live || match.status === 'LIVE').map((match) => match.id));
  const pendingScores = scoreDays ? scoreDays.some((day) => day.pending && day.matches.some((match) => liveIds.has(match.id))) : data?.pending;
  const scoreUpdate = scoreUpdateInfo(data, { error: Boolean(state.error), loading: state.loading, now: state.now,
    pending: pendingScores });
  const fetchedAt = scoreUpdate ? scoreUpdate.fetchedAt : data?.fetchedAt;
  const updated = [fetchedAt ? `${scoreUpdate ? '比分' : '赛程'}更新于 ${updateTimeLabel(fetchedAt, state.now)}` : '',
    !scoreUpdate && (state.loading || data?.pending) ? uiText.updating : ''].filter(Boolean).join(' · ');
  const status = api.scheduleStatus(data, state.error, state.loading);
  const badge = status === 'ready' ? '' : uiText[status];
  const count = data?.matches.length || 0;
  const followed = data?.matches.filter(api.matchHasFollowed).length || 0;
  const range = `${monthDay(state.windowStart)}–${monthDay(addDays(state.windowStart, 6))}`;
  const total = state.onlyFollowed && !state.followed.length ? '尚未关注球队'
    : count ? `${count} 场${followed && !state.onlyFollowed ? ` · 关注 ${followed} 场` : ''}${state.onlyFollowed ? ' · 关注球队' : ''}${badge ? ' · ' + badge : ''}`
    : state.loading || data?.pending ? uiText.loading : state.error ? uiText.unavailable
      : !data || (!weekly && !data.fetchedAt) || status !== 'ready' ? uiText.unconfirmed : state.onlyFollowed ? '暂无关注球队比赛' : tonight ? '今晚暂无比赛' : weekly ? uiText.emptyWeek : uiText.emptyDay;
  const relative = relativeLabel(state.dayKey);
  return <header className="top"><div className="masthead"><h1>赛程</h1><div className="mast-side"><span className="meta" id="updated">{updated}</span></div></div>
    <div className="day-hero"><div className="hero-main"><span className="hero-date" id="heroDate">{tonight ? '今晚' : weekly ? range : monthDay(state.dayKey)}</span><span className="hero-wd" id="heroWd">{tonight ? `${fmtTime(night.start)}–次日${fmtTime(night.end)}` : weekly ? '7天' : weekdayOf(state.dayKey)}</span><span className="hero-rel" id="heroRel">{tonight || weekly || relative === weekdayOf(state.dayKey) ? '' : relative}</span></div><span className="hero-count" id="heroCount">{total}</span></div>
    {tonight && <p className="tonight-range" id="tonightRange">{fmtDayLabel(state.dayKey)}晚间 — {fmtDayLabel(night.dayKeys[1])}凌晨 · 本机时区</p>}
    {scoreUpdate && <p className={`score-update ${scoreUpdate.phase}`} id="scoreUpdate" role="status" aria-live="polite" aria-atomic="true">{scoreUpdate.text}</p>}
  </header>;
}
