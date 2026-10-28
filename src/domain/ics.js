/* iCalendar（RFC 5545）拼装：只做赛程订阅需要的部分，不依赖 Node 或浏览器。
 *
 * 服务端（构建时生成 dist/ics/*.ics）和浏览器（导出一次、合并关注）共用这里的实现，
 * 保证两条路径的时间、标题、状态和折叠规则完全一致。
 */

const encoder = new TextEncoder();
const sizeCache = new Map();

function charBytes(ch) {
  let size = sizeCache.get(ch);
  if (size === undefined) {
    size = encoder.encode(ch).length;
    if (sizeCache.size < 4096) sizeCache.set(ch, size);
  }
  return size;
}

/* 文本值转义：反斜杠、分号、逗号、换行，RFC 5545 §3.3.11 */
function escapeText(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/* 内容行折叠：每行不超过 75 个八位组，续行以单个空格开头 */
function foldLine(line) {
  const out = [];
  let current = '';
  let bytes = 0;
  for (const ch of String(line)) {
    const size = charBytes(ch);
    if (bytes + size > 75) {
      out.push(current);
      current = ' ';
      bytes = 1;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n');
}

/* 毫秒时间戳 -> UTC 的 `YYYYMMDDTHHMMSSZ` */
function formatUtc(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function stampOf(ms) {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? n : Date.now();
}

const STATUS_MAP = {
  CANCELLED: { status: 'CANCELLED', prefix: '[已取消] ' },
  POSTPONED: { status: 'TENTATIVE', prefix: '[延期] ' },
  SUSPENDED: { status: 'TENTATIVE', prefix: '[中断] ' },
  ABANDONED: { status: 'TENTATIVE', prefix: '[中断] ' },
};

/* 单场比赛 -> VEVENT 正文（不含 BEGIN/END 包装） */
function eventBlock(event) {
  const start = new Date(event.start).getTime();
  if (!Number.isFinite(start)) return null;
  const end = start + (event.durationMs || 2 * 3600e3);
  const stamp = stampOf(event.stamp);
  const mapped = STATUS_MAP[event.status] || { status: 'CONFIRMED', prefix: '' };
  const title = `${mapped.prefix}${event.title || ''}`.trim();
  const lines = [
    'BEGIN:VEVENT',
    `UID:${escapeText(event.uid)}`,
    `DTSTAMP:${formatUtc(stamp)}`,
    `LAST-MODIFIED:${formatUtc(stamp)}`,
    `DTSTART:${formatUtc(start)}`,
    `DTEND:${formatUtc(end)}`,
    `SUMMARY:${escapeText(title)}`,
  ];
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  lines.push(`STATUS:${mapped.status}`, 'TRANSP:TRANSPARENT', 'SEQUENCE:0');
  /* 取消/延期不提醒：原来的开赛时间已经不可信，闹钟只会误导 */
  const alarm = mapped.status === 'CONFIRMED' ? event.alarmMinutes : 0;
  if (alarm) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(title)}`,
      `TRIGGER:-PT${Math.max(1, Math.round(alarm))}M`, 'END:VALARM');
  }
  lines.push('END:VEVENT');
  return lines.map(foldLine).join('\r\n');
}

/* 外层 VCALENDAR。bodies 是已经序列化好的 VEVENT 正文 */
function wrapCalendar({ name, description, ttlMinutes = 60, bodies = [] }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//football-schedule//zh-CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
  ];
  if (description) lines.push(`X-WR-CALDESC:${escapeText(description)}`);
  lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${ttlMinutes}M`, `X-PUBLISHED-TTL:PT${ttlMinutes}M`);
  const header = lines.map(foldLine).join('\r\n');
  return `${header}\r\n${bodies.filter(Boolean).join('\r\n')}${bodies.length ? '\r\n' : ''}END:VCALENDAR\r\n`;
}

function calendarBlock({ name, description, ttlMinutes, events = [] }) {
  const bodies = events.map(eventBlock).filter(Boolean);
  return wrapCalendar({ name, description, ttlMinutes, bodies });
}

/* 从现有文件里取出 VEVENT 正文，供“导出全部关注”合并使用 */
function extractEvents(text) {
  const blocks = [];
  const re = /BEGIN:VEVENT\r?\n[\s\S]*?END:VEVENT/g;
  let match;
  while ((match = re.exec(String(text || ''))) !== null) blocks.push(match[0]);
  return blocks;
}

function uidOf(block) {
  const line = block.match(/(?:^|\r?\n)UID:([^\r\n]*)/);
  return line ? line[1].trim() : '';
}

/* 合并多份日历：按 UID 去重，先出现的优先 */
function mergeCalendars(texts, { name, description, ttlMinutes } = {}) {
  const seen = new Set();
  const bodies = [];
  for (const text of texts) {
    for (const block of extractEvents(text)) {
      const uid = uidOf(block);
      if (uid && seen.has(uid)) continue;
      if (uid) seen.add(uid);
      bodies.push(block);
    }
  }
  return wrapCalendar({ name, description, ttlMinutes, bodies });
}

export { escapeText, foldLine, formatUtc, eventBlock, wrapCalendar, calendarBlock, extractEvents, mergeCalendars };
