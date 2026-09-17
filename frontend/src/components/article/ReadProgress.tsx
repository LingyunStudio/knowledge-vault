import { useEffect, useState } from "react";

/** 文章页顶部 2.5px 朱红阅读进度线。 */
export function ReadProgress() {
  const [p, setP] = useState(0);

  useEffect(() => {
    const scroller = document.getElementById("content-scroll");
    if (!scroller) return;
    const onScroll = () => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      setP(max > 0 ? Math.min(1, scroller.scrollTop / max) : 0);
    };
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="read-progress">
      <div className="bar" style={{ width: `${p * 100}%` }} />
    </div>
  );
}
