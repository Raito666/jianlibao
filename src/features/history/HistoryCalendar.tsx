import { isCompactViewport } from '../../platform/compact-layout';
import type { Session } from '../../domain/types';
import Icon from '../../components/Icon';

export default function HistoryCalendar({
  calendarOpen,
  setCalendarOpen,
  date,
  month,
  moveMonth,
  offset,
  days,
  sessions,
  today,
  setDate,
  setMonth,
  setAllHistory,
}: {
  calendarOpen: boolean;
  setCalendarOpen: (value: boolean) => void;
  date: string;
  month: string;
  moveMonth: (n: number) => void;
  offset: number;
  days: number;
  sessions: Session[];
  today: string;
  setDate: (value: string) => void;
  setMonth: (value: string) => void;
  setAllHistory: (value: boolean) => void;
}) {
  return (
    <details
      className="card calendar-card"
      open={calendarOpen}
      onToggle={(event) => setCalendarOpen(event.currentTarget.open)}
    >
      <summary aria-label="按日期筛选训练">
        <span>按日期筛选</span>
        <small>{date || month}</small>
        <Icon name="chevron-down" size={16} />
      </summary>
      <div className="section-heading">
        <h3>{month.replace('-', ' 年 ')} 月</h3>
        <div className="row">
          <button className="icon-button" aria-label="上个月" onClick={() => moveMonth(-1)}>
            <Icon name="back" size={16} />
          </button>
          <button className="icon-button" aria-label="下个月" onClick={() => moveMonth(1)}>
            <Icon name="arrow" size={16} />
          </button>
        </div>
      </div>
      <div className="calendar-grid">
        {['一', '二', '三', '四', '五', '六', '日'].map((d) => (
          <span className="calendar-label" key={d}>
            {d}
          </span>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={`e${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const key = `${month}-${String(i + 1).padStart(2, '0')}`;
          const count = sessions.filter((s) => s.date === key).length;
          return (
            <button
              key={key}
              aria-label={`${key}${count ? `，${count}场训练` : '，无训练'}`}
              aria-current={key === today ? 'date' : undefined}
              aria-pressed={date === key}
              className={`calendar-day ${key === today ? 'today' : ''} ${count ? 'completed' : ''} ${date === key ? 'selected' : ''}`}
              onClick={() => {
                setDate(date === key ? '' : key);
                if (isCompactViewport()) setCalendarOpen(false);
              }}
            >
              <span>{i + 1}</span>
              <small>{count ? `${count}练` : ''}</small>
            </button>
          );
        })}
      </div>
      <p className="calendar-help muted">点击日期查看；再次点击返回整月。</p>
      <button
        className="text-button"
        onClick={() => {
          setMonth(today.slice(0, 7));
          setDate('');
          setAllHistory(false);
        }}
      >
        回到本月
      </button>
    </details>
  );
}
