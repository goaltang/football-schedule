// 更新日志：纯规则，不依赖 DOM。条目按日期倒序，第一条即“最新”。
export const LS_CHANGELOG_SEEN = 'fs1.changelogSeen';

export const latestEntryId = (entries) => entries?.[0]?.id || '';

/* 最新一条与上次看过的不同就算有未读；首次访问也提示一次 */
export const hasUnread = (entries, seenId) => {
  const latest = latestEntryId(entries);
  return Boolean(latest) && latest !== seenId;
};

export function readSeen(storage) {
  try { return storage?.getItem(LS_CHANGELOG_SEEN) || ''; } catch (error) { return ''; }
}

/* 存储写满或被禁用时静默失败，本次会话内仍按已读处理 */
export function writeSeen(storage, id) {
  try { storage?.setItem(LS_CHANGELOG_SEEN, id); return true; } catch (error) { return false; }
}

export function formatEntryDate(date) {
  const [year, month, day] = String(date).split('-');
  return year && month && day ? `${year}.${month}.${day}` : String(date);
}

/* 返回问题列表，供测试守住数据格式 */
export function validateEntries(entries) {
  const problems = [];
  if (!Array.isArray(entries) || !entries.length) return ['changelog must be a non-empty array'];
  const ids = new Set();
  entries.forEach((entry, index) => {
    const where = `#${index} ${entry?.id || ''}`;
    if (!entry || typeof entry.id !== 'string' || !entry.id) problems.push(`${where}: missing id`);
    else if (ids.has(entry.id)) problems.push(`${where}: duplicate id`);
    else ids.add(entry.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry?.date || '')) problems.push(`${where}: date must be YYYY-MM-DD`);
    if (!entry?.title?.trim()) problems.push(`${where}: missing title`);
    if (!entry?.summary?.trim()) problems.push(`${where}: missing summary`);
    if (entry?.pr != null && !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(entry.pr)) problems.push(`${where}: bad pr link`);
    if (index && entries[index - 1].date < entry.date) problems.push(`${where}: entries must be newest first`);
  });
  return problems;
}
