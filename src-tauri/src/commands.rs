//! Tauri 命令：所有磁盘 IO 经此暴露，前端不直接碰 fs。
//! 全部写操作经 AppState.library_io 串行化，避免并发写与只读命令交错。

use tauri::State;

use crate::library::{self, ArticleFileDto, CoverUpload, LibraryDto, LogoDto, SectionUpdate};
use crate::root::RootInfo;
use crate::vault::{self, HistoryContentDto, HistoryEntryDto, MetadataUpdate, TrashEntryDto};
use crate::AppState;
use std::path::PathBuf;
use std::sync::MutexGuard;

#[tauri::command]
pub fn library_root(state: State<AppState>) -> RootInfo {
    state.root_info.lock().unwrap().clone()
}

#[tauri::command]
pub fn scan_library(state: State<AppState>) -> Result<LibraryDto, String> {
    let root = root_path(&state);
    Ok(library::scan(&root))
}

#[tauri::command]
pub fn read_article(
    state: State<AppState>,
    rel: String,
) -> Result<ArticleFileDto, String> {
    let root = root_path(&state);
    library::read_article(&root, &rel)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteOk {
    pub mtime_ms: u64,
    pub revision: String,
}

/// 持久化保存：留档旧版本后原子替换；冲突时返回磁盘版。
#[tauri::command]
pub fn write_article(
    state: State<AppState>,
    rel: String,
    content: String,
    expected_mtime_ms: Option<u64>,
    expected_revision: Option<String>,
) -> Result<WriteOk, library::WriteError> {
    let root = root_path(&state);
    let _io = io_lock(&state);
    let article = vault::save(&root, &rel, &content, expected_revision.as_deref(), expected_mtime_ms, "auto")?;
    Ok(WriteOk { mtime_ms: article.mtime_ms, revision: article.revision })
}

#[tauri::command]
pub fn read_logo(state: State<AppState>, section: String) -> Option<LogoDto> {
    let root = root_path(&state);
    library::read_logo(&root, &section)
}

/// 可恢复删除：内容进隐藏回收站，文件原子移除。返回回收站条目。
#[tauri::command]
pub fn delete_article(
    state: State<AppState>,
    rel: String,
    expected_revision: Option<String>,
) -> Result<TrashEntryDto, library::WriteError> {
    let root = root_path(&state);
    let _io = io_lock(&state);
    vault::delete_article(&root, &rel, expected_revision.as_deref())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedArticle {
    pub rel: String,
}

#[tauri::command]
pub fn create_article(
    state: State<AppState>,
    sec_id: String,
    title: String,
) -> Result<CreatedArticle, String> {
    let rel = library::create_article(&root_path(&state), &sec_id, &title)?;
    Ok(CreatedArticle { rel })
}

#[derive(serde::Serialize)]
pub struct CreatedSection {
    pub id: String,
}

#[tauri::command]
pub fn create_section(
    state: State<AppState>,
    name: String,
    desc: Option<String>,
    cover: Option<CoverUpload>,
) -> Result<CreatedSection, String> {
    let id = library::create_section(&root_path(&state), &name, desc.as_deref(), cover.as_ref())?;
    Ok(CreatedSection { id })
}

#[tauri::command]
pub fn read_cover(state: State<AppState>, section: String) -> Option<LogoDto> {
    let root = root_path(&state);
    library::read_cover(&root, &section)
}

/// 更新板块显示信息（名称/描述/封面），板块目录名不变。
#[tauri::command]
pub fn update_section(
    state: State<AppState>,
    section: String,
    update: SectionUpdate,
) -> Result<(), String> {
    let _io = io_lock(&state);
    library::update_section(&root_path(&state), &section, &update)
}

/// 按传入顺序持久化板块排序（写入各板块 _section.md 的 order 字段）。
#[tauri::command]
pub fn reorder_sections(state: State<AppState>, ids: Vec<String>) -> Result<(), String> {
    let _io = io_lock(&state);
    library::reorder_sections(&root_path(&state), &ids)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedImage {
    pub rel: String,
}

#[tauri::command]
pub fn save_paste_image(
    state: State<AppState>,
    sec_id: String,
    file_name: String,
    data_base64: String,
) -> Result<SavedImage, String> {
    let root = root_path(&state);
    let rel = library::save_paste_image(&root, &sec_id, &file_name, &data_base64)?;
    Ok(SavedImage { rel })
}

#[tauri::command]
pub fn run_upload_command(
    command: String,
    file_ext: String,
    data_base64: String,
) -> Result<UploadedImage, String> {
    let url = library::run_upload_cmd(&command, &file_ext, &data_base64)?;
    Ok(UploadedImage { url })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadedImage {
    pub url: String,
}

#[tauri::command]
pub fn read_image(state: State<AppState>, rel: String) -> Option<LogoDto> {
    let root = root_path(&state);
    library::read_image(&root, &rel)
}

// ---------- 回收站 ----------

#[tauri::command]
pub fn list_trash(state: State<AppState>) -> Result<Vec<TrashEntryDto>, String> {
    vault::list_trash(&root_path(&state))
}

/// 恢复回收站条目；目标路径存在时拒绝（绝不覆盖）。
#[tauri::command]
pub fn restore_trash(
    state: State<AppState>,
    id: String,
    target_rel: Option<String>,
) -> Result<ArticleFileDto, library::WriteError> {
    let root = root_path(&state);
    let _io = io_lock(&state);
    vault::restore_trash(&root, &id, target_rel.as_deref())
}

#[tauri::command]
pub fn purge_trash(state: State<AppState>, id: String) -> Result<(), String> {
    let root = root_path(&state);
    let _io = io_lock(&state);
    crate::kvstore::delete_entry(&root, true, &id)
}

// ---------- 历史 ----------

#[tauri::command]
pub fn list_article_history(
    state: State<AppState>,
    rel: String,
) -> Result<Vec<HistoryEntryDto>, String> {
    vault::list_article_history(&root_path(&state), &rel)
}

#[tauri::command]
pub fn read_article_history(
    state: State<AppState>,
    id: String,
) -> Result<HistoryContentDto, String> {
    vault::read_article_history(&root_path(&state), &id)
}

/// 恢复历史版本：expectedRevision 为活动文章当前修订号，"missing" 表示文章已删除、允许重建。
#[tauri::command]
pub fn restore_article_history(
    state: State<AppState>,
    id: String,
    expected_revision: String,
) -> Result<ArticleFileDto, library::WriteError> {
    let root = root_path(&state);
    let _io = io_lock(&state);
    vault::restore_article_history(&root, &id, &expected_revision)
}

// ---------- 元数据 / 移动 / 链接 ----------

/// 整体式元数据更新：必须传全部四个字段；旧版本自动留档。
#[tauri::command]
pub fn update_article_metadata(
    state: State<AppState>,
    rel: String,
    metadata: MetadataUpdate,
    expected_revision: String,
) -> Result<ArticleFileDto, library::WriteError> {
    let root = root_path(&state);
    let _io = io_lock(&state);
    vault::update_article_metadata(&root, &rel, &metadata, &expected_revision)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveOk {
    pub article: ArticleFileDto,
    pub updated_rels: Vec<String>,
}

/// 安全移动：拒绝无法安全改写的入链，保留源/目标两侧备份。
#[tauri::command]
pub fn move_article(
    state: State<AppState>,
    rel: String,
    target_rel: String,
    expected_revision: String,
) -> Result<MoveOk, library::WriteError> {
    let root = root_path(&state);
    let _io = io_lock(&state);
    let moved = vault::move_article(&root, &rel, &target_rel, &expected_revision)?;
    Ok(MoveOk { article: moved.article, updated_rels: moved.updated_rels })
}

/// 只读链接索引：全部文章的链接/图片引用及存在性；不修改任何文件。
#[tauri::command]
pub fn list_article_links(state: State<AppState>) -> Result<crate::links::LinkScanDto, String> {
    crate::links::list_article_links(&root_path(&state))
}

fn root_path(state: &State<AppState>) -> PathBuf {
    state.root.lock().unwrap().clone()
}

fn io_lock<'a>(state: &'a State<'_, AppState>) -> MutexGuard<'a, ()> {
    state.library_io.lock().unwrap()
}
