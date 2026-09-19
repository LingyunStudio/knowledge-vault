import { useEffect, useState } from "react";
import { ipc } from "../../lib/ipc";

const cache = new Map<string, string | null>();
const CHANGE_EVENT = "kv:section-cover-changed";

/** 板块封面：read_cover 返回 data URL（cover.{png,jpg,jpeg,webp,gif}）。 */
export function SectionCover({ sectionId }: { sectionId: string }) {
  const [url, setUrl] = useState<string | null | undefined>(
    cache.has(sectionId) ? cache.get(sectionId) : undefined,
  );

  useEffect(() => {
    let alive = true;
    const fetchCover = () => {
      void ipc.readCover(sectionId).then((cover) => {
        const v = cover?.dataUrl ?? null;
        cache.set(sectionId, v);
        if (alive) setUrl(v);
      });
    };
    if (cache.has(sectionId)) {
      setUrl(cache.get(sectionId));
    } else {
      fetchCover();
    }
    // 编辑对话框保存后通知已挂载组件重取
    const onChanged = (e: Event) => {
      const id = (e as CustomEvent<{ sectionId?: string }>).detail?.sectionId;
      if (id && id !== sectionId) return;
      fetchCover();
    };
    window.addEventListener(CHANGE_EVENT, onChanged);
    return () => {
      alive = false;
      window.removeEventListener(CHANGE_EVENT, onChanged);
    };
  }, [sectionId]);

  if (!url) return null;
  return <img className="section-cover" src={url} alt="" draggable={false} />;
}

/** 创建/更新板块封面后清除缓存并通知已挂载组件。不传 sectionId 时全部刷新。 */
export function invalidateCoverCache(sectionId?: string): void {
  if (sectionId) cache.delete(sectionId);
  window.dispatchEvent(
    new CustomEvent(CHANGE_EVENT, { detail: { sectionId } }),
  );
}
