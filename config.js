/* 联赛配置
 * - slug 即 ESPN 联赛标识，可自行增删（如 por.1 葡超、ned.1 荷甲）
 * - 球队中文名在 team-names.js
 */
'use strict';

const LEAGUES = [
  { id: 'eng.1',           zh: '英超',   en: 'Premier League' },
  { id: 'esp.1',           zh: '西甲',   en: 'LaLiga' },
  { id: 'ger.1',           zh: '德甲',   en: 'Bundesliga' },
  { id: 'ita.1',           zh: '意甲',   en: 'Serie A' },
  { id: 'fra.1',           zh: '法甲',   en: 'Ligue 1' },
  { id: 'uefa.champions',  zh: '欧冠',   en: 'Champions League' },
  { id: 'uefa.europa',     zh: '欧联',   en: 'Europa League' },
  { id: 'chn.1',           zh: '中超',   en: 'Chinese Super League' },
  { id: 'eng.2',           zh: '英冠',   en: 'Championship' },
  { id: 'jpn.1',           zh: '日职',   en: 'J1 League' },
  { id: 'uefa.europa.conf', zh: '欧协联', en: 'Conference League' },
];

const DEFAULT_ENABLED = LEAGUES.slice(0, 8).map((l) => l.id);

if (typeof module !== 'undefined') module.exports = { LEAGUES, DEFAULT_ENABLED };
