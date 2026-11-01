import { useState } from 'react';
import entries from '../changelog.json';
import { hasUnread, latestEntryId, readSeen, writeSeen, formatEntryDate } from '../domain/changelog.js';
import { PanelDialog } from './PanelDialog';

export interface ChangelogEntry { id: string; date: string; title: string; summary: string; pr?: string }
export const changelogEntries = entries as ChangelogEntry[];
const prNumber = (url: string) => url.match(/\/pull\/(\d+)$/)?.[1] || '';
const storage = () => (typeof localStorage === 'undefined' ? null : localStorage);

export function ChangelogList({ items }: { items: ChangelogEntry[] }) {
  return <ol className="changelog-list">
    {items.map((entry) => <li key={entry.id} className="changelog-item">
      <time className="changelog-date" dateTime={entry.date}>{formatEntryDate(entry.date)}</time>
      <h3 className="changelog-title">{entry.title}</h3>
      <p className="changelog-summary">{entry.summary}</p>
      {entry.pr && <a className="changelog-pr" href={entry.pr} target="_blank" rel="noopener noreferrer"
        aria-label={`查看 PR #${prNumber(entry.pr)}：${entry.title}（新窗口打开）`}>PR #{prNumber(entry.pr)}</a>}
    </li>)}
  </ol>;
}

export function Changelog({ items = changelogEntries, initialOpen = false }: { items?: ChangelogEntry[]; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [seen, setSeen] = useState(() => readSeen(storage()));
  const unread = hasUnread(items, seen);
  const show = () => {
    const latest = latestEntryId(items);
    writeSeen(storage(), latest);
    setSeen(latest);
    setOpen(true);
  };
  return <>
    <button type="button" className="changelog-toggle" id="changelogToggle" aria-haspopup="dialog" aria-expanded={open}
      aria-controls="changelogDialog" aria-label={unread ? '更新日志，有新内容' : '更新日志'} onClick={show}>
      更新日志{unread && <span className="changelog-dot" aria-hidden="true" />}
    </button>
    <PanelDialog id="changelogDialog" open={open} title="更新日志" summary={`最近的重要更新 · 共 ${items.length} 条`}
      returnFocusId="changelogToggle" onClose={() => setOpen(false)}
      footer={<div className="filter-panel-foot"><p>只记录较大的功能和改动</p>
        <button type="button" className="filter-done" onClick={() => setOpen(false)}>完成</button></div>}>
      <ChangelogList items={items} />
    </PanelDialog>
  </>;
}
