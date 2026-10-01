import { useRef, useState, type KeyboardEvent } from 'react';
import { LEAGUES } from '../../config.js';
import { dayKeyOf } from '../../data.js';
import type { ViewProps } from '../types';
import { FollowManager } from './FollowManager';
import { ScheduleScope } from './ScheduleScope';

type LeagueGroup = 'club' | 'national';
const groups = [
  { id: 'club' as const, label: '俱乐部', items: LEAGUES.filter((league) => league.group !== 'national') },
  { id: 'national' as const, label: '国家队', items: LEAGUES.filter((league) => league.group === 'national') },
];
const presets = [
  { label: '全部赛事', summary: '全部赛事', ids: LEAGUES.map((league) => league.id) },
  { label: '只看五大联赛', summary: '五大联赛', ids: ['eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1'], group: 'club' as const },
  { label: '只看欧战', summary: '欧冠 · 欧联 · 欧协联', ids: ['uefa.champions', 'uefa.europa', 'uefa.europa.conf'], group: 'club' as const },
  { label: '只看国家队', summary: '全部国家队赛事', ids: groups[1].items.map((league) => league.id), group: 'national' as const },
];

function matchesSelection(ids: string[], enabled: Set<string>) {
  return ids.length === enabled.size && ids.every((id) => enabled.has(id));
}

export function LeagueChips({ state, api, activeGroup = 'club' }: ViewProps & { activeGroup?: LeagueGroup }) {
  return <>{groups.map(({ id, label, items }) => {
    const selectedCount = items.filter((league) => state.enabled.has(league.id)).length;
    const groupIds = new Set(items.map((league) => league.id));
    return <section className={`chip-group chip-group-${id}`} id={`${id}FilterPanel`} role="tabpanel" aria-label={`${label}赛事`}
      aria-labelledby={`${id}FilterTab`} hidden={activeGroup !== id} key={id}>
      <div className="chip-group-head">
        <span className="chip-group-count">已选 {selectedCount}/{items.length}</span>
        <div className="chip-group-actions">
          <button type="button" className="filter-link" aria-label={`全选${label}赛事`} disabled={selectedCount === items.length}
            onClick={() => api.setLeagues([...state.enabled, ...groupIds])}>全选</button>
          <button type="button" className="filter-link" aria-label={`清除${label}赛事`}
            disabled={selectedCount === 0 || selectedCount === state.enabled.size}
            onClick={() => api.setLeagues([...state.enabled].filter((leagueId) => !groupIds.has(leagueId)))}>清除</button>
        </div>
      </div>
      <div className="chip-options">{items.map((league) => {
        const on = state.enabled.has(league.id);
        const lastSelected = on && state.enabled.size === 1;
        return <button type="button" key={league.id}
          className={`chip${on ? ' on' : ''}`} data-league={league.id} aria-pressed={on}
          disabled={lastSelected} aria-describedby={lastSelected ? 'filterHelp' : undefined}
          title={lastSelected ? '至少保留 1 项赛事' : league.en} onClick={() => api.toggleLeague(league.id)}>
          <span className="chip-name">{league.zh}</span>
          <span className="chip-check" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none"><path d="m4 8 2.5 2.5L12 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
        </button>;
      })}</div>
    </section>;
  })}</>;
}

export function LeagueFilters(props: ViewProps) {
  const { state, api } = props;
  const [activeGroup, setActiveGroup] = useState<LeagueGroup>(() =>
    groups[0].items.some((league) => state.enabled.has(league.id)) ? 'club' : 'national');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const selected = LEAGUES.filter((league) => state.enabled.has(league.id));
  const selectedNames = selected.map((league) => league.zh).join(' · ');
  const activePreset = presets.find((preset) => matchesSelection(preset.ids, state.enabled));
  const summary = activePreset?.summary || (selected.length <= 3 ? selectedNames :
    `${selected.slice(0, 3).map((league) => league.zh).join(' · ')} 等 ${selected.length} 项`);

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = 1 - index;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 1;
    else return;
    event.preventDefault();
    setActiveGroup(groups[next].id);
    tabRefs.current[next]?.focus();
  }

  function closeFromKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape' || !state.filtersOpen) return;
    event.preventDefault();
    event.stopPropagation();
    api.toggleFilters();
    toggleRef.current?.focus();
  }

  return <div className={`filters${state.filtersOpen ? ' is-open' : ''}`}>
    <div className="filter-toolbar">
      <button type="button" className="filter-toggle" id="filterToggle" ref={toggleRef} aria-controls="chips"
        aria-expanded={state.filtersOpen} aria-label={`赛事筛选，已选 ${selected.length} 项，${state.filtersOpen ? '收起' : '展开'}`}
        onClick={api.toggleFilters}>
        <span className="filter-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M4 7h4m4 0h8M4 17h8m4 0h4" /><circle cx="10" cy="7" r="2" /><circle cx="14" cy="17" r="2" />
        </svg></span>
        <span className="filter-toggle-copy">
          <span className="filter-toggle-title">赛事筛选 <span className="filter-count" id="filterCount">已选 {selected.length}</span></span>
          <span className="filter-summary" title={selectedNames}>{summary}</span>
        </span>
        <span className="filter-toggle-text" aria-hidden="true">{state.filtersOpen ? '收起' : '调整'}</span>
      </button>
      <div className="secondary-actions">
        <div className="schedule-controls">
          <div className="view-seg" role="group" aria-label="视图">
            <button type="button" className={`seg${state.view === 'day' ? ' on' : ''}`} id="viewDay" aria-label="按日查看" aria-pressed={state.view === 'day'} onClick={() => api.setView('day')}>日</button>
            <button type="button" className={`seg${state.view === 'week' ? ' on' : ''}`} id="viewWeek" aria-label="按周查看" title="从所选日期起查看7天" aria-pressed={state.view === 'week'} onClick={() => api.setView('week')}>7天</button>
          </div>
          <ScheduleScope {...props} />
        </div>
        <div className="schedule-actions">
          <div className="quick-dates" role="group" aria-label="快捷日期">
            <button className={`btn today-jump${state.view === 'tonight' || state.dayKey !== dayKeyOf(new Date(state.now)) ? ' off' : ''}`} id="goToday" onClick={() => api.gotoDay(dayKeyOf(new Date()), { resetWeek: true })}>今天</button>
            <button type="button" className={`btn tonight-jump${state.view === 'tonight' ? ' on' : ''}`} id="goTonight"
              aria-pressed={state.view === 'tonight'} aria-controls="list" onClick={() => api.setView('tonight')}>今晚</button>
          </div>
          <button className={`btn refresh${state.loading ? ' busy' : ''}`} id="refresh" aria-busy={state.loading} onClick={() => api.reload({ force: true })}>刷新</button>
          <button type="button" className="btn follow-toggle" id="followToggle" aria-controls="followManager" aria-expanded={state.followOpen} onClick={api.toggleFollowPanel}>关注 <span className="follow-count" id="followCount">{state.followed.length || ''}</span></button>
        </div>
      </div>
    </div>
    <div className="chips" id="chips" hidden={!state.filtersOpen} onKeyDown={closeFromKeyboard}>
      <div className="filter-presets" role="group" aria-label="快捷选择赛事">
        {presets.map((preset) => <button type="button" className="filter-preset" key={preset.label}
          aria-pressed={matchesSelection(preset.ids, state.enabled)} onClick={() => {
            api.setLeagues(preset.ids);
            if (preset.group) setActiveGroup(preset.group);
          }}>{preset.label}</button>)}
      </div>
      <div className="filter-tabs" role="tablist" aria-label="赛事类别">
        {groups.map(({ id, label, items }, index) => <button type="button" className="filter-tab" role="tab" id={`${id}FilterTab`}
          key={id} ref={(element) => { tabRefs.current[index] = element; }} aria-selected={activeGroup === id}
          aria-controls={`${id}FilterPanel`} tabIndex={activeGroup === id ? 0 : -1}
          onClick={() => setActiveGroup(id)} onKeyDown={(event) => onTabKeyDown(event, index)}>
          {label}<span className="filter-tab-count">{items.filter((league) => state.enabled.has(league.id)).length}/{items.length}</span>
        </button>)}
      </div>
      <LeagueChips {...props} activeGroup={activeGroup} />
      <div className="filter-panel-foot">
        <p id="filterHelp">选择即生效 · 自动保存 · 至少保留 1 项</p>
        <button type="button" className="filter-done" onClick={() => { api.toggleFilters(); toggleRef.current?.focus(); }}>完成</button>
      </div>
      {state.onlyFollowed && <p className="filter-scope-note">当前只看关注，切换到全部比赛后可查看所选赛事。</p>}
    </div>
    <FollowManager {...props} />
  </div>;
}
