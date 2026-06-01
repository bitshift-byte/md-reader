use tauri::Manager;

mod commands;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_directory,
            commands::read_file,
            commands::save_file,
            commands::get_app_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Inkwell MD");
}
