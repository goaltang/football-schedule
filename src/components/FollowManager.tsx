import { useLayoutEffect, useRef } from 'react';
import type { CatalogEntry, ViewProps } from '../types';
import { searchKey, searchTeams } from '../domain/catalog.js';
import { leagueZh } from '../domain/format.js';
import { Logo } from './Logo';

export function SearchResults({ state, api }: ViewProps) {
  const search = state.search;
  if (!searchKey(search.query)) return null;
  const hits: CatalogEntry[] = searchTeams(search.catalog, search.query);
  let note = '';
  if (!hits.length) {
    if (search.loading) note = '搜索中…';
    else if (!search.catalog.length) note = '暂时无法搜索球队，请稍后重新搜索。';
    else if (search.failed) note = '部分球队未能加载，搜索结果可能不全。';
    else note = `未找到「${search.query.trim()}」，试试其他名称。`;
  } else if (hits.length > 8) note = `还有 ${hits.length - 8} 支球队，请输入更完整的名称。`;
  else if (search.loading) note = '搜索中…';
  else if (search.failed) note = '部分球队未能加载，搜索结果可能不全。';
  return <>{hits.slice(0, 8).map((entry) => {
    const on = api.isFollowed({ name: entry.name, teamId: entry.id });
    return <div className="search-row" key={entry.id}><Logo id={entry.id} url={entry.logo} size={24} />
      <span className="search-name">{entry.zh}{entry.zh !== entry.name && <span className="search-en">{entry.name}</span>}</span>
      <span className="search-meta">{entry.leagues.map(leagueZh).filter(Boolean).join(' · ')}</span>
      <button type="button" className="search-add" data-search-id={entry.id} aria-pressed={on} aria-label={`${on ? '取消关注 ' : '关注 '}${entry.zh}`}
        onClick={() => api.followSearchResult(entry.id)}>{on ? '已关注' : '关注'}</button></div>;
  })}{note && <div className="search-note">{note}</div>}</>;
}
export function FollowTeams({ state, api }: ViewProps) {
  return state.followed.length ? <>{state.followed.map((record, index) => {
    const name = api.followDisplayName(record);
    const meta = api.followMetaText(record);
    const next = state.followNext?.[index];
    return <div className="follow-team" key={`${record.name || record.names.join('|')}|${record.id}`}>
      <span className="follow-team-name">{name}</span>{meta && <span className="follow-team-meta">{meta}</span>}
      {next !== undefined && <span className="follow-team-next">{api.followNextText(next)}</span>}
      <button type="button" className="follow-remove" data-follow-idx={index} aria-label={`取消关注 ${name}`} onClick={() => api.unfollowAt(index)}>取消关注</button>
    </div>;
  })}</> : <div className="follow-empty">暂无关注球队。搜索球队或点击比赛中的 ☆ 添加关注。</div>;
}
export function FollowManager(props: ViewProps) {
  const { state, api } = props;
  const host = useRef<HTMLDivElement>(null);
  const focused = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    const previous = focused.current;
    if (!previous || previous.isConnected || document.activeElement !== document.body) return;
    const index = Math.min(Number(previous.dataset.followIdx), state.followed.length - 1);
    const next = host.current?.querySelector<HTMLButtonElement>(`[data-follow-idx="${index}"]`) || document.querySelector<HTMLButtonElement>('#followToggle');
    next?.focus({ preventScroll: true });
    focused.current = null;
  });
  return <div className="follow-manager" id="followManager" hidden={!state.followOpen}>
    <p className="follow-head">我的关注</p><div className="follow-search">
      <input type="search" id="followSearch" className="search-input" placeholder="搜索球队：皇马、国足、阿根廷…" aria-label="搜索俱乐部或国家队并关注" aria-controls="followResults" autoComplete="off" spellCheck={false} enterKeyHint="search"
        value={state.search.query} onChange={(event) => api.setSearchQuery(event.target.value)} onFocus={() => api.loadCatalog()} />
      <div className="search-results" id="followResults" aria-live="polite"><SearchResults {...props} /></div>
    </div><div className="follow-teams" id="followTeams" ref={host} onFocusCapture={(event) => {
      const target = event.target;
      if (target instanceof HTMLButtonElement && target.dataset.followIdx !== undefined) focused.current = target;
    }}><FollowTeams {...props} /></div>
  </div>;
}
