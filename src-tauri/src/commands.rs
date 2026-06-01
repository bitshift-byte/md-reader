use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Represents a file system entry for the tree view.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub id: String,
    pub name: String,
    pub entry_type: String, // "file" or "folder"
    pub path: String,
    pub children: Option<Vec<FileEntry>>,
}

/// Read a directory and return its contents as a tree structure.
/// Supports recursive reading up to `depth` levels.
#[tauri::command]
pub fn read_directory(path: String, depth: Option<u32>) -> Result<Vec<FileEntry>, String> {
    let max_depth = depth.unwrap_or(3);
    read_dir_recursive(&PathBuf::from(&path), max_depth, 0)
        .map_err(|e| format!("Failed to read directory: {}", e))
}

fn read_dir_recursive(
    dir: &Path,
    max_depth: u32,
    current_depth: u32,
) -> Result<Vec<FileEntry>, std::io::Error> {
    let mut entries = Vec::new();

    if current_depth >= max_depth {
        return Ok(entries);
    }

    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry
            .file_name()
            .to_string_lossy()
            .to_string();

        // Skip hidden files and directories
        if name.starts_with('.') {
            continue;
        }

        let id = path.to_string_lossy().to_string();

        if path.is_dir() {
            let children = read_dir_recursive(&path, max_depth, current_depth + 1)?;
            entries.push(FileEntry {
                id: id.clone(),
                name,
                entry_type: "folder".to_string(),
                path: id,
                children: Some(children),
            });
        } else if name.ends_with(".md") || name.ends_with(".markdown") {
            entries.push(FileEntry {
                id: id.clone(),
                name,
                entry_type: "file".to_string(),
                path: id,
                children: None,
            });
        }
    }

    // Sort: folders first, then files alphabetically
    entries.sort_by(|a, b| {
        match (&a.entry_type, &b.entry_type) {
            ("folder", "file") => std::cmp::Ordering::Less,
            ("file", "folder") => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

/// Read the contents of a single file.
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

/// Save content to a file, creating parent directories if needed.
#[tauri::command]
pub fn save_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories: {}", e))?;
    }
    fs::write(&path, content).map_err(|e| format!("Failed to save file: {}", e))
}

/// Return basic app info for the status bar.
#[tauri::command]
pub fn get_app_info() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "name": "Inkwell MD",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}
