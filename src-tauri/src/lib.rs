use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State};

/// The vault is a plain folder of markdown files. All frontend file access goes
/// through these commands and is confined to that folder.
struct Vault {
    root: Mutex<PathBuf>,
    watcher: Mutex<Option<RecommendedWatcher>>,
}

#[derive(Serialize, Deserialize, Default)]
struct Config_ {
    vault: Option<String>,
}

fn config_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

fn default_vault(app: &AppHandle) -> Result<PathBuf, String> {
    let docs = app.path().document_dir().map_err(|e| e.to_string())?;
    Ok(docs.join("hub-vault"))
}

/// Resolve `rel` inside the vault, refusing absolute paths and `..`.
fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    for c in p.components() {
        match c {
            Component::Normal(_) => {}
            _ => return Err(format!("path not allowed: {rel}")),
        }
    }
    Ok(root.join(p))
}

fn root_of(state: &State<Vault>) -> PathBuf {
    state.root.lock().unwrap().clone()
}

fn start_watcher(app: &AppHandle, state: &Vault, root: &Path) -> Result<(), String> {
    let handle = app.clone();
    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<notify::Event>| {
            if let Ok(ev) = res {
                let relevant = ev.paths.iter().any(|p| {
                    let s = p.to_string_lossy();
                    s.ends_with(".md") && !s.contains(".hub")
                });
                if relevant {
                    let _ = handle.emit("vault-changed", ());
                }
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;
    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    *state.watcher.lock().unwrap() = Some(watcher);
    Ok(())
}

#[tauri::command]
fn vault_path(state: State<Vault>) -> String {
    root_of(&state).to_string_lossy().into_owned()
}

#[tauri::command]
fn set_vault_path(app: AppHandle, state: State<Vault>, path: String) -> Result<String, String> {
    let root = PathBuf::from(path.trim());
    if !root.is_absolute() {
        return Err("vault path must be absolute".into());
    }
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    *state.root.lock().unwrap() = root.clone();
    start_watcher(&app, &state, &root)?;
    let cfg = Config_ {
        vault: Some(root.to_string_lossy().into_owned()),
    };
    fs::write(
        config_file(&app)?,
        serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(root.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_file(state: State<Vault>, rel: String) -> Result<Option<String>, String> {
    let p = safe_join(&root_of(&state), &rel)?;
    match fs::read_to_string(&p) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn write_file(state: State<Vault>, rel: String, content: String) -> Result<(), String> {
    let p = safe_join(&root_of(&state), &rel)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Write-then-rename so an agent never reads a half-written file.
    let tmp = p.with_extension("tmp-hub");
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_file(state: State<Vault>, rel: String) -> Result<(), String> {
    let p = safe_join(&root_of(&state), &rel)?;
    match fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn list_dir(state: State<Vault>, rel: String) -> Result<Vec<String>, String> {
    let root = root_of(&state);
    let dir = if rel.is_empty() { root } else { safe_join(&root, &rel)? };
    let rd = match fs::read_dir(&dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.to_string()),
    };
    let mut names: Vec<String> = rd
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| n.ends_with(".md"))
        .collect();
    names.sort();
    Ok(names)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Vault {
            root: Mutex::new(PathBuf::new()),
            watcher: Mutex::new(None),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let configured = config_file(&handle)
                .ok()
                .and_then(|f| fs::read_to_string(f).ok())
                .and_then(|s| serde_json::from_str::<Config_>(&s).ok())
                .and_then(|c| c.vault)
                .map(PathBuf::from);
            let root = match configured {
                Some(p) => p,
                None => default_vault(&handle)?,
            };
            fs::create_dir_all(&root)?;
            let state = app.state::<Vault>();
            *state.root.lock().unwrap() = root.clone();
            if let Err(e) = start_watcher(&handle, &state, &root) {
                eprintln!("vault watcher failed: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault_path,
            set_vault_path,
            read_file,
            write_file,
            delete_file,
            list_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
