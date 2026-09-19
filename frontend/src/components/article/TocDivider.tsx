import { useCallback } from "react";
import { useSettings } from "../../store/settings";

/** 目录栏左缘拖拽调宽条（对称于侧栏的 SidebarDivider）。 */
export function TocDivider() {
  const setTocWidth = useSettings((s) => s.setTocWidth);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      document.body.classList.add("toc-resizing");
      const move = (ev: PointerEvent) =>
        setTocWidth(window.innerWidth - ev.clientX);
      const up = () => {
        document.body.classList.remove("toc-resizing");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [setTocWidth],
  );

  return <div className="toc-divider" onPointerDown={onPointerDown} />;
}
