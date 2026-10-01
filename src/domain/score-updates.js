import { fmtClock } from './format.js';

// A monthly schedule may be usable for hours; a live score needs a shorter check.
const SCORE_DELAY_MS = 2 * 60e3;

function updateTimeLabel(fetchedAt, now = Date.now()) {
  const date = new Date(fetchedAt);
  const today = new Date(now);
  const otherYear = date.getFullYear() !== today.getFullYear();
  const otherDay = otherYear || date.getMonth() !== today.getMonth() || date.getDate() !== today.getDate();
  const day = otherDay ? `${otherYear ? date.getFullYear() + '/' : ''}${date.getMonth() + 1}/${date.getDate()} ` : '';
  return `${day}${fmtClock(fetchedAt)}`;
}

function scoreUpdateInfo(data, { error = false, loading = false, pending = data?.pending, now = Date.now() } = {}) {
  const live = (data?.matches || []).filter((match) => match.live || match.status === 'LIVE');
  if (!live.length) return null;

  // Use only visible live matches, never a newer timestamp from another league
  // or another day. Missing timestamps cannot establish score freshness.
  const times = live.map((match) => match.fetchedAt);
  const fetchedAt = times.every((time) => Number.isFinite(time) && time > 0) ? Math.min(...times) : null;
  const failedCount = live.filter((match) => match.refreshFailed).length;
  if (loading || pending) return { phase: 'updating', fetchedAt, text: '正在更新比分… · 当前显示上次结果' };
  if (error || failedCount) return { phase: 'failed', fetchedAt,
    text: `${!error && failedCount < live.length ? '部分' : ''}比分更新失败 · 稍后自动重试` };
  if (!fetchedAt || now - fetchedAt >= SCORE_DELAY_MS) return { phase: 'delayed', fetchedAt, text: '比分可能已延迟 · 将自动尝试更新' };
  return { phase: 'auto', fetchedAt, text: '进行中比分约每分钟自动更新 · 可能有延迟' };
}

export { scoreUpdateInfo, updateTimeLabel };
