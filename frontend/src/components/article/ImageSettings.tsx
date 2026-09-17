import { useState } from "react";
import { create } from "zustand";
import { DEFAULT_UPLOAD_COMMAND, useSettings } from "../../store/settings";

/** 图片上传设置弹窗的开合状态 */
interface ImageSettingsState {
  open: boolean;
  setOpen: (v: boolean) => void;
}
export const useImageSettings = create<ImageSettingsState>((set) => ({
  open: false,
  setOpen: (v) => set({ open: v }),
}));

/** 图片上传设置弹窗：upgit 开关与命令配置。 */
export function ImageSettings({ embedded = false }: { embedded?: boolean }) {
  const open = useImageSettings((s) => s.open);
  const setOpen = useImageSettings((s) => s.setOpen);
  const enabled = useSettings((s) => s.imageUploadEnabled);
  const command = useSettings((s) => s.imageUploadCommand);
  const setImageUpload = useSettings((s) => s.setImageUpload);

  const [draftCommand, setDraftCommand] = useState(command);

  if (!embedded && !open) return null;

  const close = () => {
    setDraftCommand(command);
    setOpen(false);
  };

  return (
    <div className={embedded ? undefined : "img-settings-mask"} onClick={embedded ? undefined : close}>
      <div className={embedded ? "settings-embedded" : "img-settings"} onClick={(e) => e.stopPropagation()}>
        {!embedded && <header className="img-settings-head">
          <h3>图片上传设置</h3>
          <button className="ai-icon-btn" title="关闭" onClick={close}>
            ✕
          </button>
        </header>}

        <label className="img-settings-row">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setImageUpload({ enabled: e.target.checked })}
          />
          <span>粘贴/插入图片时使用 upgit 上传</span>
        </label>

        <div className="img-settings-field">
          <div className="img-settings-label">上传命令</div>
          <input
            value={draftCommand}
            spellCheck={false}
            disabled={!enabled}
            placeholder={DEFAULT_UPLOAD_COMMAND}
            onChange={(e) => {
              setDraftCommand(e.target.value);
              setImageUpload({ command: e.target.value });
            }}
          />
          <p className="img-settings-hint">
            与 Typora 习惯一致：图片会先写入临时文件，临时路径作为最后一个参数追加到命令后执行；
            命令 stdout 中的第一个 http(s) 链接将作为图片地址。
          </p>
          <p className="img-settings-hint">
            未启用或上传失败时，图片自动保存到当前板块的 images/
            目录（文章内使用相对路径）。
          </p>
        </div>
      </div>
    </div>
  );
}
