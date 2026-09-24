/* 球队中文名对照表
 * - key：英文名（任意常见写法均可，匹配时做归一化：忽略大小写/音调/标点/FC 等前缀后缀）
 *   因此 "Atlético Madrid" / "Atletico Madrid" / "Atlético de Madrid" 这类变体只算一条
 * - value：中文名；查不到时界面自动显示英文名，并在 console 里提示待补名单
 * - 全量查漏：双击 tools/zh-coverage.html，会列出当前所有联赛中未收录的队名
 */
'use strict';

const TEAM_ZH = {
  // 英超
  'Manchester City': '曼城', 'Liverpool': '利物浦', 'Arsenal': '阿森纳', 'Chelsea': '切尔西',
  'Tottenham Hotspur': '热刺', 'Manchester United': '曼联', 'Newcastle United': '纽卡斯尔',
  'Aston Villa': '阿斯顿维拉', 'Brighton & Hove Albion': '布莱顿', 'West Ham United': '西汉姆联',
  'Everton': '埃弗顿', 'Fulham': '富勒姆', 'Crystal Palace': '水晶宫', 'Wolverhampton Wanderers': '狼队',
  'Nottingham Forest': '诺丁汉森林', 'Brentford': '布伦特福德', 'AFC Bournemouth': '伯恩茅斯',
  'Burnley': '伯恩利', 'Leeds United': '利兹联', 'Sunderland': '桑德兰', 'Hull City': '赫尔城',
  'Ipswich Town': '伊普斯维奇', 'Coventry City': '考文垂', 'Wolves': '狼队',
  // 西甲
  'Real Madrid': '皇家马德里', 'Barcelona': '巴塞罗那', 'FC Barcelona': '巴塞罗那',
  'Atlético Madrid': '马德里竞技', 'Atletico de Madrid': '马德里竞技', 'Athletic Club': '毕尔巴鄂竞技',
  'Real Sociedad': '皇家社会', 'Villarreal': '比利亚雷亚尔', 'Real Betis': '皇家贝蒂斯',
  'Sevilla': '塞维利亚', 'Valencia': '瓦伦西亚', 'Espanyol': '西班牙人', 'Mallorca': '马略卡',
  'Osasuna': '奥萨苏纳', 'Getafe': '赫塔费', 'Rayo Vallecano': '巴列卡诺', 'Celta Vigo': '塞尔塔',
  'Deportivo': '拉科鲁尼亚', 'Deportivo Alaves': '阿拉维斯', 'Alavés': '阿拉维斯', 'Girona': '赫罗纳',
  'Elche': '埃尔切', 'Levante': '莱万特', 'Real Oviedo': '皇家奥维耶多', 'Malaga': '马拉加',
  'Racing Santander': '桑坦德竞技', 'Cadiz': '加的斯', 'Las Palmas': '拉斯帕尔马斯',
  // 德甲
  'Bayern Munich': '拜仁慕尼黑', 'Borussia Dortmund': '多特蒙德', 'Bayer Leverkusen': '勒沃库森',
  'RB Leipzig': 'RB莱比锡', 'VfB Stuttgart': '斯图加特', 'Eintracht Frankfurt': '法兰克福',
  'SC Freiburg': '弗赖堡', 'Wolfsburg': '沃尔夫斯堡', 'Borussia Monchengladbach': '门兴格拉德巴赫',
  'Mainz': '美因茨', 'Augsburg': '奥格斯堡', 'Werder Bremen': '云达不莱梅', 'Hoffenheim': '霍芬海姆',
  'Union Berlin': '柏林联合', 'St. Pauli': '圣保利', 'Heidenheim': '海登海姆', 'Hamburg SV': '汉堡',
  'Cologne': '科隆', 'Koln': '科隆', 'Arminia Bielefeld': '比勒费尔德', 'Schalke 04': '沙尔克04',
  'Elversberg': '埃尔弗斯贝格', 'Paderborn': '帕德博恩', 'Holstein Kiel': '荷尔斯泰因基尔',
  // 意甲
  'Inter Milan': '国际米兰', 'Internazionale': '国际米兰', 'AC Milan': 'AC米兰', 'Juventus': '尤文图斯',
  'Napoli': '那不勒斯', 'Roma': '罗马', 'Lazio': '拉齐奥', 'Atalanta': '亚特兰大', 'Fiorentina': '佛罗伦萨',
  'Bologna': '博洛尼亚', 'Torino': '都灵', 'Udinese': '乌迪内斯', 'Genoa': '热那亚', 'Cagliari': '卡利亚里',
  'Hellas Verona': '维罗纳', 'Lecce': '莱切', 'Parma': '帕尔马', 'Como': '科莫', 'Sassuolo': '萨索洛',
  'Pisa': '比萨', 'Cremonese': '克雷莫内塞', 'Venezia': '威尼斯', 'Frosinone': '弗罗西诺内', 'Monza': '蒙扎',
  // 法甲
  'Paris Saint-Germain': '巴黎圣日耳曼', 'Marseille': '马赛', 'Monaco': '摩纳哥', 'Lyon': '里昂',
  'Lille': '里尔', 'Nice': '尼斯', 'Lens': '朗斯', 'Rennes': '雷恩', 'Strasbourg': '斯特拉斯堡',
  'Toulouse': '图卢兹', 'Brest': '布雷斯特', 'Nantes': '南特', 'Auxerre': '欧塞尔', 'Angers': '昂热',
  'Le Havre': '勒阿弗尔', 'Saint-Etienne': '圣埃蒂安', 'Metz': '梅斯', 'Lorient': '洛里昂',
  'Paris FC': '巴黎FC', 'Troyes': '特鲁瓦', 'Le Mans': '勒芒', 'Bordeaux': '波尔多',
  // 中超
  'Shanghai Shenhua': '上海申花', 'Shanghai Port': '上海海港', 'Beijing Guoan': '北京国安',
  'Shandong Taishan': '山东泰山', 'Chengdu Rongcheng': '成都蓉城', 'Wuhan Three Towns': '武汉三镇',
  'Tianjin Jinmen Tiger': '天津津门虎', 'Zhejiang Professional FC': '浙江队', 'Henan': '河南队',
  'Shenzhen Xinpengcheng': '深圳新鹏城', 'Qingdao Hainiu': '青岛海牛', 'Qingdao West Coast': '青岛西海岸',
  'Dalian Yingbo': '大连英博', 'Yunnan Yukun': '云南玉昆', 'Chongqing Tonglianglong': '重庆铜梁龙',
  'Liaoning Tieren': '辽宁铁人', 'Changchun Yatai': '长春亚泰', 'Meizhou Hakka': '梅州客家',
  // 日职
  'Vissel Kobe': '神户胜利船', 'Kashima Antlers': '鹿岛鹿角', 'Yokohama F. Marinos': '横滨水手',
  'Urawa Red Diamonds': '浦和红钻', 'Kawasaki Frontale': '川崎前锋', 'Gamba Osaka': '大阪钢巴',
  'Cerezo Osaka': '大阪樱花', 'FC Tokyo': 'FC东京', 'Sanfrecce Hiroshima': '广岛三箭',
  'Nagoya Grampus': '名古屋鲸八', 'Kashiwa Reysol': '柏太阳神', 'Avispa Fukuoka': '福冈黄蜂',
  'Kyoto Sanga': '京都不死鸟', 'Machida Zelvia': '町田泽维亚', 'Tokyo Verdy 1969': '东京绿茵',
  'JEF United Ichihara-Chiba': '千叶市原', 'Fagiano Okayama': '冈山绿雉', 'Mito Hollyhock': '水户蜀葵',
  'Shimizu S-Pulse': '清水心跳', 'V-Varen Nagasaki': '长崎航海', 'Shonan Bellmare': '湘南比马',
  // 英冠
  'Leicester City': '莱斯特城', 'Southampton': '南安普敦', 'Norwich City': '诺维奇',
  'Sheffield United': '谢菲尔德联', 'Middlesbrough': '米德尔斯堡', 'West Bromwich Albion': '西布朗',
  'Watford': '沃特福德', 'Blackburn Rovers': '布莱克本', 'Bristol City': '布里斯托尔城', 'Stoke City': '斯托克城',
  'Derby County': '德比郡', 'Preston North End': '普雷斯顿', 'Queens Park Rangers': '女王公园巡游者',
  'Millwall': '米尔沃尔', 'Swansea City': '斯旺西', 'Cardiff City': '卡迪夫城', 'Portsmouth': '朴茨茅斯',
  'Sheffield Wednesday': '谢菲尔德星期三', 'Birmingham City': '伯明翰', 'Wrexham': '雷克瑟姆',
  'Oxford United': '牛津联', 'Plymouth Argyle': '普利茅斯', 'Luton Town': '卢顿', 'Bolton Wanderers': '博尔顿',
  'Charlton Athletic': '查尔顿', 'Lincoln City': '林肯城',
  // 欧战及其他常见球队
  'Porto': '波尔图', 'Benfica': '本菲卡', 'Sporting CP': '葡萄牙体育', 'Sporting Lisbon': '葡萄牙体育',
  'Ajax': '阿贾克斯', 'Ajax Amsterdam': '阿贾克斯', 'PSV Eindhoven': '埃因霍温', 'PSV': '埃因霍温',
  'Feyenoord': '费耶诺德', 'Feyenoord Rotterdam': '费耶诺德', 'AZ Alkmaar': '阿尔克马尔', 'NEC Nijmegen': '奈梅亨',
  'Twente': '特温特', 'Celtic': '凯尔特人', 'Rangers': '格拉斯哥流浪者', 'Hearts': '哈茨',
  'Galatasaray': '加拉塔萨雷', 'Fenerbahce': '费内巴切', 'Besiktas': '贝西克塔斯', 'Trabzonspor': '特拉布宗体育',
  'Shakhtar Donetsk': '顿涅茨克矿工', 'Dynamo Kyiv': '基辅迪纳摩', 'Dinamo Zagreb': '萨格勒布迪纳摩',
  'Red Star Belgrade': '贝尔格莱德红星', 'Partizan': '贝尔格莱德游击', 'Slavia Prague': '布拉格斯拉维亚',
  'Sparta Prague': '布拉格斯巴达', 'Viktoria Plzen': '比尔森胜利', 'Slovan Bratislava': '布拉迪斯拉发斯洛万',
  'Olympiacos': '奥林匹亚科斯', 'PAOK': '塞萨洛尼基', 'AEK Athens': '雅典AEK', 'Panathinaikos': '帕纳辛奈科斯',
  'Club Brugge': '布鲁日', 'Anderlecht': '安德莱赫特', 'Union Saint-Gilloise': '圣吉罗斯联合', 'Gent': '根特',
  'Salzburg': '萨尔茨堡红牛', 'Sturm Graz': '格拉茨风暴', 'LASK Linz': 'LASK林茨',
  'Bodo/Glimt': '博德闪耀', 'Molde': '莫尔德', 'Rosenborg': '罗森博格', 'Viking FK': '维京',
  'Midtjylland': '中日德兰', 'Nordsjaelland': '北西兰', 'Copenhagen': '哥本哈根', 'Brann': '布兰',
  'HJK Helsinki': '赫尔辛基', 'KuPS': '库普斯', 'Elfsborg': '埃尔夫斯堡', 'Mjallby': '米亚尔比',
  'Legia Warszawa': '华沙莱吉亚', 'Lech Poznan': '波兹南莱赫', 'Jagiellonia Bialystok': '雅盖隆尼亚',
  'Qarabag': '卡拉巴赫', 'Sabah FK': '萨巴赫', 'Ferencvaros': '费伦茨瓦罗斯', 'Ludogorets': '卢多戈雷茨',
  'Steaua Bucuresti': '布加勒斯特星', 'CFR Cluj': '克卢日', 'CSU Craiova': '克拉约瓦大学', 'FCSB': '布加勒斯特星',
  'Young Boys': '伯尔尼年轻人', 'Basel': '巴塞尔', 'Lugano': '卢加诺', 'Thun': '图恩',
  'Omonia Nicosia': '尼科西亚奥莫尼亚', 'APOEL': '希腊人竞技', 'Pafos': '帕福斯', 'Maccabi Tel Aviv': '特拉维夫马卡比',
  "Hapoel Be'er": '贝尔谢巴工人', 'Beitar Jerusalem': '贝塔耶路撒冷', 'Levski Sofia': '索菲亚列夫斯基',
  'CSKA Sofia': '索菲亚中央陆军', 'Ludogorets Razgrad': '卢多戈雷茨', 'Hajduk Split': '斯普利特海杜克',
  'Rijeka': '里耶卡', 'NK Osijek': '奥西耶克', 'Celje': '采列', 'Olimpija Ljubljana': '卢布尔雅那奥林匹亚',
  'Zrinjski Mostar': '莫斯塔尔兹林伊斯基', 'Borac Banja Luka': '巴尼亚卢卡博拉茨', 'Drita': '德里塔',
  'Lincoln Red Imps': '林肯红魔', 'Shamrock Rovers': '沙姆洛克流浪者', 'Drogheda United': '德罗赫达联',
  'The New Saints': '新圣徒', 'Vikingur Reykjavik': '雷克雅未克维京人', 'Breidablik': '布雷达布利克',
  'RFS': '里加足球学校', 'Riga FC': '里加', 'Flora Tallinn': '塔林弗洛拉', 'Levadia Tallinn': '塔林塔迪瓦亚',
  'Zalgiris Vilnius': '维尔纽斯扎尔吉里斯', 'Kauno Zalgiris': '考纳斯扎尔吉里斯', 'Hegelmann': '黑格尔曼',
  'Egnatia': '埃格纳提亚', 'Dinamo Batumi': '巴统迪纳摩', 'Iberia 1999': '伊比利亚1999', 'Torpedo Kutaisi': '库塔伊西鱼雷',
  'Differdange 03': '迪弗当日', 'Racing Union': '竞技联', 'Inter D\'Escaldes': '埃斯卡尔德斯国际', 'UE Santa Coloma': '圣科洛马',
  'Villarreal B': '比利亚雷亚尔B', 'Real Sociedad B': '皇家社会B', 'Athletic Club B': '毕尔巴鄂竞技B',
  'AGF': '奥胡斯', 'Silkeborg': '锡尔克堡', 'Randers': '兰讷斯', 'Viborg': '维堡', 'Sonderjyske': '南日德兰',
  'St. Gilloise': '圣吉罗斯联合', 'Mechelen': '梅赫伦', 'Standard Liege': '标准列日', 'Genk': '亨克', 'Antwerp': '安特卫普',
  'Ararat-Armenia': '亚拉腊', 'Pyunik': '埃里温凤凰', 'Alashkert': '阿拉什科特', 'Torreense': '托伦斯',
  'Lillestrom': '利勒斯特罗姆', 'Bodo': '博德闪耀', 'St Pauli': '圣保利', 'Monchengladbach': '门兴格拉德巴赫',
  'Ofi Crete': 'OFI克里特', 'Maccabi Haifa': '海法马卡比', 'HJK': '赫尔辛基',
  // 需要精确匹配的写法（含数字、缩写或特殊拼写，归一化兜不住的）
  'SC Paderborn 07': '帕德博恩', 'Le Havre AC': '勒阿弗尔', 'Stade Rennais': '雷恩',
  'RB Salzburg': '萨尔茨堡红牛', 'Union St.-Gilloise': '圣吉罗斯联合', 'Heart of Midlothian': '哈茨',
  'F.C. København': '哥本哈根', 'FC Copenhagen': '哥本哈根', 'FC Nordsjælland': '北西兰',
  'KAA Gent': '根特', 'KuPS Kuopio': '库普斯', 'Mjällby AIF': '米亚尔比', 'Jablonec': '亚布洛内茨',
  'Kairat Almaty': '阿拉木图凯拉特', 'Braga': '布拉加', 'Omonia': '尼科西亚奥莫尼亚', 'Sint-Truidense': '圣图尔登',
};

/* 名称归一化：忽略大小写、音调、标点、FC/AS/SK 之类的俱乐部前后缀，
 * 让 "1. FC Union Berlin" 与 "Union Berlin"、"Atlético" 与 "Atletico" 命中同一条 */
const ZH_PREFIX = /^(fc|afc|cf|cd|sc|ac|as|ss|us|rc|rcd|aj|sk|nk|tsg|sv|vfl|vfb|bsc|1fc)/;
const ZH_SUFFIX = /(fc|afc|cf|sc|fk|club)$/;

function normalizeTeamName(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(ZH_PREFIX, '')
    .replace(ZH_SUFFIX, '');
}

let zhIndex = null;
function buildZhIndex() {
  if (zhIndex) return zhIndex;
  zhIndex = new Map();
  const conflicts = [];
  for (const [en, zh] of Object.entries(TEAM_ZH)) {
    const key = normalizeTeamName(en);
    if (zhIndex.has(key) && zhIndex.get(key) !== zh) conflicts.push(en);
    zhIndex.set(key, zh);
  }
  if (conflicts.length) console.warn('[赛程] 队名归一化冲突（两条不同译名被归为同名）:', conflicts.join(', '));
  return zhIndex;
}

/* 查中文名；未收录返回英文原名 */
function zhName(englishName) {
  return buildZhIndex().get(normalizeTeamName(englishName)) || englishName;
}
