import { useRef } from 'react';
import type { Match, ViewProps } from '../types';
import { fmtTime, periodLabel, countdownText, teamName, leagueZh } from '../domain/format.js';
import { Logo } from './Logo';
import { STATUS_LABEL } from '../domain/presentation.js';
const labels: Record<string, string> = STATUS_LABEL;

// 比分牌：数字变化时换一个 key 重新挂载，让翻牌动画只播一次；首次渲染不翻。
function ScoreTile({ value, win }: { value?: string | number | null; win?: boolean }) {
  const shown = value ?? '–';
  const seen = useRef({ value: shown, flips: 0 });
  if (seen.current.value !== shown) seen.current = { value: shown, flips: seen.current.flips + 1 };
  const { flips } = seen.current;
  return <b key={flips} className={`sc${win ? ' win' : ''}${flips ? ' flip' : ''}`}>{shown}</b>;
}

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
  return <div className={`match st-${m.status}${compact ? ' compact' : ''}`} data-match={m.id} data-league={m.league} data-copy={copy}
    tabIndex={-1} role="group" aria-label={`${leagueZh(m.league)} ${teamName(m.home)} 对 ${teamName(m.away)} ${fmtTime(m.start)}`}>
    <div className="rail"><time>{fmtTime(m.start)}</time><span className="wd">{compact ? leagueZh(m.league) : `${tag ? leagueZh(m.league) + ' · ' : ''}${periodLabel(m.start)}`}</span></div>
    <div className="side home"><span className="tname" title={m.home?.name}>{teamName(m.home)}</span>{star('home')}<Logo id={m.home?.teamId} url={m.home?.logo} /></div>
    <div className="score">{beforeKickoff ? <span className="vs">vs</span> : <><ScoreTile value={m.home?.score} win={m.home?.winner} /><i className="dash">–</i><ScoreTile value={m.away?.score} win={m.away?.winner} /></>}</div>
    <div className="side away"><Logo id={m.away?.teamId} url={m.away?.logo} />{star('away')}<span className="tname" title={m.away?.name}>{teamName(m.away)}</span></div>
    <div className="status">{status}</div>
  </div>;
}
