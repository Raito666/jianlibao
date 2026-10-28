import type { Exercise } from '../../domain/types';
import Icon from '../../components/Icon';

export default function HistoryToolbar({
  search,
  setSearch,
  historyExercise,
  setHistoryExercise,
  trained,
}: {
  search: string;
  setSearch: (value: string) => void;
  historyExercise: string;
  setHistoryExercise: (value: string) => void;
  trained: Exercise[];
}) {
  return (
    <div className="history-toolbar">
      <label className="library-search">
        <Icon name="search" size={16} />
        <span className="sr-only">搜索训练历史</span>
        <input
          type="search"
          aria-label="搜索训练历史"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索训练、动作或备注…"
        />
      </label>
      <select
        className="form-select"
        aria-label="历史动作筛选"
        value={historyExercise}
        onChange={(e) => setHistoryExercise(e.target.value)}
      >
        <option value="all">全部动作</option>
        {trained.map((ex) => (
          <option key={ex.id} value={ex.id}>
            {ex.name}
          </option>
        ))}
      </select>
    </div>
  );
}
