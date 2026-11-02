/* 订阅日历的前端辅助：把关注档案对到构建产出的球队日历，并负责取回文件。
 * 文件由构建时从赛程快照生成（见 tools/ics-files.js），这里只做匹配和下载。 */
import { recordNames } from './following.js';
import { zhName } from '../../team-names.js';

let indexPromise = null;

function indexUrl() {
  return new URL('ics/index.json', document.baseURI).href;
}

/* 订阅地址：静态文件，一队一个，不含个人信息 */
function calendarUrl(teamId) {
  return new URL(`ics/${teamId}.ics`, document.baseURI).href;
}

function webcalUrl(url) {
  return url.replace(/^https?:\/\//, 'webcal://');
}

function loadCalendarIndex() {
  if (!indexPromise) {
    indexPromise = fetch(indexUrl(), { headers: { accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => (data && Array.isArray(data.teams) ? data : { teams: [] }))
      .catch((error) => { indexPromise = null; throw error; });
  }
  return indexPromise;
}

/* 关注档案 -> 索引条目：先按球队 ID，再按归一化队名/中文名（旧档案可能只有名字） */
function resolveTeam(index, record) {
  if (!index || !Array.isArray(index.teams) || !record) return null;
  const id = record.id != null && record.id !== '' ? String(record.id) : '';
  if (id) {
    const byId = index.teams.find((team) => team.id === id);
    if (byId) return byId;
  }
  const keys = recordNames(record);
  if (!keys.size) return null;
  const zhKeys = new Set([...keys].map((key) => zhName(key)));
  return index.teams.find((team) => team.keys.some((key) => keys.has(key)) || (team.zh ? zhKeys.has(team.zh) : false)) || null;
}

async function fetchCalendar(teamId) {
  const res = await fetch(calendarUrl(teamId), { headers: { accept: 'text/calendar' } });
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { calendarUrl, webcalUrl, loadCalendarIndex, resolveTeam, fetchCalendar, downloadText };
