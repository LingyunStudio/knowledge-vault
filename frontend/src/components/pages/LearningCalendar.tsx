import { useEffect, useState } from "react";
import { localDateKey, type LearningDay } from "../../store/learning";

const emptyDay: LearningDay = { read: [], created: 0, reviewed: 0 };
const count = (day: LearningDay) => day.read.length + day.created + day.reviewed;
export function calendarDays(year: number) {
  const start = new Date(year, 0, 1, 12);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(year, 11, 31, 12);
  end.setDate(end.getDate() + 6 - end.getDay());
  const days: Date[] = [];
  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) days.push(new Date(date));
  return days;
}

export function LearningCalendar({ activity = {} }: { activity?: Record<string, LearningDay> }) {
  const [today, setToday] = useState(() => localDateKey());
  const currentYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [selected, setSelected] = useState(today);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(localDateKey()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const days = calendarDays(year);
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));
  const entries = Object.entries(activity).filter(([date]) => date.startsWith(`${year}-`) && date <= today);
  const activeDays = entries.filter(([, day]) => count(day) > 0).length;
  const total = entries.reduce((sum, [, day]) => sum + count(day), 0);
  const detail = activity[selected] ?? emptyDay;
  const changeYear = (next: number) => { setYear(next); setSelected(next === currentYear ? today : `${next}-01-01`); };
  const earliestYear = Math.min(currentYear, ...Object.keys(activity).map((date) => Number(date.slice(0, 4))));
  return <section className="learning-calendar" aria-labelledby="learning-calendar-title">
    <header className="calendar-header">
      <div><h3 id="learning-calendar-title">学习日历</h3><p>{year} 年 · 活跃 {activeDays} 天 · {total} 次学习活动</p></div>
      <div className="calendar-year-nav">
        <button type="button" aria-label="上一年" disabled={year <= Math.min(earliestYear, currentYear - 4)} onClick={() => changeYear(year - 1)}>‹</button>
        <span>{year}</span>
        <button type="button" aria-label="下一年" disabled={year >= currentYear} onClick={() => changeYear(year + 1)}>›</button>
      </div>
    </header>
    <div className="calendar-scroll" role="region" aria-label={`${year} 年学习热力日历，可横向滚动`} tabIndex={0}>
      <div className="calendar-grid" style={{ gridTemplateColumns: `28px repeat(${weeks.length}, minmax(10px, 1fr))` }}>
        <div className="calendar-weekdays"><span /><span /><span>一</span><span /><span>三</span><span /><span>五</span><span /></div>
        {weeks.map((week) => {
          const monthStart = week.find((date) => date.getFullYear() === year && date.getDate() === 1);
          return <div className="calendar-week" key={localDateKey(week[0])}>
            <span className="calendar-month">{monthStart ? `${monthStart.getMonth() + 1}月` : ""}</span>
            {week.map((date) => {
              const key = localDateKey(date);
              if (date.getFullYear() !== year) return <span className="calendar-spacer" key={key} />;
              const day = activity[key] ?? emptyDay;
              const value = count(day);
              const level = value === 0 ? 0 : value <= 2 ? 1 : value <= 5 ? 2 : value <= 9 ? 3 : 4;
              const label = `${key}：阅读 ${day.read.length} 篇，制作 ${day.created} 张卡片，复习 ${day.reviewed} 次`;
              return <button type="button" key={key} className="calendar-day" data-level={level}
                disabled={key > today} aria-label={label} title={key > today ? `${key}：尚未到来` : label}
                aria-pressed={selected === key} aria-current={key === today ? "date" : undefined}
                onClick={() => setSelected(key)} />;
            })}
          </div>;
        })}
      </div>
    </div>
    <div className="calendar-footer"><span>每天一点，积累可见。</span><div className="calendar-legend" aria-label="颜色越深，当天学习活动越多"><span>少</span>{[0, 1, 2, 3, 4].map((level) => <i key={level} data-level={level} />)}<span>多</span></div></div>
    <p className="calendar-detail" aria-live="polite">{selected} · 阅读 {detail.read.length} 篇 · 制卡 {detail.created} 张 · 复习 {detail.reviewed} 次</p>
    <p className="calendar-note">从启用日历后开始记录；同一天重复打开同一篇文章只计一次，不代表阅读时长或完成度。</p>
  </section>;
}
