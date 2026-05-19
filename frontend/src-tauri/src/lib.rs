mod audio;
mod backend_runtime;
mod boring_notch;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      audio::start_audio_recording,
      audio::stop_audio_recording,
      audio::is_audio_recording,
      audio::get_recording_bytes,
      boring_notch::launch_boring_notch,
      boring_notch::close_boring_notch,
      boring_notch::push_notch_request,
      boring_notch::consume_notch_request,
      boring_notch::sync_notch_config,
      boring_notch::push_notch_response,
      boring_notch::clear_notch_response
    ])
    .setup(|app| {
      backend_runtime::ensure_backend_runtime(app.handle())?;
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .on_window_event(|window, event| {
      if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
        let _ = boring_notch::close_boring_notch();
        backend_runtime::shutdown_backend_runtime(&tauri::Manager::app_handle(window));
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
