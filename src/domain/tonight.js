import { addDays, dayKeyOf, parseDayKey } from '../../data.js';

// 试用范围，待球迷反馈后调整；全部日期沿用赛程页的本机时区。
const TONIGHT_START_HOUR = 18;
const TONIGHT_END_HOUR = 6;

function tonightDayKey(now = Date.now()) {
  const date = new Date(now);
  const today = dayKeyOf(date);
  // 凌晨仍属于刚开始的这一晚，06:00 才切换到今天晚上的赛程。
  return date.getHours() < TONIGHT_END_HOUR ? addDays(today, -1) : today;
}

function tonightRange(dayKey) {
  const nextDay = addDays(dayKey, 1);
  const start = parseDayKey(dayKey);
  const end = parseDayKey(nextDay);
  start.setHours(TONIGHT_START_HOUR, 0, 0, 0);
  end.setHours(TONIGHT_END_HOUR, 0, 0, 0);
  return { start: start.getTime(), end: end.getTime(), dayKeys: [dayKey, nextDay] };
}

function summarizeTonight(days, dayKey) {
  if (!days) return null;
  const { start, end } = tonightRange(dayKey);
  const byId = new Map();
  for (const day of days) for (const match of day.matches) {
    const kickoff = new Date(match.start).getTime();
    if (kickoff >= start && kickoff < end) byId.set(match.id, match);
  }
  return {
    dayKey,
    matches: [...byId.values()].sort((a, b) => new Date(a.start) - new Date(b.start)),
    failed: [...new Set(days.flatMap((day) => day.failed || []))],
    error: days.some((day) => day.error),
    stale: days.some((day) => day.stale),
    pending: days.some((day) => day.pending),
    fetchedAt: Math.max(0, ...days.map((day) => day.fetchedAt || 0)) || null,
  };
}

export { TONIGHT_START_HOUR, TONIGHT_END_HOUR, tonightDayKey, tonightRange, summarizeTonight };
