#[cfg(target_os = "macos")]
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;
#[cfg(target_os = "macos")]
use std::fs::OpenOptions;
#[cfg(target_os = "macos")]
use std::io::Write;
#[cfg(target_os = "macos")]
use std::{fs, thread, time::{Duration, SystemTime, UNIX_EPOCH}};

#[cfg(target_os = "macos")]
const NIKI_NOTCH_ROOT: &str = "/Users/estebancanales/Work/agente/nikiNotch";
#[cfg(target_os = "macos")]
const NIKI_NOTCH_PROJECT: &str = "/Users/estebancanales/Work/agente/nikiNotch/boringNotch.xcodeproj";
#[cfg(target_os = "macos")]
const NIKI_NOTCH_DERIVED: &str = "/Users/estebancanales/Work/agente/nikiNotch/.derived";

#[cfg(target_os = "macos")]
fn notch_debug_log(message: &str) {
  println!("[niki-notch] {message}");
  if let Ok(home) = std::env::var("HOME") {
    let path = Path::new(&home).join(".niki/notch-debug.log");
    if let Some(parent) = path.parent() {
      let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
      let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
      let _ = writeln!(file, "{ts} [rust] {message}");
    }
  }
}

#[cfg(target_os = "macos")]
fn candidate_paths() -> Vec<PathBuf> {
  let mut paths = vec![
    PathBuf::from("/Users/estebancanales/Work/agente/nikiNotch/build/Debug/boringNotch.app"),
    PathBuf::from("/Users/estebancanales/Work/agente/nikiNotch/build/Release/boringNotch.app"),
    PathBuf::from("/Users/estebancanales/Work/agente/nikiNotch/.derived/Build/Products/Debug/boringNotch.app"),
    PathBuf::from("/Users/estebancanales/Work/agente/nikiNotch/.derived/Build/Products/Release/boringNotch.app"),
    PathBuf::from("/Applications/boringNotch.app"),
    PathBuf::from("/Applications/Boring Notch.app"),
  ];

  if let Ok(home) = std::env::var("HOME") {
    paths.push(Path::new(&home).join("Applications/boringNotch.app"));
    paths.push(Path::new(&home).join("Applications/Boring Notch.app"));
    paths.push(Path::new(&home).join("Downloads/boringNotch.app"));
    paths.push(Path::new(&home).join("Downloads/Boring Notch.app"));
  }

  paths.push(PathBuf::from("/tmp/boring.notch/build/Release/boringNotch.app"));
  paths.push(PathBuf::from("/tmp/boring.notch/build/Debug/boringNotch.app"));
  paths
}

#[cfg(target_os = "macos")]
fn open_app_bundle(path: &Path) -> Result<(), String> {
  notch_debug_log(&format!("opening app bundle {}", path.display()));
  let status = Command::new("open")
    .arg("-n")
    .arg(path)
    .status()
    .map_err(|err| format!("failed to run open for Niki Notch: {err}"))?;

  if status.success() {
    Ok(())
  } else {
    Err(format!("open exited with status {status}"))
  }
}

#[cfg(target_os = "macos")]
fn find_existing_bundle() -> Option<PathBuf> {
  candidate_paths().into_iter().find(|path| path.exists())
}

#[cfg(target_os = "macos")]
fn stop_running_niki_notch() {
  notch_debug_log("stopping existing notch process");
  let _ = Command::new("osascript")
    .args(["-e", "tell application \"boringNotch\" to quit"])
    .status();
  let _ = Command::new("pkill").args(["-f", "boringNotch"]).status();
  thread::sleep(Duration::from_millis(240));
}

#[cfg(target_os = "macos")]
fn notch_request_path() -> Result<PathBuf, String> {
  let home = std::env::var("HOME").map_err(|err| format!("missing HOME for Niki Notch request: {err}"))?;
  Ok(Path::new(&home).join(".niki/notch-request.json"))
}

#[cfg(target_os = "macos")]
fn notch_config_path() -> Result<PathBuf, String> {
  let home = std::env::var("HOME").map_err(|err| format!("missing HOME for Niki Notch config: {err}"))?;
  Ok(Path::new(&home).join(".niki/notch-config.json"))
}

#[cfg(target_os = "macos")]
fn notch_response_path() -> Result<PathBuf, String> {
  let home = std::env::var("HOME").map_err(|err| format!("missing HOME for Niki Notch response: {err}"))?;
  Ok(Path::new(&home).join(".niki/notch-response.json"))
}

#[cfg(target_os = "macos")]
fn build_local_niki_notch() -> Result<PathBuf, String> {
  if !Path::new(NIKI_NOTCH_PROJECT).exists() {
    return Err(format!("nikiNotch project not found at {NIKI_NOTCH_PROJECT}"));
  }

  notch_debug_log(&format!("building local notch project {NIKI_NOTCH_PROJECT}"));
  let output = Command::new("xcodebuild")
    .args([
      "-project",
      NIKI_NOTCH_PROJECT,
      "-scheme",
      "boringNotch",
      "-configuration",
      "Debug",
      "-derivedDataPath",
      NIKI_NOTCH_DERIVED,
      "-destination",
      "platform=macOS",
      "build",
    ])
    .current_dir(NIKI_NOTCH_ROOT)
    .output()
    .map_err(|err| format!("failed to run xcodebuild for Niki Notch: {err}"))?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let tail = format!("{stdout}\n{stderr}");
    let trimmed = tail.lines().rev().take(30).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
    return Err(format!("Niki Notch build failed:\n{trimmed}"));
  }

  let debug_bundle = Path::new(NIKI_NOTCH_DERIVED).join("Build/Products/Debug/boringNotch.app");
  let release_bundle = Path::new(NIKI_NOTCH_DERIVED).join("Build/Products/Release/boringNotch.app");
  let bundle = if debug_bundle.exists() {
    debug_bundle
  } else if release_bundle.exists() {
    release_bundle
  } else {
    return Err(format!(
      "Niki Notch build finished but boringNotch.app was not found under {NIKI_NOTCH_DERIVED}/Build/Products"
    ));
  };
  notch_debug_log(&format!("build resolved bundle {}", bundle.display()));
  Ok(bundle)
}

#[tauri::command]
pub fn launch_boring_notch() -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    stop_running_niki_notch();

    match build_local_niki_notch() {
      Ok(built_path) => return open_app_bundle(&built_path),
      Err(build_error) => {
        notch_debug_log(&format!("local build failed, trying existing bundle: {build_error}"));
      }
    }

    if let Some(path) = find_existing_bundle() {
      return open_app_bundle(&path);
    }

    return Err("Niki Notch bundle not found after build fallback.".to_string());
  }

  #[cfg(not(target_os = "macos"))]
  {
    Ok(())
  }
}

#[tauri::command]
pub fn close_boring_notch() -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    let status = Command::new("osascript")
      .args(["-e", "tell application \"boringNotch\" to quit"])
      .status()
      .map_err(|err| format!("failed to run osascript for Niki Notch: {err}"))?;

    if status.success() {
      return Ok(());
    }

    return Err(format!("osascript exited with status {status}"));
  }

  #[cfg(not(target_os = "macos"))]
  {
    Ok(())
  }
}

#[tauri::command]
pub fn push_notch_request(request: String) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    let path = notch_request_path()?;
    if let Some(parent) = path.parent() {
      fs::create_dir_all(parent)
        .map_err(|err| format!("failed to create Niki Notch request directory: {err}"))?;
    }

    fs::write(&path, request.trim())
      .map_err(|err| format!("failed to write Niki Notch request: {err}"))?;
    notch_debug_log(&format!(
      "push request path={} bytes={}",
      path.display(),
      request.trim().len()
    ));
    return Ok(());
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = request;
    Ok(())
  }
}

#[tauri::command]
pub fn consume_notch_request() -> Result<Option<String>, String> {
  #[cfg(target_os = "macos")]
  {
    let path = notch_request_path()?;
    if !path.exists() {
      return Ok(None);
    }

    let content = fs::read_to_string(&path)
      .map_err(|err| format!("failed to read Niki Notch request: {err}"))?;
    fs::remove_file(&path)
      .map_err(|err| format!("failed to clear Niki Notch request: {err}"))?;

    let trimmed = content.trim().to_string();
    notch_debug_log(&format!(
      "consume request path={} bytes={}",
      path.display(),
      trimmed.len()
    ));
    if trimmed.is_empty() {
      notch_debug_log("consume request ignored empty payload");
      return Ok(None);
    }

    return Ok(Some(trimmed));
  }

  #[cfg(not(target_os = "macos"))]
  {
    Ok(None)
  }
}

#[tauri::command]
pub fn sync_notch_config(base_url: String, api_key: String, user_id: String) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    let path = notch_config_path()?;
    if let Some(parent) = path.parent() {
      fs::create_dir_all(parent)
        .map_err(|err| format!("failed to create Niki Notch config directory: {err}"))?;
    }

    let payload = serde_json::json!({
      "baseUrl": base_url.trim(),
      "apiKey": api_key.trim(),
      "userId": user_id.trim(),
    });
    let serialized = serde_json::to_string_pretty(&payload)
      .map_err(|err| format!("failed to serialize Niki Notch config: {err}"))?;
    fs::write(&path, serialized)
      .map_err(|err| format!("failed to write Niki Notch config: {err}"))?;
    notch_debug_log(&format!(
      "sync config path={} baseUrl={} apiKeyChars={}",
      path.display(),
      base_url.trim(),
      api_key.trim().len()
    ));
    return Ok(());
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = (base_url, api_key, user_id);
    Ok(())
  }
}

#[tauri::command]
pub fn push_notch_response(response: String) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    let path = notch_response_path()?;
    if let Some(parent) = path.parent() {
      fs::create_dir_all(parent)
        .map_err(|err| format!("failed to create Niki Notch response directory: {err}"))?;
    }

    fs::write(&path, response.trim())
      .map_err(|err| format!("failed to write Niki Notch response: {err}"))?;
    notch_debug_log(&format!(
      "push response path={} bytes={}",
      path.display(),
      response.trim().len()
    ));
    return Ok(());
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = response;
    Ok(())
  }
}

#[tauri::command]
pub fn clear_notch_response() -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    let path = notch_response_path()?;
    if path.exists() {
      fs::remove_file(&path)
        .map_err(|err| format!("failed to clear Niki Notch response: {err}"))?;
      notch_debug_log(&format!("clear response path={}", path.display()));
    }
    return Ok(());
  }

  #[cfg(not(target_os = "macos"))]
  {
    Ok(())
  }
}
