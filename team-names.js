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
  // 成年男子国家队（已配置赛事名单，含 ESPN 常见名称变体）
  'China': '中国', 'China PR': '中国', 'Japan': '日本', 'South Korea': '韩国', 'Korea Republic': '韩国',
  'North Korea': '朝鲜', 'Korea DPR': '朝鲜', 'Australia': '澳大利亚', 'Iran': '伊朗', 'IR Iran': '伊朗',
  'Iraq': '伊拉克', 'Saudi Arabia': '沙特阿拉伯', 'Qatar': '卡塔尔', 'United Arab Emirates': '阿联酋',
  'Uzbekistan': '乌兹别克斯坦', 'Jordan': '约旦', 'Oman': '阿曼', 'Bahrain': '巴林', 'Kuwait': '科威特',
  'Syria': '叙利亚', 'Lebanon': '黎巴嫩', 'Palestine': '巴勒斯坦', 'Yemen': '也门', 'Afghanistan': '阿富汗',
  'Pakistan': '巴基斯坦', 'India': '印度', 'Bangladesh': '孟加拉国', 'Sri Lanka': '斯里兰卡', 'Nepal': '尼泊尔',
  'Bhutan': '不丹', 'Maldives': '马尔代夫', 'Thailand': '泰国', 'Vietnam': '越南', 'Indonesia': '印度尼西亚',
  'Malaysia': '马来西亚', 'Singapore': '新加坡', 'Philippines': '菲律宾', 'Myanmar': '缅甸', 'Cambodia': '柬埔寨',
  'Laos': '老挝', 'Brunei Darussalam': '文莱', 'Timor-Leste': '东帝汶', 'Mongolia': '蒙古',
  'Tajikistan': '塔吉克斯坦', 'Turkmenistan': '土库曼斯坦', 'Kyrgyz Republic': '吉尔吉斯斯坦', 'Kyrgyzstan': '吉尔吉斯斯坦',
  'Hong Kong': '中国香港', 'Hong Kong, China': '中国香港', 'Macau': '中国澳门', 'Chinese Taipei': '中国台北', 'Guam': '关岛',
  'England': '英格兰', 'France': '法国', 'Germany': '德国', 'Spain': '西班牙', 'Italy': '意大利',
  'Portugal': '葡萄牙', 'Netherlands': '荷兰', 'Belgium': '比利时', 'Croatia': '克罗地亚', 'Switzerland': '瑞士',
  'Denmark': '丹麦', 'Sweden': '瑞典', 'Norway': '挪威', 'Finland': '芬兰', 'Iceland': '冰岛',
  'Scotland': '苏格兰', 'Wales': '威尔士', 'Northern Ireland': '北爱尔兰', 'Republic of Ireland': '爱尔兰', 'Ireland': '爱尔兰',
  'Austria': '奥地利', 'Poland': '波兰', 'Czechia': '捷克', 'Czech Republic': '捷克', 'Slovakia': '斯洛伐克',
  'Slovenia': '斯洛文尼亚', 'Hungary': '匈牙利', 'Romania': '罗马尼亚', 'Bulgaria': '保加利亚', 'Greece': '希腊',
  'Türkiye': '土耳其', 'Turkey': '土耳其', 'Ukraine': '乌克兰', 'Russia': '俄罗斯', 'Belarus': '白俄罗斯',
  'Serbia': '塞尔维亚', 'Bosnia-Herzegovina': '波黑', 'Bosnia and Herzegovina': '波黑', 'Montenegro': '黑山',
  'North Macedonia': '北马其顿', 'Albania': '阿尔巴尼亚', 'Kosovo': '科索沃', 'Georgia': '格鲁吉亚',
  'Armenia': '亚美尼亚', 'Azerbaijan': '阿塞拜疆', 'Kazakhstan': '哈萨克斯坦', 'Israel': '以色列', 'Cyprus': '塞浦路斯',
  'Estonia': '爱沙尼亚', 'Latvia': '拉脱维亚', 'Lithuania': '立陶宛', 'Moldova': '摩尔多瓦', 'Luxembourg': '卢森堡',
  'Malta': '马耳他', 'Andorra': '安道尔', 'Liechtenstein': '列支敦士登', 'San Marino': '圣马力诺',
  'Faroe Islands': '法罗群岛', 'Gibraltar': '直布罗陀',
  'Argentina': '阿根廷', 'Brazil': '巴西', 'Uruguay': '乌拉圭', 'Colombia': '哥伦比亚', 'Chile': '智利',
  'Ecuador': '厄瓜多尔', 'Peru': '秘鲁', 'Paraguay': '巴拉圭', 'Bolivia': '玻利维亚', 'Venezuela': '委内瑞拉',
  'United States': '美国', 'United States of America': '美国', 'USA': '美国', 'Mexico': '墨西哥', 'Canada': '加拿大',
  'Costa Rica': '哥斯达黎加', 'Panama': '巴拿马', 'Honduras': '洪都拉斯', 'El Salvador': '萨尔瓦多',
  'Guatemala': '危地马拉', 'Nicaragua': '尼加拉瓜', 'Belize': '伯利兹', 'Jamaica': '牙买加', 'Haiti': '海地',
  'Cuba': '古巴', 'Dominican Republic': '多米尼加共和国', 'Trinidad and Tobago': '特立尼达和多巴哥',
  'Curaçao': '库拉索', 'Curacao': '库拉索', 'Suriname': '苏里南', 'Guyana': '圭亚那', 'Bahamas': '巴哈马',
  'Barbados': '巴巴多斯', 'Bermuda': '百慕大', 'Puerto Rico': '波多黎各', 'Aruba': '阿鲁巴', 'Bonaire': '博内尔',
  'Antigua and Barbuda': '安提瓜和巴布达', 'St. Kitts and Nevis': '圣基茨和尼维斯',
  'St. Lucia': '圣卢西亚', 'St. Vincent and the Grenadines': '圣文森特和格林纳丁斯', 'Grenada': '格林纳达',
  'Dominica': '多米尼克', 'Cayman Islands': '开曼群岛', 'Turks and Caicos Islands': '特克斯和凯科斯群岛',
  'British Virgin Islands': '英属维尔京群岛', 'US Virgin Islands': '美属维尔京群岛', 'Anguilla': '安圭拉',
  'Montserrat': '蒙特塞拉特', 'Martinique': '马提尼克', 'Sint Maarten': '荷属圣马丁', 'St. Martin': '法属圣马丁',
  'Morocco': '摩洛哥', 'Algeria': '阿尔及利亚', 'Tunisia': '突尼斯', 'Egypt': '埃及', 'Libya': '利比亚',
  'Senegal': '塞内加尔', 'Ivory Coast': '科特迪瓦', "Cote d'Ivoire": '科特迪瓦', 'Ghana': '加纳',
  'Nigeria': '尼日利亚', 'Cameroon': '喀麦隆', 'Mali': '马里', 'Burkina Faso': '布基纳法索', 'Guinea': '几内亚',
  'Guinea-Bissau': '几内亚比绍', 'Equatorial Guinea': '赤道几内亚', 'Gambia': '冈比亚', 'Cape Verde': '佛得角',
  'Sierra Leone': '塞拉利昂', 'Liberia': '利比里亚', 'Benin': '贝宁', 'Togo': '多哥', 'Niger': '尼日尔',
  'Chad': '乍得', 'Central African Republic': '中非共和国', 'Gabon': '加蓬', 'Congo': '刚果共和国',
  'Congo DR': '刚果民主共和国', 'DR Congo': '刚果民主共和国', 'Democratic Republic of Congo': '刚果民主共和国',
  'South Africa': '南非', 'Zambia': '赞比亚', 'Zimbabwe': '津巴布韦', 'Angola': '安哥拉', 'Mozambique': '莫桑比克',
  'Namibia': '纳米比亚', 'Botswana': '博茨瓦纳', 'Lesotho': '莱索托', 'Eswatini': '斯威士兰',
  'Malawi': '马拉维', 'Madagascar': '马达加斯加', 'Comoros': '科摩罗', 'Mauritius': '毛里求斯', 'Seychelles': '塞舌尔',
  'Mauritania': '毛里塔尼亚', 'Sudan': '苏丹', 'South Sudan': '南苏丹', 'Ethiopia': '埃塞俄比亚',
  'Eritrea': '厄立特里亚', 'Djibouti': '吉布提', 'Somalia': '索马里', 'Kenya': '肯尼亚', 'Uganda': '乌干达',
  'Tanzania': '坦桑尼亚', 'Rwanda': '卢旺达', 'Burundi': '布隆迪', 'Sao Tome and Principe': '圣多美和普林西比',
  'New Zealand': '新西兰', 'Fiji': '斐济', 'Solomon Islands': '所罗门群岛', 'Vanuatu': '瓦努阿图',
  'New Caledonia': '新喀里多尼亚', 'Tahiti': '塔希提', 'Papua New Guinea': '巴布亚新几内亚',
  'Samoa': '萨摩亚', 'American Samoa': '美属萨摩亚', 'Tonga': '汤加', 'Cook Islands': '库克群岛',
};

/* 搜索用的常用简称/昵称（key 为 TEAM_ZH 里的中文名）：中文名与英文名已能搜到，这里只补口语叫法 */
const TEAM_SEARCH_ALIASES = {
  '皇家马德里': ['皇马', 'Real'], '巴塞罗那': ['巴萨', '巴塞', 'Barca'], '马德里竞技': ['马竞', 'Atleti'],
  '曼城': ['蓝月亮', 'Man City'], '曼联': ['红魔', 'Man United', 'Man Utd'], '利物浦': ['红军'],
  '阿森纳': ['枪手'], '切尔西': ['蓝军'], '热刺': ['托特纳姆', 'Spurs'], '纽卡斯尔': ['喜鹊', 'Newcastle'],
  '西汉姆联': ['西汉姆', 'West Ham'], '狼队': ['狼', 'Wolves'], '国际米兰': ['国米', 'Inter'],
  'AC米兰': ['米兰', 'Milan', 'ACM'], '尤文图斯': ['尤文', '老妇人', 'Juve'], '那不勒斯': ['拿破仑'],
  '拜仁慕尼黑': ['拜仁', 'Bayern'], '多特蒙德': ['多特', 'BVB'], '勒沃库森': ['药厂', 'Leverkusen'],
  '巴黎圣日耳曼': ['巴黎', '大巴黎', 'PSG'], '毕尔巴鄂竞技': ['毕尔巴鄂'], '皇家贝蒂斯': ['贝蒂斯'],
  '北京国安': ['国安'], '上海申花': ['申花'], '上海海港': ['海港', '上港'], '山东泰山': ['泰山'],
  '中国': ['国足', '中国男足', 'China PR'], '英格兰': ['三狮军团'], '美国': ['USA', 'USMNT'],
  '荷兰': ['橙衣军团'], '德国': ['德国战车'], '沙特阿拉伯': ['沙特'], '韩国': ['Korea Republic'],
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

export { normalizeTeamName, buildZhIndex, zhName, TEAM_ZH, TEAM_SEARCH_ALIASES, ZH_PREFIX, ZH_SUFFIX };
