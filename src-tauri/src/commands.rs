//! Tauri 命令：所有磁盘 IO 经此暴露，前端不直接碰 fs。

use tauri::State;

use crate::library::{self, ArticleFileDto, CoverUpload, LibraryDto, LogoDto};
use crate::root::RootInfo;
use crate::AppState;
use std::path::PathBuf;

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
}

#[tauri::command]
pub fn write_article(
    state: State<AppState>,
    rel: String,
    content: String,
    expected_mtime_ms: Option<u64>,
) -> Result<WriteOk, library::WriteError> {
    let root = root_path(&state);
    let mtime_ms = library::write_article(&root, &rel, &content, expected_mtime_ms)?;
    Ok(WriteOk { mtime_ms })
}

#[tauri::command]
pub fn read_logo(state: State<AppState>, section: String) -> Option<LogoDto> {
    let root = root_path(&state);
    library::read_logo(&root, &section)
}

#[tauri::command]
pub fn delete_article(state: State<AppState>, rel: String) -> Result<(), String> {
    library::delete_article(&root_path(&state), &rel)
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

fn root_path(state: &State<AppState>) -> PathBuf {
    state.root.lock().unwrap().clone()
}
