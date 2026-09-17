import { useEffect, useState } from "react";
import type { TocHeading } from "./CrepeEditor";

/** 右侧页内目录：滚动跟踪当前标题，点击平滑定位。 */
export function Toc({ headings }: { headings: TocHeading[] }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const scroller = document.getElementById("content-scroll");
    if (!scroller || headings.length === 0) return;
    const onScroll = () => {
      const top = scroller.getBoundingClientRect().top;
      let idx = 0;
      headings.forEach((h, i) => {
        if (h.el.getBoundingClientRect().top - top <= 130) idx = i;
      });
      setActive(idx);
    };
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [headings]);

  if (headings.length < 3) return null;

  return (
    <aside className="toc-rail scroll-thin">
      <div className="toc-title">本页目录</div>
      {headings.map((h, i) => (
        <button
          key={`${h.level}-${i}`}
          className={`toc-item lvl-${h.level}${i === active ? " active" : ""}`}
          onClick={() =>
            h.el.scrollIntoView({ behavior: "smooth", block: "start" })
          }
        >
          {h.text}
        </button>
      ))}
    </aside>
  );
}
