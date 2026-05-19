use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::fs::File;
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

use tauri::Manager;

static IS_RECORDING: AtomicBool = AtomicBool::new(false);
static RECORDING_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);
static WRITER: Mutex<Option<hound::WavWriter<BufWriter<File>>>> = Mutex::new(None);
static SAMPLES_WRITTEN: AtomicUsize = AtomicUsize::new(0);

/// Clean up any residual writer or file from a previous session.
fn cleanup_recording_state() {
  IS_RECORDING.store(false, Ordering::SeqCst);
  if let Ok(mut w) = WRITER.lock() {
    if let Some(writer) = w.take() {
      let _ = writer.finalize();
    }
  }
  if let Ok(mut p) = RECORDING_PATH.lock() {
    if let Some(path) = p.take() {
      let _ = std::fs::remove_file(&path);
    }
  }
  SAMPLES_WRITTEN.store(0, Ordering::SeqCst);
}

#[tauri::command]
pub fn start_audio_recording(app_handle: tauri::AppHandle) -> Result<String, String> {
  if IS_RECORDING.load(Ordering::SeqCst) {
    eprintln!("[audio] start_audio_recording called but already recording, forcing cleanup");
    cleanup_recording_state();
  }

  cleanup_recording_state();

  let app_data_dir = app_handle
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to get app data dir: {}", e))?;

  std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;

  let output_path = app_data_dir.join("recording.wav");

  {
    let mut p = RECORDING_PATH.lock().map_err(|e| e.to_string())?;
    *p = Some(output_path.clone());
  }

  SAMPLES_WRITTEN.store(0, Ordering::SeqCst);
  IS_RECORDING.store(true, Ordering::SeqCst);

  let path_for_thread = output_path.clone();
  std::thread::spawn(move || {
    if let Err(e) = run_recording(&path_for_thread) {
      eprintln!("[audio] Recording error: {}", e);
    }
    IS_RECORDING.store(false, Ordering::SeqCst);
  });

  Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn stop_audio_recording() -> Result<(), String> {
  eprintln!("[audio] stop_audio_recording called");
  IS_RECORDING.store(false, Ordering::SeqCst);
  Ok(())
}

#[tauri::command]
pub fn is_audio_recording() -> bool {
  let state = IS_RECORDING.load(Ordering::SeqCst);
  eprintln!("[audio] is_audio_recording = {}", state);
  state
}

#[tauri::command]
pub fn get_recording_bytes() -> Result<Option<Vec<u8>>, String> {
  // Wait for the recording thread to finish and finalize the WAV
  std::thread::sleep(std::time::Duration::from_millis(500));

  let path = {
    let mut p = RECORDING_PATH.lock().map_err(|e| e.to_string())?;
    p.take()
  };

  match path {
    Some(p) => {
      let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
      let _ = std::fs::remove_file(&p);
      Ok(Some(bytes))
    }
    None => Ok(None),
  }
}

fn run_recording(output_path: &PathBuf) -> Result<(), String> {
  let host = cpal::default_host();
  let device = host
    .default_input_device()
    .ok_or("No input device available")?;

  let config = device
    .default_input_config()
    .map_err(|e| format!("Failed to get default input config: {}", e))?;

  let sample_rate = config.sample_rate().0;
  let channels = config.channels() as u16;

  let spec = hound::WavSpec {
    channels,
    sample_rate,
    bits_per_sample: 16,
    sample_format: hound::SampleFormat::Int,
  };

  let writer = hound::WavWriter::create(output_path, spec).map_err(|e| e.to_string())?;
  {
    let mut w = WRITER.lock().map_err(|e| e.to_string())?;
    *w = Some(writer);
  }

  let err_fn = |err| eprintln!("[audio] Stream error: {}", err);

  let stream = match config.sample_format() {
    cpal::SampleFormat::F32 => device.build_input_stream(
      &config.into(),
      move |data: &[f32], _: &_| {
        write_samples_f32(data);
      },
      err_fn,
      None,
    ),
    cpal::SampleFormat::I16 => device.build_input_stream(
      &config.into(),
      move |data: &[i16], _: &_| {
        write_samples_i16(data);
      },
      err_fn,
      None,
    ),
    cpal::SampleFormat::U16 => device.build_input_stream(
      &config.into(),
      move |data: &[u16], _: &_| {
        write_samples_u16(data);
      },
      err_fn,
      None,
    ),
    _ => return Err("Unsupported sample format".to_string()),
  }
  .map_err(|e| format!("Failed to build input stream: {}", e))?;

  stream.play().map_err(|e| e.to_string())?;

  while IS_RECORDING.load(Ordering::SeqCst) {
    std::thread::sleep(std::time::Duration::from_millis(50));
  }

  drop(stream);

  // Finalize the WAV writer so headers are written correctly
  {
    let mut w = WRITER.lock().map_err(|e| e.to_string())?;
    if let Some(writer) = w.take() {
      writer.finalize().map_err(|e| e.to_string())?;
    }
  }

  let samples = SAMPLES_WRITTEN.load(Ordering::SeqCst);
  eprintln!("[audio] Recording finished. Samples written: {}", samples);

  Ok(())
}

fn write_samples_f32(data: &[f32]) {
  if let Ok(mut w) = WRITER.lock() {
    if let Some(ref mut writer) = *w {
      for &sample in data {
        let sample_i16 = (sample * i16::MAX as f32) as i16;
        let _ = writer.write_sample(sample_i16);
      }
      SAMPLES_WRITTEN.fetch_add(data.len(), Ordering::SeqCst);
    }
  }
}

fn write_samples_i16(data: &[i16]) {
  if let Ok(mut w) = WRITER.lock() {
    if let Some(ref mut writer) = *w {
      for &sample in data {
        let _ = writer.write_sample(sample);
      }
      SAMPLES_WRITTEN.fetch_add(data.len(), Ordering::SeqCst);
    }
  }
}

fn write_samples_u16(data: &[u16]) {
  if let Ok(mut w) = WRITER.lock() {
    if let Some(ref mut writer) = *w {
      for &sample in data {
        let sample_i16 = (sample as i32 - 32768) as i16;
        let _ = writer.write_sample(sample_i16);
      }
      SAMPLES_WRITTEN.fetch_add(data.len(), Ordering::SeqCst);
    }
  }
}
