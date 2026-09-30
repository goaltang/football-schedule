import { NATIONAL_LEAGUES } from '../../config.js';
import { zhName, TEAM_SEARCH_ALIASES } from '../../team-names.js';

function searchKey(s) {
  return String(s == null ? '' : s)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}

function buildCatalog(perLeague) {
  const byId = new Map();
  for (const { leagueId, teams } of perLeague) {
    for (const t of teams) {
      let e = byId.get(t.id);
      if (!e) {
        const zh = zhName(t.name);
        e = {
          id: t.id, name: t.name, zh, logo: t.logo, leagues: [],
          keys: [zh, t.name, t.short, ...(TEAM_SEARCH_ALIASES[zh] || [])].map(searchKey).filter(Boolean),
        };
        byId.set(t.id, e);
      }
      if (!e.leagues.includes(leagueId)) e.leagues.push(leagueId);
      if (NATIONAL_LEAGUES.includes(leagueId)) {
        for (const name of [`${e.zh}队`, `${e.zh}国家队`]) {
          const key = searchKey(name);
          if (!e.keys.includes(key)) e.keys.push(key);
        }
      }
    }
  }
  return [...byId.values()];
}

function searchScore(entry, q) {
  let best = -1;
  for (const k of entry.keys) {
    const at = k.indexOf(q);
    if (at < 0) continue;
    const sc = at === 0 ? (k.length === q.length ? 0 : 1) : 2;
    if (best < 0 || sc < best) best = sc;
  }
  return best;
}

function searchTeams(catalog, query) {
  const q = searchKey(query);
  if (!q) return [];
  return catalog
    .map((e) => ({ e, sc: searchScore(e, q) }))
    .filter((r) => r.sc >= 0)
    .sort((a, b) => (a.sc - b.sc) || a.e.zh.localeCompare(b.e.zh, 'zh'))
    .map((r) => r.e);
}

export { searchKey, buildCatalog, searchScore, searchTeams };
