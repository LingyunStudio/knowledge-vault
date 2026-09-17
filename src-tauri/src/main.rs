// 防止 Windows release 下弹出控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    knowledge_vault_lib::run();
}
