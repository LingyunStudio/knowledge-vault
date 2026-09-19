import { useState } from "react";
import {
  AI_FORMAT_LABELS,
  AI_PRESETS,
  PRESET_CATEGORIES,
  type AiFormat,
  type AiPreset,
  type AiProvider,
} from "../../lib/ai-presets";
import { listModels } from "../../lib/ai-client";
import { useAi } from "../../store/ai";

/** AI 模型设置弹窗：选择问 AI 使用的模型，管理自定义供应商。 */
export function AiSettings({ embedded = false }: { embedded?: boolean }) {
  const open = useAi((s) => s.settingsOpen);
  const providers = useAi((s) => s.providers);
  const activeId = useAi((s) => s.activeId);
  const setActive = useAi((s) => s.setActive);
  const addProvider = useAi((s) => s.addProvider);
  const updateProvider = useAi((s) => s.updateProvider);
  const removeProvider = useAi((s) => s.removeProvider);
  const setSettingsOpen = useAi((s) => s.setSettingsOpen);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [presetQuery, setPresetQuery] = useState("");

  if (!embedded && !open) return null;

  const close = () => {
    setEditingId(null);
    setConfirmDelete(null);
    setBrowseOpen(false);
    setSettingsOpen(false);
  };

  const addFromPreset = (name: string) => {
    const preset = AI_PRESETS.find((p) => p.name === name);
    if (!preset) return;
    // 默认协议优先级：openai > anthropic > responses > gemini
    const prefer: AiFormat[] = ["openai", "anthropic", "responses", "gemini"];
    const format =
      prefer.find((f) => preset.urls[f]) ?? "openai";
    const id = addProvider({
      name: preset.name,
      baseUrl: preset.urls[format] ?? "",
      format,
      model: preset.models?.[format] ?? "",
      apiKey: "",
      preset: preset.name,
    });
    setActive(id);
    setEditingId(id);
    setBrowseOpen(false);
  };

  const addCustom = () => {
    const id = addProvider({
      name: "自定义模型",
      baseUrl: "",
      format: "openai",
      model: "",
      apiKey: "",
    });
    setActive(id);
    setEditingId(id);
  };

  // 已添加过的供应商不再出现在预设列表（按预设名 / 供应商名）
  const addedNames = new Set(providers.map((p) => p.preset ?? p.name));
  const availablePresets = AI_PRESETS.filter((p) => !addedNames.has(p.name));

  const q = presetQuery.trim().toLowerCase();
  const presetMatches = (p: AiPreset) =>
    !q ||
    p.name.toLowerCase().includes(q) ||
    Object.values(p.urls).some((u) => u.toLowerCase().includes(q));
  const presetMatchCount = availablePresets.filter(presetMatches).length;

  return (
    <div className={embedded ? undefined : "ai-settings-mask"} onClick={embedded ? undefined : close}>
      <div
        className={embedded ? "settings-embedded" : "ai-settings"}
        role={embedded ? undefined : "dialog"}
        aria-label={embedded ? undefined : "AI 模型设置"}
        onClick={(e) => e.stopPropagation()}
      >
        {!embedded && <header className="ai-settings-head">
          <span>AI 模型设置</span>
          <button className="ai-icon-btn" title="关闭" onClick={close}>
            ✕
          </button>
        </header>}

        <p className="ai-settings-hint">
          默认不添加任何模型，全部由你手动添加：可从下方预设列表选择供应商，或自定义接口（支持
          OpenAI / Responses / Anthropic / Gemini 四种格式）。API Key 存入系统凭据管理器加密保存，
          不写入浏览器存储，仅本机当前用户可读。
        </p>

        {providers.length === 0 && (
          <p className="ai-settings-hint">
            还没有可用的模型：点击下方「从预设添加…」或「+ 自定义」添加第一个模型后即可使用「问 AI」。
          </p>
        )}

        <ul className="ai-prov-list">
          {providers.map((p) => (
            <ProviderRow
              key={p.id}
              provider={p}
              active={p.id === activeId}
              editing={editingId === p.id}
              confirmingDelete={confirmDelete === p.id}
              onActivate={() => setActive(p.id)}
              onEdit={() => setEditingId(editingId === p.id ? null : p.id)}
              onDelete={() => {
                if (confirmDelete === p.id) {
                  removeProvider(p.id);
                  setConfirmDelete(null);
                } else {
                  setConfirmDelete(p.id);
                }
              }}
              onCancelDelete={() => setConfirmDelete(null)}
              onUpdate={(patch) => updateProvider(p.id, patch)}
            />
          ))}
        </ul>

        <div className="ai-prov-add">
          <button
            onClick={() => {
              setBrowseOpen((v) => !v);
              setPresetQuery("");
            }}
          >
            {browseOpen ? "收起预设列表 ↑" : "从预设添加…"}
          </button>
          <button onClick={addCustom}>+ 自定义</button>
        </div>

        {browseOpen && (
          <div className="ai-preset-browse">
            <input
              className="ai-preset-search"
              value={presetQuery}
              placeholder={`搜索 ${availablePresets.length} 家供应商（名称 / 地址）…`}
              spellCheck={false}
              onChange={(e) => setPresetQuery(e.target.value)}
            />
            {PRESET_CATEGORIES.map(([cat, label]) => {
              const group = availablePresets.filter(
                (p) => p.cat === cat && presetMatches(p),
              );
              if (group.length === 0) return null;
              return (
                <div key={cat} className="ai-preset-group">
                  <div className="ai-preset-group-title">{label}</div>
                  {group.map((p) => {
                    const hintModel =
                      p.models?.openai ??
                      p.models?.anthropic ??
                      Object.values(p.models ?? {})[0];
                    return (
                      <button
                        key={p.name}
                        type="button"
                        className="ai-preset-row"
                        onClick={() => addFromPreset(p.name)}
                      >
                        <span className="ai-preset-name">{p.name}</span>
                        <span className="ai-preset-meta">
                          {hintModel ? `${hintModel} · ` : ""}
                          {(Object.keys(p.urls) as AiFormat[])
                            .map((f) => AI_FORMAT_LABELS[f])
                            .join(" / ")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {presetMatchCount === 0 && (
              <div className="ai-picker-empty">没有匹配的供应商</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProviderRow({
  provider: p,
  active,
  editing,
  confirmingDelete,
  onActivate,
  onEdit,
  onDelete,
  onCancelDelete,
  onUpdate,
}: {
  provider: AiProvider;
  active: boolean;
  editing: boolean;
  confirmingDelete: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  onUpdate: (patch: Partial<Omit<AiProvider, "id">>) => void;
}) {
  const [models, setModels] = useState<string[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const setApiKey = useAi((s) => s.setApiKey);

  // 该供应商对应的预设（按 preset 标记，其次按名称匹配）
  const sourcePreset =
    AI_PRESETS.find((x) => x.name === (p.preset ?? p.name)) ?? null;

  const onFormatChange = (fmt: AiFormat) => {
    // 来自预设且 Base URL / 模型未手改时，切换协议自动换成该协议对应的地址与模型
    if (sourcePreset) {
      const prevUrl = sourcePreset.urls[p.format];
      const nextUrl = sourcePreset.urls[fmt];
      if (nextUrl && (!p.baseUrl || p.baseUrl === prevUrl)) {
        const prevModel = sourcePreset.models?.[p.format];
        const nextModel = sourcePreset.models?.[fmt];
        const patch: Partial<AiProvider> = { format: fmt, baseUrl: nextUrl };
        if (nextModel && (!p.model || p.model === prevModel)) {
          patch.model = nextModel;
        }
        onUpdate(patch);
        return;
      }
    }
    onUpdate({ format: fmt });
  };

  const fetchModels = async () => {
    setLoadingModels(true);
    setModelsError(null);
    try {
      const list = await listModels(p.baseUrl, p.apiKey, p.format);
      setModels(list);
    } catch (e) {
      setModelsError(String(e));
    } finally {
      setLoadingModels(false);
    }
  };

  return (
    <li className={`ai-prov${active ? " active" : ""}`}>
      <div className="ai-prov-row">
        <label className="ai-prov-pick" title="设为问 AI 当前使用的模型">
          <input type="radio" checked={active} onChange={onActivate} />
          <span className="ai-prov-name">{p.name}</span>
          <span className="ai-prov-model">{p.model}</span>
        </label>
        <span className="ai-prov-format">{AI_FORMAT_LABELS[p.format]}</span>
        <button className="ai-icon-btn" title="编辑" onClick={onEdit}>
          ✎
        </button>
        <button
          className="ai-icon-btn danger"
          title={confirmingDelete ? "再点一次确认删除" : "删除"}
          onClick={onDelete}
          onMouseLeave={onCancelDelete}
        >
          {confirmingDelete ? "确认？" : "🗑"}
        </button>
      </div>

      {editing && (
        <div className="ai-prov-edit">
          <label>
            <span>名称</span>
            <input
              value={p.name}
              spellCheck={false}
              onChange={(e) => onUpdate({ name: e.target.value })}
            />
          </label>
          <label>
            <span>Base URL</span>
            <input
              value={p.baseUrl}
              placeholder="https://api.example.com/v1"
              spellCheck={false}
              onChange={(e) => onUpdate({ baseUrl: e.target.value })}
            />
          </label>
          <label>
            <span>API 格式</span>
            <select
              value={p.format}
              onChange={(e) => onFormatChange(e.target.value as AiFormat)}
            >
              <option value="openai">OpenAI 兼容（/chat/completions）</option>
              <option value="responses">OpenAI Responses（/responses）</option>
              <option value="anthropic">Anthropic 兼容（/v1/messages）</option>
              <option value="gemini">Gemini 原生（streamGenerateContent）</option>
            </select>
          </label>
          <div className="ai-prov-modelrow">
            <span>模型</span>
            <div className="ai-prov-modelctl">
              <input
                value={p.model}
                placeholder="例如 deepseek-chat"
                spellCheck={false}
                onChange={(e) => onUpdate({ model: e.target.value })}
              />
              <button
                type="button"
                className="ai-fetch"
                title="从供应商拉取模型列表"
                disabled={loadingModels || !p.baseUrl}
                onClick={() => void fetchModels()}
              >
                {loadingModels ? "获取中…" : "获取列表"}
              </button>
            </div>
          </div>
          {models && models.length > 0 && (
            <div className="ai-prov-modelrow">
              <span />
              <select
                className="ai-model-pick"
                title="从已获取的模型列表中选择"
                value={models.includes(p.model) ? p.model : ""}
                onChange={(e) => {
                  if (e.target.value) onUpdate({ model: e.target.value });
                }}
              >
                {!models.includes(p.model) && (
                  <option value="">
                    从 {models.length} 个模型中选择…
                  </option>
                )}
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}
          {modelsError && <p className="ai-prov-err">{modelsError}</p>}
          {models && !modelsError && (
            <p className="ai-prov-tip">
              已获取 {models.length} 个模型，可从上方列表选择或直接输入。
            </p>
          )}
          <label>
            <span>API Key</span>
            <input
              type="password"
              value={p.apiKey}
              placeholder="sk-…"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setApiKey(p.id, e.target.value)}
            />
          </label>
          <p className="ai-prov-tip">
            切换 API 格式时，来自预设的供应商会自动换成对应协议的 Base URL（手改过的地址不会被覆盖）。
            OpenAI 兼容补 /chat/completions、Responses 补 /responses、Anthropic
            兼容补 /v1/messages、Gemini 补 /models/模型名:streamGenerateContent。
          </p>
        </div>
      )}
    </li>
  );
}
