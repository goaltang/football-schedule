const STATUS_LABEL = {
  SCHEDULED: '未开赛',
  LIVE: '进行中',
  FT: '完场',
  POSTPONED: '延期',
  CANCELLED: '取消',
  SUSPENDED: '中断',
  DELAYED: '延迟',
};
const UI_TEXT = {
  loading: '加载中…',
  updating: '更新中…',
  unavailable: '暂时无法加载赛程',
  incomplete: '部分赛程未能加载',
  stale: '赛程可能有变动',
  unconfirmed: '赛程待确认',
  emptyDay: '暂无比赛',
  emptyWeek: '本周暂无比赛',
  retry: '重新加载',
};

function scheduleStatus(data, error = false, loading = false) {
  if (loading || (data && data.pending)) return 'updating';
  if (error || (data && (data.error || (data.failed && data.failed.length)))) return 'incomplete';
  if (data && data.stale) return 'stale';
  return 'ready';
}

export { STATUS_LABEL, UI_TEXT, scheduleStatus };
