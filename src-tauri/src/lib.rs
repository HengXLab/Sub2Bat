pub mod api;
pub mod automation_claim;
pub mod batch;
pub mod batch_runner;
pub mod commands;
pub mod instance_lock;
pub mod models;
pub mod response;
pub mod server_url;
pub mod session;
pub mod sse;
pub mod state;

use tauri::Manager;
#[cfg(debug_assertions)]
use tauri::webview::PageLoadEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::restore_session,
            commands::login,
            commands::complete_totp,
            commands::logout,
            commands::cancel_authentication,
            commands::list_accounts,
            commands::list_accounts_page,
            commands::list_groups,
            commands::list_groups_for_platform,
            commands::create_group,
            commands::create_group_and_move_accounts,
            commands::export_accounts_data,
            commands::complete_export_step_up,
            commands::delete_accounts,
            commands::move_accounts_to_group,
            commands::set_accounts_priority,
            commands::set_accounts_concurrency,
            commands::rename_accounts,
            commands::load_models,
            commands::cancel_model_load,
            commands::set_default_model,
            commands::set_default_concurrency,
            commands::set_auto_refresh_seconds,
            commands::begin_scheduled_automation_execution,
            commands::claim_scheduled_automation_execution,
            commands::acquire_automation_execution_lease,
            commands::release_scheduled_automation_execution,
            commands::start_batch_test,
            commands::cancel_batch,
            commands::get_batch_completion,
        ])
        .on_page_load(|_webview, _payload| {
            #[cfg(debug_assertions)]
            if matches!(_payload.event(), PageLoadEvent::Started) {
                let _ = _webview.window().set_decorations(true);
            }
        })
        .setup(|app| {
            let app_local_data_dir = app.path().app_local_data_dir()?;
            let instance_lease = instance_lock::acquire_application_instance_lease(&app_local_data_dir)
                .map_err(std::io::Error::other)?;
            let app_state = app.state::<state::AppState>();
            let mut state_lease = app_state
                .application_instance_lease
                .lock()
                .map_err(|_| std::io::Error::other("应用实例锁状态不可用"))?;
            *state_lease = Some(instance_lease);

            #[cfg(debug_assertions)]
            {
                let main_window = app
                    .get_webview_window("main")
                    .expect("main window must exist");

                // The renderer hides this after a successful mount. If a Vite
                // navigation fails, the browser error page cannot hide it.
                main_window.set_decorations(true)?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
