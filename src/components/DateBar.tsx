import { addDays, dayKeyOf, parseDayKey } from '../../data.js';
import { relativeLabel } from '../domain/format.js';
import type { ViewProps } from '../types';
const dotText: Record<string, string> = { fill: '有关注球队比赛', hollow: '有其他比赛', off: '无所选赛事比赛', unk: '赛程未知' };
export function DateBar({ state, api }: ViewProps) {
  const inWeek = state.view === 'week';
  const today = dayKeyOf(new Date(state.now));
  const selected = (key: string) => state.view !== 'tonight' && key === state.dayKey;
  return <div className="sticky-bar"><div className="datebar">
    <button className="nav" id="prevDay" aria-label={inWeek ? '前一周' : '前一天'} onClick={() => api.gotoDay(addDays(inWeek ? state.windowStart : state.dayKey, inWeek ? -7 : -1))}>‹</button>
    <div className="days" id="days">{Array.from({ length: 7 }, (_, i) => {
      const key = addDays(state.windowStart, i);
      const date = parseDayKey(key);
      const dot = api.dayDotState(key);
      const description = state.onlyFollowed && dot === 'off' ? (state.followed.length ? '无关注球队比赛' : '尚未关注球队') : dotText[dot] || '';
      return <button key={key} className={`day${selected(key) ? ' sel' : ''}${key === today ? ' today' : ''}`} data-day={key}
        aria-label={`${key} ${relativeLabel(key)} ${description}`} aria-pressed={selected(key)} aria-current={key === today ? 'date' : undefined}
        onClick={() => api.gotoDay(key)}><span className="day-rel">{relativeLabel(key)}</span><span className="day-date">{date.getMonth() + 1}/{date.getDate()}</span><span className={`day-dot ${dot}`} /></button>;
    })}</div>
    <button className="nav" id="nextDay" aria-label={inWeek ? '后一周' : '后一天'} onClick={() => api.gotoDay(addDays(inWeek ? state.windowStart : state.dayKey, inWeek ? 7 : 1))}>›</button>
  </div></div>;
}
