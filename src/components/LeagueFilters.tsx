import { LEAGUES } from '../../config.js';
import { dayKeyOf } from '../../data.js';
import type { ViewProps } from '../types';
import { FollowManager } from './FollowManager';
export function LeagueChips({ state, api }: ViewProps) {
  const groups = [{ label: '俱乐部', items: LEAGUES.filter((league) => league.group !== 'national') }, { label: '国家队', items: LEAGUES.filter((league) => league.group === 'national') }];
  return <>{groups.map(({ label, items }) => <div className="chip-group" role="group" aria-label={`${label}赛事`} key={label}>
    <span className="chip-group-label" aria-hidden="true">{label}</span><div className="chip-options">{items.map((league) => <button key={league.id}
      className={`chip${state.enabled.has(league.id) ? ' on' : ''}`} data-league={league.id} aria-pressed={state.enabled.has(league.id)} title={league.en} onClick={() => api.toggleLeague(league.id)}>{league.zh}</button>)}</div>
  </div>)}</>;
}
export function LeagueFilters(props: ViewProps) {
  const { state, api } = props;
  return <div className={`filters${state.filtersOpen ? ' is-open' : ''}`}><div className="filter-toolbar">
    <button type="button" className="filter-toggle" id="filterToggle" aria-controls="chips" aria-expanded={state.filtersOpen} onClick={api.toggleFilters}>赛事筛选 <span className="filter-count" id="filterCount">{state.enabled.size}/{LEAGUES.length}</span></button>
    <div className="secondary-actions"><div className="view-seg" role="group" aria-label="视图">
      <button type="button" className={`seg${state.view === 'day' ? ' on' : ''}`} id="viewDay" aria-label="按日查看" aria-pressed={state.view === 'day'} onClick={() => api.setView('day')}>日</button>
      <button type="button" className={`seg${state.view === 'week' ? ' on' : ''}`} id="viewWeek" aria-label="按周查看" aria-pressed={state.view === 'week'} onClick={() => api.setView('week')}>周</button>
    </div><button className={`btn today-jump${state.dayKey !== dayKeyOf(new Date(state.now)) ? ' off' : ''}`} id="goToday" onClick={() => api.gotoDay(dayKeyOf(new Date()))}>今天</button>
      <button className={`btn refresh${state.loading ? ' busy' : ''}`} id="refresh" aria-busy={state.loading} onClick={() => api.reload({ force: true })}>刷新</button>
      <button type="button" className="btn follow-toggle" id="followToggle" aria-controls="followManager" aria-expanded={state.followOpen} onClick={api.toggleFollowPanel}>关注 <span className="follow-count" id="followCount">{state.followed.length || ''}</span></button>
    </div></div><FollowManager {...props} /><div className="chips" id="chips"><LeagueChips {...props} /></div></div>;
}
