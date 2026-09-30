import { dayKeyOf, parseDayKey, addDays } from '../../data.js';
import { LEAGUES } from '../../config.js';
import { zhName } from '../../team-names.js';
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function fmtTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtDayLabel(dayKey) {
  const d = parseDayKey(dayKey);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function fmtClock(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function weekdayOf(dayKey) {
  return WEEKDAYS[parseDayKey(dayKey).getDay()];
}

function periodLabel(iso) {
  const h = new Date(iso).getHours();
  if (h < 6) return '凌晨';
  if (h < 12) return '上午';
  if (h < 14) return '中午';
  if (h < 18) return '下午';
  if (h < 23) return '晚上';
  return '深夜';
}

function relativeLabel(dayKey) {
  const today = dayKeyOf(new Date());
  if (dayKey === today) return '今天';
  if (dayKey === addDays(today, -1)) return '昨天';
  if (dayKey === addDays(today, 1)) return '明天';
  return weekdayOf(dayKey);
}

function countdownText(startIso, nowMs) {
  const diff = new Date(startIso).getTime() - nowMs;
  if (!Number.isFinite(diff) || diff <= 0) return '';
  if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))} 分钟后`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时后`;
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)} 天后`;
  return '';
}

function teamName(t) {
  return (t && zhName(t.name)) || (t && t.name) || '';
}

function leagueZh(leagueId) {
  return (LEAGUES.find((l) => l.id === leagueId) || {}).zh || '';
}

export { fmtTime, fmtDayLabel, fmtClock, weekdayOf, periodLabel, relativeLabel, countdownText, teamName, leagueZh };
