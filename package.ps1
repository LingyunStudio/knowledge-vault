# 韫玉 · 一键打包安装包（Inno Setup，全中文）
#
# 用法：
#   .\package.ps1            完整流程：编译前端 + Rust 发布版 → 生成安装包
#   .\package.ps1 -SkipBuild 跳过编译，用现有 target\release 产物重新生成安装包
#
# 依赖：
#   - Node/pnpm（frontend 依赖已安装）、Rust 工具链
#   - Inno Setup 6（D:\InnoSetup6\ISCC.exe，含 Languages\ChineseSimplified.isl）
#
# 产物：packaging\dist\韫玉-<版本>-x64-setup.exe（内置默认知识库）

param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Root     = $PSScriptRoot
$Iscc     = "D:\InnoSetup6\ISCC.exe"
$TauriCli = Join-Path $Root "frontend\node_modules\.bin\tauri.cmd"

Write-Host "== 韫玉 · 打包安装包 ==" -ForegroundColor Cyan

# —— 环境检查 ——
if (-not (Test-Path $Iscc))     { throw "未找到 Inno Setup：$Iscc" }
if (-not (Test-Path $TauriCli)) { throw "未找到 Tauri CLI，请先在 frontend 目录执行 pnpm install" }

# —— 1. 编译：前端 dist + Rust 发布版（bundle.targets=none，安装包由 Inno Setup 负责） ——
if (-not $SkipBuild) {
  Write-Host "[1/2] tauri build（前端 + 发布版编译）..." -ForegroundColor Yellow
  Push-Location $Root
  try {
    & $TauriCli build
    if ($LASTEXITCODE -ne 0) { throw "tauri build 失败" }
  }
  finally { Pop-Location }
}
else {
  Write-Host "[1/2] 跳过编译（-SkipBuild）" -ForegroundColor DarkGray
}

# —— 2. Inno Setup 生成安装包（版本号取自 tauri.conf.json） ——
Write-Host "[2/2] Inno Setup 生成安装包..." -ForegroundColor Yellow
$Version  = (Get-Content (Join-Path $Root "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json).version
$Exe      = Join-Path $Root "src-tauri\target\release\韫玉.exe"
if (-not (Test-Path $Exe)) { throw "未找到主程序：$Exe（完整打包请不带 -SkipBuild）" }

& $Iscc "/DAppVersion=$Version" (Join-Path $Root "packaging\installer.iss")
if ($LASTEXITCODE -ne 0) { throw "Inno Setup 打包失败" }

$Installer = Join-Path $Root "packaging\dist\韫玉-$Version-x64-setup.exe"
if (-not (Test-Path $Installer)) { throw "未找到安装包输出：$Installer" }
Write-Host "安装包已生成：$Installer" -ForegroundColor Green
