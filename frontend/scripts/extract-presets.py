# 从 cc-switch 预设文件全量提取供应商：名称 / Base URL / 协议 / 默认模型 / 分类
import json
import re
from pathlib import Path

SRC = Path(r"E:\AI\cc-switch\src\config")

FILES = {
    "claudeProviderPresets.ts": "claude",
    "claudeDesktopProviderPresets.ts": "claude",
    "codexProviderPresets.ts": "codex",
    "geminiProviderPresets.ts": "gemini",
    "grokBuildProviderPresets.ts": "codex",
    "hermesProviderPresets.ts": "hermes",
    "mcodeProviderPresets.ts": "agent",
    "openclawProviderPresets.ts": "agent",
    "opencodeProviderPresets.ts": "agent",
    "piProviderPresets.ts": "agent",
    "universalProviderPresets.ts": "universal",
}

URL_KEYS = ["ANTHROPIC_BASE_URL", "baseURL", "base_url", "baseUrl"]

API_MAP = {
    "openai_chat": "openai",
    "openai_responses": "responses",
    "gemini_native": "gemini",
    "anthropic": "anthropic",
}
AGENT_API_MAP = {
    "openai-completions": "openai",
    "openai-responses": "responses",
    "anthropic-messages": "anthropic",
    "google-generative-ai": "gemini",
    "gemini": "gemini",
}


def extract_chunk(chunk: str, kind: str):
    m = re.search(r'^\s*name:\s*"([^"]+)"', chunk, re.M)
    if not m:
        return None
    name = m.group(1).strip()
    if "requiresOAuth: true" in chunk or "requiresOAuth: true," in chunk:
        return None

    url = None
    for key in URL_KEYS:
        m = re.search(
            re.escape(key) + r'\\?"?\s*[:=]\s*\\?"(https?://[^"\\\s]+)', chunk
        )
        if m:
            url = m.group(1).rstrip("/")
            break
    if not url:
        # endpointCandidates 兜底
        m = re.search(
            r"endpointCandidates:\s*\[[^\]]*?(https?://[^\"'\s,\]]+)", chunk
        )
        if m:
            url = m.group(1).rstrip("/")

    fmt = None
    m = re.search(r'apiFormat:\s*"([a-z_]+)"', chunk)
    if m and m.group(1) in API_MAP:
        fmt = API_MAP[m.group(1)]
    if not fmt:
        m = re.search(r'wire_api\s*=\s*"([a-z]+)"', chunk)
        if m:
            fmt = {"chat": "openai", "responses": "responses"}.get(m.group(1))
    if not fmt:
        m = re.search(r'\bapi:\s*"([a-z-]+)"', chunk)
        if m and m.group(1) in AGENT_API_MAP:
            fmt = AGENT_API_MAP[m.group(1)]
    if not fmt:
        fmt = {
            "claude": "anthropic",
            "codex": "responses",
            "gemini": "gemini",
            "hermes": "openai",
            "agent": "openai",
            "universal": "openai",
        }[kind]

    # 模型 id 按协议提取：anthropic 优先 ANTHROPIC_MODEL（cc-switch 的权威写法）；
    # 其余协议依次 model: / model = / models[].id（原始 id，避免带命名空间前缀的 primary）
    model = None
    if fmt == "anthropic":
        m = re.search(r'ANTHROPIC_MODEL["\']?\s*:\s*"([^"]+)"', chunk)
        if m:
            model = m.group(1).strip()
    if not model:
        for pat in [
            r'^\s*model:\s*"([^"]+)"',
            r'model\s*=\s*"([^"]+)"',
            r"^\s*id:\s*\"([A-Za-z][^\"\s]+)\"",
            r'primary:\s*"([^"]+)"',
        ]:
            mm = re.search(pat, chunk, re.M)
            if mm:
                model = mm.group(1).strip()
                break

    m = re.search(r'^\s*category:\s*"([a-z_]+)"', chunk, re.M)
    cat = m.group(1) if m else "other"

    return {"name": name, "url": url, "format": fmt, "model": model, "category": cat}


records = []
for fname, kind in FILES.items():
    text = (SRC / fname).read_text(encoding="utf-8")
    lines = text.split("\n")
    starts = [i for i, ln in enumerate(lines) if ln.strip() == "{" and ln.startswith("  {")]
    for idx, start in enumerate(starts):
        end = starts[idx + 1] if idx + 1 < len(starts) else len(lines)
        chunk = "\n".join(lines[start:end])
        rec = extract_chunk(chunk, kind)
        if rec:
            records.append(rec)

# 清洗：无 URL 的去掉
records = [r for r in records if r["url"]]

# 去重：同 (url, format) 保留最先出现；再按 (name, format) 去重
seen, deduped = set(), []
for r in records:
    k1 = (r["url"].lower(), r["format"])
    if k1 in seen:
        continue
    seen.add(k1)
    deduped.append(r)
seen2, final = set(), []
for r in deduped:
    k2 = (r["name"], r["format"])
    if k2 in seen2:
        continue
    seen2.add(k2)
    final.append(r)

out = Path(r"E:\AI\Learning\frontend\scripts\preset-dump.json")
out.write_text(json.dumps(final, ensure_ascii=False, indent=1), encoding="utf-8")

from collections import Counter

print("total raw:", len(records), "| final:", len(final))
print("by format:", Counter(r["format"] for r in final))
print("by category:", Counter(r["category"] for r in final))
print("no model:", sum(1 for r in final if not r["model"]))
print("\nsample:")
for r in final[:12]:
    print(" ", r)
