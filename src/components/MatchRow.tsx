import type { Match, ViewProps } from '../types';
import { fmtTime, periodLabel, countdownText, teamName, leagueZh } from '../domain/format.js';
import { Logo } from './Logo';
import { STATUS_LABEL } from '../domain/presentation.js';
const labels: Record<string, string> = STATUS_LABEL;

export function MatchRow({ match: m, state, api, compact = false, tag = false, copy = 'league' }: ViewProps & { match: Match; compact?: boolean; tag?: boolean; copy?: string }) {
  const star = (side: 'home' | 'away') => {
    const team = m[side];
    if (!team?.name) return null;
    const on = api.isFollowed(team);
    return <button className={`star${on ? ' on' : ''}`} data-star={team.name} data-team-id={team.teamId || ''}
      data-match={m.id} data-side={side} data-league={m.league || ''} data-copy={copy}
      aria-label={`${on ? '取消关注' : '关注'}${teamName(team)}`} aria-pressed={on} title={on ? '取消关注' : '关注'}
      onClick={() => api.toggleFollow({ ...team, league: m.league })}>{on ? '★' : '☆'}</button>;
  };
  const beforeKickoff = ['SCHEDULED', 'DELAYED', 'POSTPONED'].includes(m.status);
  let status;
  if (m.status === 'LIVE') status = <><span className="dot" />{m.minute || labels.LIVE}</>;
  else if (m.status === 'FT') status = `完场${m.detail && m.detail !== 'FT' ? ' ' + m.detail : ''}`;
  else if (m.status === 'SCHEDULED') status = <span className="cd" data-kick={m.start} data-fallback={labels.SCHEDULED}>{countdownText(m.start, state.now) || labels.SCHEDULED}</span>;
  else status = labels[m.status] || m.status;
  return <div className={`match st-${m.status}${compact ? ' compact' : ''}`}>
    <div className="rail"><time>{fmtTime(m.start)}</time><span className="wd">{compact ? leagueZh(m.league) : `${tag ? leagueZh(m.league) + ' · ' : ''}${periodLabel(m.start)}`}</span></div>
    <div className="side home"><span className="tname" title={m.home?.name}>{teamName(m.home)}</span>{star('home')}<Logo id={m.home?.teamId} url={m.home?.logo} /></div>
    <div className="score">{beforeKickoff ? <span className="vs">vs</span> : <><b className={`sc${m.home?.winner ? ' win' : ''}`}>{m.home?.score ?? '–'}</b><i className="dash">–</i><b className={`sc${m.away?.winner ? ' win' : ''}`}>{m.away?.score ?? '–'}</b></>}</div>
    <div className="side away"><Logo id={m.away?.teamId} url={m.away?.logo} />{star('away')}<span className="tname" title={m.away?.name}>{teamName(m.away)}</span></div>
    <div className="status">{status}</div>
  </div>;
}
