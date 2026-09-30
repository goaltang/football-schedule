import { TEAM_ZH, normalizeTeamName, zhName } from '../../team-names.js';

const UNKNOWN_TEAM_NAME = '未知球队'; /* 数据层 normalizeEvent 的占位名，不算有效身份 */

const aliasesByName = new Map();
for (const [name, zh] of Object.entries(TEAM_ZH)) {
  if (!aliasesByName.has(zh)) aliasesByName.set(zh, new Set());
  aliasesByName.get(zh).add(normalizeTeamName(name));
}

function nameKeys(team) {
  const key = normalizeTeamName(team.name);
  const zh = zhName(team.name);
  return zh === team.name ? [key] : [...(aliasesByName.get(zh) || []), key];
}

function teamSideId(team) {
  return team && team.teamId != null && team.teamId !== '' ? String(team.teamId) : null;
}

function recordNames(rec) {
  const set = new Set(rec.names || []);
  if (rec.name && rec.name !== UNKNOWN_TEAM_NAME) set.add(normalizeTeamName(rec.name));
  return set;
}

function recordNamed(rec) {
  return !!((rec.name && rec.name !== UNKNOWN_TEAM_NAME) || (rec.names && rec.names.length));
}

function recordMatches(rec, team) {
  const tid = teamSideId(team);
  if (recordNamed(rec)) {
    /* 观察到真实队名：名字说了算——同名不同 ID 也跟随（ID 变更），
       同 ID 但队名明显不同则不跟随（ESPN 复用 ID） */
    const obsKnown = !!(team.name && team.name !== UNKNOWN_TEAM_NAME);
    if (obsKnown) {
      const keys = nameKeys(team);
      const recKeys = recordNames(rec);
      return keys.some((k) => recKeys.has(k));
    }
    /* 观察不到有效名字（占位/缺失）：无冲突证据，退回 ID */
    return !!tid && !!rec.id && rec.id === tid;
  }
  /* 旧 id-only 档案：名称未知，只能按 ID */
  return !!tid && !!rec.id && rec.id === tid;
}

function mkFollowRecord(id, name, names, leagues) {
  return {
    id: id != null && id !== '' ? String(id) : null,
    name: name || null,
    names: [...new Set((names || []).filter(Boolean))],
    leagues: [...new Set((leagues || []).filter(Boolean))],
  };
}

function storedToRecord(item) {
  if (typeof item === 'string') {
    if (!item) return null;
    if (item.startsWith('id:')) return mkFollowRecord(item.slice(3), null, [], []);
    const name = item.startsWith('name:') ? item.slice(5) : item;
    return name ? mkFollowRecord(null, null, [name], []) : null;
  }
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const names = Array.isArray(item.names) ? item.names : [];
    const leagues = Array.isArray(item.leagues) ? item.leagues : [];
    const rec = mkFollowRecord(item.id, item.name, names, leagues);
    return rec.id || rec.name || rec.names.length ? rec : null;
  }
  return null;
}

function unionRecord(target, src) {
  if (!target.name && src.name) target.name = src.name;
  if (!target.id && src.id) target.id = src.id;
  for (const k of src.names) if (!target.names.includes(k)) target.names.push(k);
  for (const l of src.leagues) if (!target.leagues.includes(l)) target.leagues.push(l);
}

/* 同名判定按已知别名放宽：zhName 相同即同队（Inter Milan / Internazionale） */
function recordNamesOverlap(a, b) {
  const ka = recordNames(a);
  const kb = recordNames(b);
  if (!ka.size || !kb.size) return false;
  const zhA = new Set([...ka].map((k) => zhName(k)));
  for (const k of kb) if (zhA.has(zhName(k))) return true;
  return false;
}

function mergeRecordList(list) {
  const out = [];
  for (const rec of list) {
    const recIsNamed = recordNamed(rec);
    /* 按 ID 合并仅限至少一侧未具名：两条已知名字却同 ID 是 ESPN 复用 ID 的不同球队，
       与 recordMatches 的 ID-reuse guard 保持一致，绝不并成一条 */
    let target = rec.id ? out.find((r) => r.id === rec.id && (!recIsNamed || !recordNamed(r))) : null;
    if (!target) target = out.find((r) => recordNamesOverlap(r, rec));
    if (target) unionRecord(target, rec);
    else out.push(rec);
  }
  return out;
}

/* 旧 fs1.followed：JSON 字符串数组（`id:X` / `name:X` / 裸名字），
   也兼容当前对象数组；未知的 id-only 关注原样保留，等观察到比赛再补全 */
function migrateFollowed(raw) {
  let val = null;
  try { val = JSON.parse(raw || '[]'); } catch (e) { return []; }
  const list = Array.isArray(val)
    ? val
    : (val && typeof val === 'object' && Array.isArray(val.teams) ? val.teams : []);
  return mergeRecordList(list.map(storedToRecord).filter(Boolean));
}


export { UNKNOWN_TEAM_NAME, nameKeys, teamSideId, recordNames, recordNamed, recordMatches, mkFollowRecord, storedToRecord, unionRecord, recordNamesOverlap, mergeRecordList, migrateFollowed };
