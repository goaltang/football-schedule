import { addDays, parseDayKey } from '../../data.js';
import { fmtClock, weekdayOf, relativeLabel } from '../domain/format.js';
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
  const data = weekly ? weekSummary(state) : state.data;
  const status = api.scheduleStatus(data, state.error, state.loading);
  const badge = status === 'ready' ? '' : uiText[status];
  const count = data?.matches.length || 0;
  const followed = data?.matches.filter(api.matchHasFollowed).length || 0;
  const range = `${monthDay(state.windowStart)}–${monthDay(addDays(state.windowStart, 6))}`;
  const total = state.onlyFollowed && !state.followed.length ? '尚未关注球队'
    : count ? `${count} 场${followed && !state.onlyFollowed ? ` · 关注 ${followed} 场` : ''}${state.onlyFollowed ? ' · 关注球队' : ''}${badge ? ' · ' + badge : ''}`
    : state.loading || data?.pending ? uiText.loading : state.error ? uiText.unavailable
      : !data || (!weekly && !data.fetchedAt) || status !== 'ready' ? uiText.unconfirmed : state.onlyFollowed ? '暂无关注球队比赛' : weekly ? uiText.emptyWeek : uiText.emptyDay;
  const relative = relativeLabel(state.dayKey);
  return <header className="top"><div className="masthead"><h1>赛程</h1><div className="mast-side"><span className="meta" id="updated">{[data?.fetchedAt ? `更新于 ${fmtClock(data.fetchedAt)}` : '', state.loading || data?.pending ? uiText.updating : ''].filter(Boolean).join(' · ')}</span></div></div>
    <div className="day-hero"><div className="hero-main"><span className="hero-date" id="heroDate">{weekly ? range : monthDay(state.dayKey)}</span><span className="hero-wd" id="heroWd">{weekly ? '7天' : weekdayOf(state.dayKey)}</span><span className="hero-rel" id="heroRel">{weekly || relative === weekdayOf(state.dayKey) ? '' : relative}</span></div><span className="hero-count" id="heroCount">{total}</span></div>
  </header>;
}
