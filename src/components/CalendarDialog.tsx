import { useEffect, useRef, useState } from 'react';
import type { FollowRecord, ViewProps } from '../types';
import {
  calendarUrl, webcalUrl, loadCalendarIndex, resolveTeam, fetchCalendar, downloadText,
} from '../domain/calendar.js';
import { mergeCalendars } from '../domain/ics.js';
import { PanelDialog } from './PanelDialog';

interface TeamCalendar { id: string; name: string; zh: string; count: number }
interface CalendarIndex { teams: TeamCalendar[] }

/* 复制订阅地址：优先 Clipboard API，http 环境或不支持时回退到选中文本 */
async function copyText(text: string, input: HTMLInputElement | null) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    input?.focus();
    input?.select();
    try { return document.execCommand('copy'); } catch (fallbackError) { return false; }
  }
}

export function CalendarDialog({ state, api }: ViewProps) {
  const record: FollowRecord | null = state.calendarIndex != null ? state.followed[state.calendarIndex] || null : null;
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [team, setTeam] = useState<TeamCalendar | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const urlInput = useRef<HTMLInputElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  useEffect(() => {
    if (!state.calendarOpen || !record) return;
    let live = true;
    setStatus('loading');
    setTeam(null);
    setCopied(false);
    loadCalendarIndex()
      .then((index: CalendarIndex) => {
        if (!live) return;
        const found: TeamCalendar | null = resolveTeam(index, record);
        setTeam(found);
        setStatus(found ? 'ready' : 'empty');
      })
      .catch(() => { if (live) setStatus('error'); });
    return () => { live = false; };
  }, [state.calendarOpen, state.calendarIndex]);

  if (!record) return null;
  const name = api.followDisplayName(record);
  const url = team ? calendarUrl(team.id) : '';
  const summary = status === 'ready' && team
    ? `${team.zh || name} · 接下来约两个月 ${team.count} 场 · 改期自动更新`
    : `${name} · 订阅到手机或电脑的日历`;

  const download = async () => {
    if (!team || downloading) return;
    setDownloading(true);
    try {
      downloadText(`赛程-${team.zh || team.name || team.id}.ics`, await fetchCalendar(team.id));
    } catch (error) {
      setStatus('error');
    } finally {
      setDownloading(false);
    }
  };

  return <PanelDialog id="calendarDialog" open={state.calendarOpen} title="加进日历" summary={summary}
    variant="center" returnFocusId="followToggle" onClose={api.closeCalendar}
    footer={<div className="filter-panel-foot">
      <p>订阅后比赛改期、延期会自动同步到日历</p>
      <button type="button" className="filter-done" onClick={api.closeCalendar}>完成</button>
    </div>}>
    <div className="cal-body">
      {status === 'loading' && <p className="cal-note" role="status">正在准备订阅日历…</p>}
      {status === 'empty' && <p className="cal-note" role="status">暂时查不到这支球队的近期赛程，稍后再试。</p>}
      {status === 'error' && <p className="cal-note" role="status">订阅日历暂时打不开，请稍后重试。</p>}
      {status === 'ready' && team && <>
        <a className="cal-primary" href={webcalUrl(url)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 9.5h17M8 3.5V6M16 3.5V6" />
          </svg>
          在日历应用里打开
        </a>
        <p className="cal-hint">iPhone / iPad / Mac：点上面按钮，确认“订阅”即可。</p>
        <label className="cal-field">
          <span>订阅地址</span>
          <span className="cal-copy-row">
            <input ref={urlInput} className="cal-url" readOnly value={url} aria-label="订阅地址" onFocus={(event) => event.currentTarget.select()} />
            <button type="button" className="cal-copy" onClick={async () => {
              const ok = await copyText(url, urlInput.current);
              setCopied(ok);
              clearTimeout(copiedTimer.current);
              if (ok) copiedTimer.current = setTimeout(() => setCopied(false), 2000);
            }}>{copied ? '已复制' : '复制'}</button>
          </span>
        </label>
        <p className="cal-hint">安卓 / 电脑：复制地址，在 Google 日历网页版“其他日历 → 从网址添加”，或在 Outlook 里粘贴地址。</p>
        <ul className="cal-notes">
          <li>只含未来的比赛，随赛程更新向前滚动，改期和延期会自动同步。</li>
          <li>日历软件自己决定刷新时间，有时要几小时后才看到变化。</li>
          <li>默认开赛前 30 分钟提醒，可在日历里修改或关闭。</li>
        </ul>
        <button type="button" className="cal-download" onClick={download} disabled={downloading}>
          {downloading ? '正在下载…' : '只导出这一次（.ics 文件）'}
        </button>
      </>}
    </div>
  </PanelDialog>;
}

/* 关注面板底部：把已关注的球队合成一份日历，一次性导入 */
export function ExportCalendars({ state }: ViewProps) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setNote('');
    try {
      const index = await loadCalendarIndex();
      const teams = [...new Map(state.followed
        .map((record) => resolveTeam(index, record))
        .filter((team): team is TeamCalendar => Boolean(team))
        .map((team) => [team.id, team])).values()];
      if (!teams.length) {
        setNote('暂未查到可导出的赛程');
        return;
      }
      const texts = await Promise.all(teams.map((team) => fetchCalendar(team.id)));
      downloadText('赛程-我的关注.ics', mergeCalendars(texts, {
        name: '赛程 · 我的关注',
        description: '关注球队的近期赛程，导入后不再自动更新',
      }));
      setNote(`已导出 ${teams.length} 支球队`);
    } catch (error) {
      setNote('导出失败，请稍后再试');
    } finally {
      setBusy(false);
    }
  };

  return <span className="cal-export">
    <button type="button" className="cal-export-btn" onClick={run} disabled={busy || !state.followed.length}>
      {busy ? '正在导出…' : '导出全部关注'}
    </button>
    {note && <span className="cal-export-note" role="status">{note}</span>}
  </span>;
}
