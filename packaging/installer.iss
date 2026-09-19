; 韫玉 · Inno Setup 安装包脚本（全中文）
; 由仓库根目录的 package.ps1 调用：ISCC.exe installer.iss /DAppVersion=<版本号>
; 产物：packaging\dist\韫玉-<版本号>-x64-setup.exe
;
; 安装内容：
;   1. 主程序 韫玉.exe（tauri build 发布版，targets=none 不再生成 NSIS 包）
;   2. 内置默认知识库 knowledge\（用户安装后即可使用；卸载时保留，防止误删已积累的内容）
;
; 首次运行定位逻辑（src-tauri\src\root.rs）：
;   - 安装到可写目录（如 D:\Apps）：直接使用 {app}\knowledge；
;   - 安装到 Program Files（只读）：自动拷贝到用户应用数据目录后使用。

#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif

#define MyAppName "韫玉"
#define MyAppExeName "韫玉.exe"

[Setup]
AppId={{7C1E4F5A-9B3D-4E8A-A6C2-1D9F0B8E5A31}
AppName={#MyAppName}
AppVersion={#AppVersion}
AppVerName={#MyAppName} {#AppVersion}
DefaultDirName={autopf}\Yunyu
DefaultGroupName={#MyAppName}
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupIconFile=..\src-tauri\icons\icon.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
OutputDir=dist
OutputBaseFilename=韫玉-{#AppVersion}-x64-setup
ArchitecturesInstallIn64BitMode=x64compatible
; 支持命令行 /CURRENTUSER 免管理员安装（默认仍为管理员安装到 Program Files）
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=commandline

[Languages]
Name: "chs"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式(&D)"; GroupDescription: "附加任务："

[Files]
; 主程序
Source: "..\src-tauri\target\release\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
; 内置默认知识库（含 .kv 历史与回收站结构）；uninsneveruninstall = 卸载时保留用户数据
Source: "..\knowledge\*"; DestDir: "{app}\knowledge"; Flags: ignoreversion recursesubdirs createallsubdirs uninsneveruninstall

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
; 静默安装（自动更新）与交互式安装结束时均会自动打开应用
Filename: "{app}\{#MyAppExeName}"; Description: "立即运行 {#MyAppName}"; Flags: nowait postinstall

[Code]
const
  WebView2RegKey = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2RegKey32 = 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function IsWebView2Installed: Boolean;
begin
  Result :=
    RegKeyExists(HKLM, WebView2RegKey) or
    RegKeyExists(HKLM, WebView2RegKey32) or
    RegKeyExists(HKCU, WebView2RegKey);
end;

function InitializeSetup: Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
  if not IsWebView2Installed then
    if MsgBox('本应用需要 Microsoft WebView2 运行时，您的系统尚未安装。' + #13#10 +
              '是否现在打开微软官方下载页面？安装运行时后请重新运行本安装程序。',
              mbConfirmation, MB_YESNO) = IDYES then
      ShellExec('', 'https://go.microsoft.com/fwlink/p/?LinkId=2124703',
        '', '', SW_SHOWNORMAL, ewNoWait, ResultCode);
end;
