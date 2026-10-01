export interface Team {
  name: string;
  teamId?: string;
  logo?: string;
  score?: string | number;
  winner?: boolean;
}
export interface Match {
  id: string;
  league: string;
  start: string;
  status: string;
  live?: boolean;
  minute?: string;
  detail?: string;
  fetchedAt?: number;
  refreshFailed?: boolean;
  home: Team;
  away: Team;
}
export interface FollowRecord { id: string | null; name: string | null; names: string[]; leagues: string[] }
export interface DayData {
  dayKey?: string;
  matches: Match[];
  failed?: string[];
  stale?: boolean;
  pending?: boolean;
  error?: boolean;
  fetchedAt?: number | null;
  leagueMeta?: Map<string, { logo?: string }>;
}
export interface NearbyDay { dayKey: string; count: number; partial?: boolean }
export interface CatalogEntry { id: string; name: string; zh: string; logo: string; leagues: string[]; keys: string[] }
export interface Snapshot {
  dayKey: string;
  windowStart: string;
  view: 'day' | 'week';
  onlyFollowed: boolean;
  enabled: Set<string>;
  followed: FollowRecord[];
  data: DayData | null;
  weekDays: (DayData & { dayKey: string })[] | null;
  nearby: { prev?: NearbyDay; next?: NearbyDay } | null;
  preview: { dayKey: string; kind: string; count: number; matches: Match[]; partial: boolean } | null;
  loading: boolean;
  error: string | null;
  followOpen: boolean;
  filtersOpen: boolean;
  search: { query: string; catalog: CatalogEntry[]; loading: boolean; loaded: boolean; failed: number };
  followNext: (Match | null)[] | null;
  now: number;
}
export type ScheduleStatus = 'ready' | 'updating' | 'incomplete' | 'stale';
export interface AppApi {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => Snapshot;
  start: () => () => void;
  gotoDay: (key: string, options?: { resetWeek?: boolean }) => void;
  setView: (view: 'day' | 'week') => void;
  setOnlyFollowed: (onlyFollowed: boolean) => void;
  reload: (options?: { force?: boolean }) => unknown;
  toggleLeague: (id: string) => void;
  setLeagues: (ids: string[]) => void;
  toggleFilters: () => void;
  toggleFollowPanel: () => void;
  toggleFollow: (team: Team & { league?: string; leagues?: string[] }) => void;
  unfollowAt: (index: number) => void;
  setSearchQuery: (query: string) => void;
  loadCatalog: () => unknown;
  followSearchResult: (id: string) => void;
  isFollowed: (team: Team) => boolean;
  matchHasFollowed: (match: Match) => boolean;
  dayDotState: (key: string) => string;
  followDisplayName: (record: FollowRecord) => string;
  followMetaText: (record: FollowRecord) => string;
  followNextText: (match: Match | null) => string;
  scheduleStatus: (data: DayData | null, error?: unknown, loading?: boolean) => ScheduleStatus;
  scheduleNotice: (data: DayData) => string;
}
export interface ViewProps { state: Snapshot; api: AppApi }
