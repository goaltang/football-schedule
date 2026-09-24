/* 联赛与球队配置
 * - slug 即 ESPN 联赛标识，可自行增删
 * - TEAM_ZH：常见球队中文名（键为 ESPN displayName），查不到时自动回落英文名
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

const TEAM_ZH = {
  // 英超
  'Manchester City': '曼城', 'Liverpool': '利物浦', 'Arsenal': '阿森纳', 'Chelsea': '切尔西',
  'Tottenham Hotspur': '热刺', 'Manchester United': '曼联', 'Newcastle United': '纽卡斯尔',
  'Aston Villa': '阿斯顿维拉', 'Brighton & Hove Albion': '布莱顿', 'West Ham United': '西汉姆联',
  'Everton': '埃弗顿', 'Fulham': '富勒姆', 'Crystal Palace': '水晶宫', 'Wolverhampton Wanderers': '狼队',
  'Nottingham Forest': '诺丁汉森林', 'Brentford': '布伦特福德', 'AFC Bournemouth': '伯恩茅斯',
  'Burnley': '伯恩利', 'Leeds United': '利兹联', 'Sunderland': '桑德兰',
  // 西甲
  'Real Madrid': '皇家马德里', 'Barcelona': '巴塞罗那', 'FC Barcelona': '巴塞罗那',
  'Atletico de Madrid': '马德里竞技', 'Athletic Club': '毕尔巴鄂竞技', 'Real Sociedad': '皇家社会',
  'Villarreal': '比利亚雷亚尔', 'Villarreal CF': '比利亚雷亚尔', 'Real Betis': '皇家贝蒂斯',
  'Sevilla': '塞维利亚', 'Sevilla FC': '塞维利亚', 'Valencia': '瓦伦西亚', 'Valencia CF': '瓦伦西亚',
  'Espanyol': '西班牙人', 'RCD Espanyol': '西班牙人', 'Mallorca': '马略卡', 'Osasuna': '奥萨苏纳',
  'Getafe': '赫塔费', 'Rayo Vallecano': '巴列卡诺', 'Celta de Vigo': '塞尔塔',
  'Deportivo Alaves': '阿拉维斯', 'Girona': '赫罗纳', 'Elche': '埃尔切', 'Levante': '莱万特',
  'Real Oviedo': '皇家奥维耶多', 'Atletico Madrid': '马德里竞技', 'Celta Vigo': '塞尔塔',
  'Malaga': '马拉加', 'Málaga': '马拉加', 'Racing Santander': '桑坦德竞技',
  'Atlético Madrid': '马德里竞技', 'Atlético de Madrid': '马德里竞技', 'Alavés': '阿拉维斯', 'Alaves': '阿拉维斯',
  // 德甲
  'Bayern Munich': '拜仁慕尼黑', 'Borussia Dortmund': '多特蒙德', 'Bayer Leverkusen': '勒沃库森',
  'RB Leipzig': 'RB莱比锡', 'VfB Stuttgart': '斯图加特', 'Eintracht Frankfurt': '法兰克福',
  'SC Freiburg': '弗赖堡', 'VfL Wolfsburg': '沃尔夫斯堡', 'Wolfsburg': '沃尔夫斯堡',
  "Borussia M'gladbach": '门兴格拉德巴赫', 'Borussia Monchengladbach': '门兴格拉德巴赫',
  'Mainz 05': '美因茨', 'FSV Mainz 05': '美因茨', 'Augsburg': '奥格斯堡', 'FC Augsburg': '奥格斯堡',
  'Werder Bremen': '云达不莱梅', 'Hoffenheim': '霍芬海姆', 'TSG Hoffenheim': '霍芬海姆',
  'Union Berlin': '柏林联合', 'St. Pauli': '圣保利', 'Heidenheim': '海登海姆',
  'Hamburger SV': '汉堡', 'Koln': '科隆', 'FC Koln': '科隆', 'Arminia Bielefeld': '比勒费尔德',
  'Schalke 04': '沙尔克04', 'SV Elversberg': '埃尔弗斯贝格', '1. FC Union Berlin': '柏林联合',
  'Mainz': '美因茨', 'Hamburg SV': '汉堡', 'SC Paderborn 07': '帕德博恩',
  // 意甲
  'Inter Milan': '国际米兰', 'Internazionale': '国际米兰', 'AC Milan': 'AC米兰', 'Juventus': '尤文图斯', 'Napoli': '那不勒斯',
  'Roma': '罗马', 'AS Roma': '罗马', 'Lazio': '拉齐奥', 'Atalanta': '亚特兰大',
  'Fiorentina': '佛罗伦萨', 'Bologna': '博洛尼亚', 'Torino': '都灵', 'Udinese': '乌迪内斯',
  'Genoa': '热那亚', 'Cagliari': '卡利亚里', 'Hellas Verona': '维罗纳', 'Lecce': '莱切',
  'Parma': '帕尔马', 'Como': '科莫', 'Sassuolo': '萨索洛', 'Pisa': '比萨', 'Cremonese': '克雷莫内塞',
  'Venezia': '威尼斯', 'Frosinone': '弗罗西诺内',
  // 法甲
  'Paris Saint-Germain': '巴黎圣日耳曼', 'Marseille': '马赛', 'Olympique de Marseille': '马赛',
  'Monaco': '摩纳哥', 'AS Monaco': '摩纳哥', 'Lyon': '里昂', 'Olympique Lyonnais': '里昂',
  'Lille': '里尔', 'LOSC Lille': '里尔', 'Nice': '尼斯', 'Lens': '朗斯', 'Rennes': '雷恩',
  'Stade Rennais': '雷恩', 'Strasbourg': '斯特拉斯堡', 'Toulouse': '图卢兹', 'Brest': '布雷斯特',
  'Nantes': '南特', 'Auxerre': '欧塞尔', 'Angers': '昂热', 'Le Havre': '勒阿弗尔',
  'Saint-Etienne': '圣埃蒂安', 'Metz': '梅斯', 'Lorient': '洛里昂', 'Paris FC': '巴黎FC',
  'Le Havre AC': '勒阿弗尔', 'Troyes': '特鲁瓦', 'Le Mans': '勒芒',
  // 欧战常见球队
  'Porto': '波尔图', 'Benfica': '本菲卡', 'Sporting CP': '葡萄牙体育', 'Sporting Lisbon': '葡萄牙体育',
  'Ajax': '阿贾克斯', 'PSV': 'PSV埃因霍温', 'Feyenoord': '费耶诺德', 'Celtic': '凯尔特人',
  'Rangers': '格拉斯哥流浪者', 'Galatasaray': '加拉塔萨雷', 'Fenerbahce': '费内巴切',
  'Besiktas': '贝西克塔斯', 'Shakhtar Donetsk': '顿涅茨克矿工', 'Dinamo Zagreb': '萨格勒布迪纳摩',
  'Red Star Belgrade': '贝尔格莱德红星', 'Slavia Praha': '布拉格斯拉维亚', 'Olympiacos': '奥林匹亚科斯',
  'PAOK': '塞萨洛尼基', 'Club Brugge': '布鲁日', 'Anderlecht': '安德莱赫特', 'Salzburg': '萨尔茨堡红牛',
  'RB Salzburg': '萨尔茨堡红牛', 'Bodo/Glimt': '博德闪耀', 'Qarabag': '卡拉巴赫', 'Young Boys': '伯尔尼年轻人',
  'Basel': '巴塞尔', 'Dynamo Kyiv': '基辅迪纳摩', 'Ludogorets': '卢多戈雷茨', 'Ferencvaros': '费伦茨瓦罗斯',
  'Midtjylland': '中日德兰', 'Copenhagen': '哥本哈根', 'FC Copenhagen': '哥本哈根',
  'Maccabi Tel Aviv': '特拉维夫马卡比', 'Real Betis Balompie': '皇家贝蒂斯',
  // 中超
  'Shanghai Shenhua': '上海申花', 'Shanghai Port': '上海海港', 'Shanghai SIPG': '上海海港',
  'Beijing Guoan': '北京国安', 'Shandong Taishan': '山东泰山', 'Shandong Luneng': '山东泰山',
  'Chengdu Rongcheng': '成都蓉城', 'Wuhan Three Towns': '武汉三镇', 'Tianjin Jinmen Tiger': '天津津门虎',
  'Tianjin Teda': '天津津门虎', 'Zhejiang Professional': '浙江队', 'Zhejiang FC': '浙江队',
  'Changchun Yatai': '长春亚泰', 'Henan FC': '河南队', 'Henan Jianye': '河南队',
  'Shenzhen Peng City': '深圳新鹏城', 'Shenzhen FC': '深圳队', 'Qingdao Hainiu': '青岛海牛',
  'Qingdao West Coast': '青岛西海岸', 'Meizhou Hakka': '梅州客家', 'Dalian Yingbo': '大连英博',
  'Yunnan Yukun': '云南玉昆',
  // 日职
  'Vissel Kobe': '神户胜利船', 'Kashima Antlers': '鹿岛鹿角', 'Yokohama F. Marinos': '横滨水手',
  'Urawa Red Diamonds': '浦和红钻', 'Kawasaki Frontale': '川崎前锋', 'Gamba Osaka': '大阪钢巴',
  'Cerezo Osaka': '大阪樱花', 'FC Tokyo': 'FC东京', 'Sanfrecce Hiroshima': '广岛三箭',
  'Nagoya Grampus': '名古屋鲸八', 'Kashiwa Reysol': '柏太阳神', 'Avispa Fukuoka': '福冈黄蜂',
  'Kyoto Sanga': '京都不死鸟', 'Shonan Bellmare': '湘南比马', 'Machida Zelvia': '町田泽维亚',
  // 英冠
  'Leicester City': '莱斯特城', 'Southampton': '南安普敦', 'Ipswich Town': '伊普斯维奇',
  'Norwich City': '诺维奇', 'Sheffield United': '谢菲尔德联', 'Middlesbrough': '米德尔斯堡',
  'West Bromwich Albion': '西布朗', 'Watford': '沃特福德', 'Blackburn Rovers': '布莱克本',
  'Coventry City': '考文垂', 'Bristol City': '布里斯托尔城', 'Hull City': '赫尔城', 'Stoke City': '斯托克城',
  'Derby County': '德比郡', 'Preston North End': '普雷斯顿', 'Queens Park Rangers': '女王公园巡游者',
  'Millwall': '米尔沃尔', 'Swansea City': '斯旺西', 'Cardiff City': '卡迪夫城', 'Portsmouth': '朴茨茅斯',
  'Sheffield Wednesday': '谢菲尔德星期三', 'Birmingham City': '伯明翰', 'Wrexham': '雷克瑟姆',
  'Oxford United': '牛津联', 'Plymouth Argyle': '普利茅斯', 'Luton Town': '卢顿',
};
