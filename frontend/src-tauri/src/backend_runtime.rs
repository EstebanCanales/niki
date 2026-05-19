use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};

pub struct BackendProcessState(pub Mutex<Option<Child>>);

fn backend_port_is_open() -> bool {
  TcpStream::connect_timeout(
    &"127.0.0.1:8000".parse().expect("valid socket address"),
    Duration::from_millis(250),
  )
  .is_ok()
}

fn candidate_roots() -> Vec<PathBuf> {
  let mut roots = Vec::new();
  if let Ok(cwd) = std::env::current_dir() {
    roots.push(cwd);
  }
  roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")));
  if let Ok(exe) = std::env::current_exe() {
    if let Some(parent) = exe.parent() {
      roots.push(parent.to_path_buf());
    }
  }
  roots
}

fn find_backend_dir() -> Option<PathBuf> {
  for root in candidate_roots() {
    for ancestor in root.ancestors() {
      let direct = ancestor.join("backend");
      if direct.join("package.json").exists() {
        return Some(direct);
      }
      let sibling = ancestor.join("../backend");
      if sibling.join("package.json").exists() {
        return sibling.canonicalize().ok().or(Some(sibling));
      }
    }
  }
  None
}

fn spawn_backend_process(backend_dir: &Path) -> Result<Child, String> {
  let script = if cfg!(debug_assertions) { "dev" } else { "start" };
  Command::new("npm")
    .args(["run", script])
    .current_dir(backend_dir)
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .map_err(|err| format!("failed to spawn backend: {err}"))
}

pub fn ensure_backend_runtime(app: &AppHandle) -> Result<(), String> {
  app.manage(BackendProcessState(Mutex::new(None)));

  if backend_port_is_open() {
    return Ok(());
  }

  let Some(backend_dir) = find_backend_dir() else {
    return Ok(());
  };

  let child = spawn_backend_process(&backend_dir)?;
  if let Some(state) = app.try_state::<BackendProcessState>() {
    let mut guard = state
      .0
      .lock()
      .map_err(|_| "backend process mutex poisoned".to_string())?;
    *guard = Some(child);
  }

  Ok(())
}

pub fn shutdown_backend_runtime(app: &AppHandle) {
  let Some(state) = app.try_state::<BackendProcessState>() else {
    return;
  };
  let Ok(mut guard) = state.0.lock() else {
    return;
  };
  if let Some(mut child) = guard.take() {
    let _ = child.kill();
    let _ = child.wait();
  }
}
