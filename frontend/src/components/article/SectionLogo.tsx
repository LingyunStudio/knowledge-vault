import { useEffect, useState } from "react";
import { ipc } from "../../lib/ipc";
import type { SectionDto } from "../../lib/types";

const cache = new Map<string, string | null>();

/** 板块 logo：read_logo 命令返回 data URL；缺失时用 brand 色 + glyph 兜底。 */
export function SectionLogo({ section, size = 42 }: { section: SectionDto; size?: number }) {
  const [url, setUrl] = useState<string | null | undefined>(
    cache.has(section.id) ? cache.get(section.id) : undefined,
  );

  useEffect(() => {
    let alive = true;
    if (cache.has(section.id)) {
      setUrl(cache.get(section.id));
      return;
    }
    void ipc.readLogo(section.id).then((logo) => {
      const v = logo?.dataUrl ?? null;
      cache.set(section.id, v);
      if (alive) setUrl(v);
    });
    return () => {
      alive = false;
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
