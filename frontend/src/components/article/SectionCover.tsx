import { useEffect, useState } from "react";
import { ipc } from "../../lib/ipc";

const cache = new Map<string, string | null>();

/** 板块封面：read_cover 返回 data URL（cover.{png,jpg,jpeg,webp,gif}）。 */
export function SectionCover({ sectionId }: { sectionId: string }) {
  const [url, setUrl] = useState<string | null | undefined>(
    cache.has(sectionId) ? cache.get(sectionId) : undefined,
  );

  useEffect(() => {
    let alive = true;
    if (cache.has(sectionId)) {
      setUrl(cache.get(sectionId));
      return;
    }
    void ipc.readCover(sectionId).then((cover) => {
      const v = cover?.dataUrl ?? null;
      cache.set(sectionId, v);
      if (alive) setUrl(v);
    });
    return () => {
      alive = false;
    };
  }, [sectionId]);

  if (!url) return null;
  return <img className="section-cover" src={url} alt="" draggable={false} />;
}

/** 创建/更新板块封面后清除对应缓存。 */
export function invalidateCoverCache(sectionId: string): void {
  cache.delete(sectionId);
}
