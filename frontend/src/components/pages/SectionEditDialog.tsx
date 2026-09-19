import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ipc } from "../../lib/ipc";
import type { SectionDto } from "../../lib/types";
import { invalidateCoverCache } from "../article/SectionCover";
import { invalidateLogoCache } from "../article/SectionLogo";

const COVER_MAX_MB = 12;
const LOGO_MAX_MB = 2;

interface PickedImage {
  ext: string;
  dataBase64: string;
  preview: string;
  name: string;
}

const COVER_TYPES = /^image\/(png|jpeg|webp|gif)$/;
const LOGO_TYPES = /^image\/(svg\+xml|png|jpeg|webp)$/;

/** 按字段类型把所选图片读成 base64 载荷；校验失败返回错误文案。 */
function pickImage(file: File, kind: "cover" | "logo"): Promise<PickedImage> {
  const isCover = kind === "cover";
  const m = (isCover ? COVER_TYPES : LOGO_TYPES).exec(file.type);
  if (!m) {
    return Promise.reject(
      isCover
        ? "封面仅支持 PNG / JPG / WebP / GIF"
        : "图标仅支持 SVG / PNG / JPG / WebP",
    );
  }
  const max = isCover ? COVER_MAX_MB : LOGO_MAX_MB;
  if (file.size > max * 1024 * 1024) {
    return Promise.reject(`图片过大（超过 ${max}MB）`);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      const ext =
        file.type === "image/jpeg"
          ? "jpg"
          : file.type === "image/svg+xml"
            ? "svg"
            : m[1];
      resolve({ ext, dataBase64: base64, preview: dataUrl, name: file.name });
    };
    reader.onerror = () => reject("读取图片失败");
    reader.readAsDataURL(file);
  });
}

/**
 * 编辑板块显示信息：名称、一句话描述、封面（卡片顶部大图）与图标
 * （卡片/侧栏的小标志）。板块目录名不变。
 */
export function SectionEditDialog({
  section,
  onClose,
}: {
  section: SectionDto;
  /** changed 为 true 表示保存过修改，调用方需要重扫知识库。 */
  onClose: (changed: boolean) => void;
}) {
  const [name, setName] = useState(section.name);
  const [desc, setDesc] = useState(section.desc);
  const [currentCover, setCurrentCover] = useState<string | null>(null);
  const [currentLogo, setCurrentLogo] = useState<string | null>(null);
  const [pickedCover, setPickedCover] = useState<PickedImage | null>(null);
  const [pickedLogo, setPickedLogo] = useState<PickedImage | null>(null);
  const [removingCover, setRemovingCover] = useState(false);
  const [removingLogo, setRemovingLogo] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let alive = true;
    void ipc.readCover(section.id).then((c) => {
      if (alive) setCurrentCover(c?.dataUrl ?? null);
    });
    void ipc.readLogo(section.id).then((l) => {
      if (alive) setCurrentLogo(l?.dataUrl ?? null);
    });
    return () => {
      alive = false;
    };
  }, [section.id]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus();
    };
  }, []);

  const coverPreview = pickedCover?.preview ?? (removingCover ? null : currentCover);
  const logoPreview = pickedLogo?.preview ?? (removingLogo ? null : currentLogo);

  const onFile = (file: File | null, kind: "cover" | "logo") => {
    setErr(null);
    if (!file) return;
    pickImage(file, kind)
      .then((picked) => {
        if (kind === "cover") {
          setPickedCover(picked);
          setRemovingCover(false);
        } else {
          setPickedLogo(picked);
          setRemovingLogo(false);
        }
      })
      .catch((e) => setErr(String(e)));
  };

  const clear = (kind: "cover" | "logo") => {
    setErr(null);
    if (kind === "cover") {
      if (pickedCover) setPickedCover(null);
      else setRemovingCover(true);
    } else {
      if (pickedLogo) setPickedLogo(null);
      else setRemovingLogo(true);
    }
  };

  const undoRemove = (kind: "cover" | "logo") => {
    if (kind === "cover") setRemovingCover(false);
    else setRemovingLogo(false);
  };

  const save = async () => {
    const name_ = name.trim();
    if (!name_) {
      setErr("名称不能为空");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await ipc.updateSection(section.id, {
        name: name_,
        desc: desc.trim(),
        cover: pickedCover
          ? { ext: pickedCover.ext, dataBase64: pickedCover.dataBase64 }
          : null,
        removeCover: removingCover && !pickedCover,
        logo: pickedLogo
          ? { ext: pickedLogo.ext, dataBase64: pickedLogo.dataBase64 }
          : null,
        removeLogo: removingLogo && !pickedLogo,
      });
      invalidateCoverCache(section.id);
      invalidateLogoCache(section.id);
      onClose(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const renderImageField = (
    kind: "cover" | "logo",
    label: string,
    hint: string,
    preview: string | null,
    picked: boolean,
    current: string | null,
    removing: boolean,
    accept: string,
  ) => (
    <div className="section-edit-field">
      <span>{label}</span>
      {preview ? (
        <div className={kind === "cover" ? "cover-edit" : "logo-edit"}>
          <img src={preview} alt="" />
          <button
            type="button"
            className="cover-edit-clear"
            title={picked ? "撤销选择新图" : `移除${label}`}
            onClick={() => clear(kind)}
          >
            ×
          </button>
        </div>
      ) : current && removing ? (
        <div className="cover-edit-removed">
          {label}将被移除
          <button type="button" onClick={() => undoRemove(kind)}>
            撤销
          </button>
        </div>
      ) : (
        <label className="cover-edit-empty" title={hint}>
          🖼 {hint}
          <input
            type="file"
            accept={accept}
            onChange={(e) => {
              onFile(e.target.files?.[0] ?? null, kind);
              e.target.value = "";
            }}
          />
        </label>
      )}
      {!picked && current && !removing && (
        <button
          type="button"
          className="cover-edit-remove-btn"
          onClick={() => clear(kind)}
        >
          移除{label}
        </button>
      )}
    </div>
  );

  return createPortal(
    <dialog
      ref={dialogRef}
      className="section-edit-dialog"
      aria-labelledby="section-edit-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose(false);
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header className="section-edit-header">
        <h2 id="section-edit-title">编辑板块信息</h2>
        <button className="ai-icon-btn" aria-label="关闭" title="关闭" onClick={() => onClose(false)}>
          ✕
        </button>
      </header>
      <div className="section-edit-body">
        <label className="section-edit-field">
          <span>名称</span>
          <input
            autoFocus
            value={name}
            spellCheck={false}
            onChange={(e) => {
              setName(e.target.value);
              setErr(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim() && !saving) void save();
            }}
          />
        </label>
        <label className="section-edit-field">
          <span>描述</span>
          <input
            value={desc}
            placeholder="一句话描述（可选）"
            spellCheck={false}
            onChange={(e) => {
              setDesc(e.target.value);
              setErr(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim() && !saving) void save();
            }}
          />
        </label>
        {renderImageField(
          "logo",
          "图标",
          "小标志，显示在卡片与侧栏（SVG / PNG / JPG / WebP）",
          logoPreview,
          !!pickedLogo,
          currentLogo,
          removingLogo,
          "image/svg+xml,image/png,image/jpeg,image/webp",
        )}
        {renderImageField(
          "cover",
          "封面",
          "卡片顶部大图（PNG / JPG / WebP / GIF）",
          coverPreview,
          !!pickedCover,
          currentCover,
          removingCover,
          "image/png,image/jpeg,image/webp,image/gif",
        )}
        {err && <div className="section-edit-err" role="alert">{err}</div>}
      </div>
      <footer className="section-edit-actions">
        <button className="primary" disabled={saving} onClick={() => void save()}>
          {saving ? "保存中…" : "保存"}
        </button>
        <button disabled={saving} onClick={() => onClose(false)}>
          取消
        </button>
      </footer>
    </dialog>,
    document.body,
  );
}
