import type { ViewProps } from '../types';

export function ScheduleScope({ state, api }: ViewProps) {
  return <button type="button" className={`btn scope-toggle${state.onlyFollowed ? ' on' : ''}`} id="onlyFollowed"
    aria-pressed={state.onlyFollowed} aria-controls="list" onClick={() => api.setOnlyFollowed(!state.onlyFollowed)}>
    <span aria-hidden="true">★</span> 只看关注
  </button>;
}

export function NoFollowedTeams({ state, api }: ViewProps) {
  const findTeams = () => {
    if (!state.followOpen) api.toggleFollowPanel();
    else document.querySelector<HTMLInputElement>('#followSearch')?.focus();
  };
  return <div className="panel empty">
    <p>还没有关注球队</p>
    <p className="sub">关注喜欢的俱乐部或国家队，就能在这里查看它们的比赛。</p>
    <div className="scope-empty-actions">
      <button type="button" className="btn" onClick={findTeams}>添加关注球队</button>
      <button type="button" className="btn" onClick={() => api.setOnlyFollowed(false)}>查看全部比赛</button>
    </div>
  </div>;
}
