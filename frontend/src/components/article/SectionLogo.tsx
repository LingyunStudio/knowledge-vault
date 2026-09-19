import { useEffect, useState } from "react";
import { ipc } from "../../lib/ipc";
import type { SectionDto } from "../../lib/types";

const cache = new Map<string, string | null>();
const CHANGE_EVENT = "kv:section-logo-changed";

/** 板块 logo：read_logo 命令返回 data URL；缺失时用 brand 色 + glyph 兜底。 */
export function SectionLogo({ section, size = 42 }: { section: SectionDto; size?: number }) {
  const [url, setUrl] = useState<string | null | undefined>(
    cache.has(section.id) ? cache.get(section.id) : undefined,
  );

  useEffect(() => {
    let alive = true;
    const fetchLogo = () => {
      void ipc.readLogo(section.id).then((logo) => {
        const v = logo?.dataUrl ?? null;
        cache.set(section.id, v);
        if (alive) setUrl(v);
      });
    };
    if (cache.has(section.id)) {
      setUrl(cache.get(section.id));
    } else {
      fetchLogo();
    }
    // 编辑对话框保存后通知已挂载组件（卡片/侧栏）重取
    const onChanged = (e: Event) => {
      const id = (e as CustomEvent<{ sectionId?: string }>).detail?.sectionId;
      if (id && id !== section.id) return;
      fetchLogo();
    };
    window.addEventListener(CHANGE_EVENT, onChanged);
    return () => {
      alive = false;
      window.removeEventListener(CHANGE_EVENT, onChanged);
    };
  }, [section.id]);

  if (url) {
    return (
      <span className="section-logo" style={{ width: size, height: size }}>
        <img src={url} alt="" />
      </span>
    );
  }
  return (
    <span
      className="section-logo"
      style={{
        width: size,
        height: size,
        background: section.brand ?? "var(--text-faint)",
      }}
    >
      <span className="glyph">{section.glyph}</span>
    </span>
  );
}

/** 创建/更新板块 logo 后清除缓存并通知已挂载组件。不传 sectionId 时全部刷新。 */
export function invalidateLogoCache(sectionId?: string): void {
  if (sectionId) cache.delete(sectionId);
  window.dispatchEvent(
    new CustomEvent(CHANGE_EVENT, { detail: { sectionId } }),
  );
}
