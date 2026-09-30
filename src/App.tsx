import { useEffect, useSyncExternalStore } from 'react';
import * as controller from '../app.js';
import type { AppApi } from './types';
import { Hero } from './components/Hero';
import { DateBar } from './components/DateBar';
import { LeagueFilters } from './components/LeagueFilters';
import { ScheduleList } from './components/ScheduleList';
const api = controller as unknown as AppApi;
export default function App() {
  const state = useSyncExternalStore(api.subscribe, api.getSnapshot, api.getSnapshot);
  useEffect(() => api.start(), []);
  const offset = -new Date().getTimezoneOffset() / 60;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  return <><Hero state={state} api={api} /><DateBar state={state} api={api} /><LeagueFilters state={state} api={api} /><ScheduleList state={state} api={api} />
    <footer className="foot"><span id="tz">时间：本机时区 UTC{offset >= 0 ? '+' : '−'}{Math.abs(offset)}{zone ? ' · ' + zone : ''}</span><span>数据来源：ESPN</span></footer></>;
}
