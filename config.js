/* 赛事配置（LEAGUES 保留原名，兼容已有缓存与关注档案）
 * - slug 即 ESPN 赛事标识，可自行增删（如 por.1 葡超、ned.1 荷甲）
 * - group: 'national' 为成年男子国家队赛事，其余为俱乐部赛事
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
  { id: 'fifa.friendly',       zh: '国际友谊赛',     en: "Men's International Friendly", group: 'national' },
  { id: 'uefa.nations',        zh: '欧国联',         en: 'UEFA Nations League', group: 'national' },
  { id: 'fifa.world',          zh: '世界杯',         en: 'FIFA World Cup', group: 'national' },
  { id: 'fifa.worldq.afc',      zh: '世预赛·亚洲',    en: 'World Cup Qualifying · AFC', group: 'national' },
  { id: 'fifa.worldq.uefa',     zh: '世预赛·欧洲',    en: 'World Cup Qualifying · UEFA', group: 'national' },
  { id: 'fifa.worldq.conmebol', zh: '世预赛·南美',    en: 'World Cup Qualifying · CONMEBOL', group: 'national' },
  { id: 'fifa.worldq.concacaf', zh: '世预赛·中北美',  en: 'World Cup Qualifying · Concacaf', group: 'national' },
  { id: 'fifa.worldq.caf',      zh: '世预赛·非洲',    en: 'World Cup Qualifying · CAF', group: 'national' },
  { id: 'fifa.worldq.ofc',      zh: '世预赛·大洋洲',  en: 'World Cup Qualifying · OFC', group: 'national' },
  { id: 'afc.asian.cup',       zh: '亚洲杯',         en: 'AFC Asian Cup', group: 'national' },
  { id: 'afc.cupq',            zh: '亚洲杯预选赛',   en: 'AFC Asian Cup Qualifiers', group: 'national' },
  { id: 'uefa.euro',           zh: '欧洲杯',         en: 'UEFA European Championship', group: 'national' },
  { id: 'uefa.euroq',          zh: '欧洲杯预选赛',   en: 'UEFA European Championship Qualifying', group: 'national' },
  { id: 'conmebol.america',    zh: '美洲杯',         en: 'Copa América', group: 'national' },
];

const NATIONAL_LEAGUES = LEAGUES.filter((l) => l.group === 'national').map((l) => l.id);
const DEFAULT_ENABLED = [...LEAGUES.slice(0, 8).map((l) => l.id), ...NATIONAL_LEAGUES];


export { LEAGUES, NATIONAL_LEAGUES, DEFAULT_ENABLED };
