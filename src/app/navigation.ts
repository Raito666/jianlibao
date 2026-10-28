export type Page = 'today' | 'plans' | 'exercises' | 'progress' | 'settings' | 'workout';
export const navigation: Array<{ page: Page; name: string; icon: string }> = [
  { page: 'today', name: '今天', icon: 'home' },
  { page: 'plans', name: '计划', icon: 'plans' },
  { page: 'exercises', name: '动作', icon: 'dumbbell' },
  { page: 'progress', name: '进步', icon: 'chart' },
  { page: 'settings', name: '我', icon: 'user' },
];
export const pageTitles: Record<Page, [string, string]> = {
  today: ['今天的训练', ''],
  plans: ['训练计划', ''],
  exercises: ['动作图书馆', ''],
  progress: ['训练档案', ''],
  settings: ['设置与数据', ''],
  workout: ['', ''],
};
export const pageFromHash = (value: string): Page => {
  const hash = value.replace('#/', '').split('?')[0];
  return [...navigation.map((n) => n.page), 'workout'].includes(hash) ? (hash as Page) : 'today';
};
export const getPage = (): Page => pageFromHash(location.hash);
