import { useCallback } from "react";
import { useSettings } from "../../store/settings";

/** 侧栏右缘 4px 拖拽调宽条。 */
export function SidebarDivider() {
  const setSidebarWidth = useSettings((s) => s.setSidebarWidth);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      document.body.classList.add("sidebar-resizing");
      const move = (ev: PointerEvent) => setSidebarWidth(ev.clientX);
      const up = () => {
        document.body.classList.remove("sidebar-resizing");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [setSidebarWidth],
  );

  return <div className="sidebar-divider" onPointerDown={onPointerDown} />;
}
