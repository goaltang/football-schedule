import type { Page } from '@playwright/test';
import { LEAGUES } from '../../config.js';

export async function fixtures(page: Page, options: { empty?: boolean; unavailable?: boolean; followed?: string[] } = {}) {
  await page.clock.install({ time: new Date('2026-09-30T12:00:00+08:00') });
  await page.route('https://site.api.espn.com/**', (route) => route.abort());
  await page.route('**/snapshot/schedule.json', (route) => route.fulfill({ json: { months: {} } }));
  await page.route('**/snapshot/teams.json', (route) => route.fulfill({ json: { leagues: Object.fromEntries(LEAGUES.map((league) => [league.id, {
    fetchedAt: Date.parse('2026-09-30T12:00:00+08:00'), teams: [{ id: '360', name: 'Manchester United', short: 'Man Utd', logo: '' }, { id: '560', name: 'China', short: 'China', logo: '' }],
  }])) } }));
  await page.addInitScript(({ options, leagues }) => {
    if (localStorage.getItem('__fixture_ready')) return;
    localStorage.setItem('__fixture_ready', '1');
    localStorage.setItem('fs1.enabled', '["eng.1","esp.1"]');
    localStorage.setItem('fs1.day', '2026-09-30');
    localStorage.setItem('fs1.followed', JSON.stringify(options.followed || []));
    if (options.unavailable) return;
    for (const id of leagues) for (const ym of ['202609', '202610']) {
      localStorage.setItem(`fs1|m|${id}|${ym}`, JSON.stringify({ fetchedAt: Date.parse('2026-09-30T12:00:00+08:00'), league: { id, logo: '' }, events: options.empty || id !== 'eng.1' || ym !== '202609' ? [] : [
        { id: 'game-1', league: id, start: '2026-09-30T20:00:00+08:00', status: 'SCHEDULED', home: { name: 'Manchester United', teamId: '360' }, away: { name: 'Arsenal', teamId: '359' } },
        { id: 'game-2', league: id, start: '2026-10-01T20:00:00+08:00', status: 'FT', home: { name: 'China', teamId: '560', score: '2' }, away: { name: 'Japan', teamId: '561', score: '1' } },
      ] }));
    }
  }, { options, leagues: LEAGUES.map((league) => league.id) });
}
