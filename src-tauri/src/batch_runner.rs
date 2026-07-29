use crate::{
    api::{Sub2ApiClient, TestFailure, TestOutcome},
    batch::BatchSummary,
    commands::{active_session_for_batch, recover_batch_session_after_auth_failure},
    session::{normalize_concurrency, ActiveSession},
    sse::http_status_from_text,
    state::{AppState, BatchCompletionRecord},
};
use futures_util::future::join_all;
use serde::Serialize;
use std::{collections::VecDeque, sync::Arc, time::Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum BatchEvent {
    Started {
        run_id: String,
        total: usize,
        model_id: String,
    },
    Testing {
        run_id: String,
        account_id: i64,
    },
    Finished {
        run_id: String,
        account_id: i64,
        status: String,
        latency_ms: u64,
        message: String,
        http_status: Option<u16>,
    },
    Cancelled {
        run_id: String,
        account_id: i64,
    },
    Complete {
        run_id: String,
        succeeded: usize,
        failed: usize,
        cancelled: usize,
    },
}

pub struct BatchRun {
    pub run_id: String,
    pub session: ActiveSession,
    pub account_ids: Vec<i64>,
    pub model_id: String,
    pub concurrency: u8,
    pub cancellation: CancellationToken,
}

pub async fn run_batch(app: AppHandle, state: AppState, batch: BatchRun) {
    let BatchRun {
        run_id,
        session,
        account_ids,
        model_id,
        concurrency,
        cancellation,
    } = batch;
    let total = account_ids.len();
    emit(
        &app,
        BatchEvent::Started {
            run_id: run_id.clone(),
            total,
            model_id: model_id.clone(),
        },
    );

    let client = match Sub2ApiClient::new(session.server.clone()) {
        Ok(client) => client,
        Err(error) => {
            for account_id in account_ids {
                emit(
                    &app,
                    BatchEvent::Finished {
                        run_id: run_id.clone(),
                        account_id,
                        status: "failed".to_owned(),
                        latency_ms: 0,
                        message: error.clone(),
                        http_status: None,
                    },
                );
            }
            // Persist the terminal aggregate before releasing the active-run
            // registry. The renderer can query it when the final Tauri event
            // was lost, rather than waiting forever for completion.
            record_batch_completion(&state, &run_id, 0, total, 0).await;
            remove_batch_registration(&state, &run_id).await;
            emit(
                &app,
                BatchEvent::Complete {
                    run_id: run_id.clone(),
                    succeeded: 0,
                    failed: total,
                    cancelled: 0,
                },
            );
            return;
        }
    };

    let queue = Arc::new(Mutex::new(VecDeque::from(account_ids.clone())));
    let summary = Arc::new(Mutex::new(BatchSummary::new(account_ids)));
    let worker_count = usize::from(normalize_concurrency(concurrency));
    let session_generation = session.generation;
    let mut workers = Vec::with_capacity(worker_count);

    for _ in 0..worker_count {
        let app = app.clone();
        let state = state.clone();
        let client = client.clone();
        let queue = Arc::clone(&queue);
        let summary = Arc::clone(&summary);
        let run_id = run_id.clone();
        let session_generation = session_generation;
        let model_id = model_id.clone();
        let cancellation = cancellation.clone();

        workers.push(async move {
            loop {
                if cancellation.is_cancelled() {
                    break;
                }
                let account_id = { queue.lock().await.pop_front() };
                let Some(account_id) = account_id else {
                    break;
                };

                if cancellation.is_cancelled() {
                    summary.lock().await.mark_cancelled(account_id);
                    emit(
                        &app,
                        BatchEvent::Cancelled {
                            run_id: run_id.clone(),
                            account_id,
                        },
                    );
                    break;
                }

                summary.lock().await.mark_testing(account_id);
                emit(
                    &app,
                    BatchEvent::Testing {
                        run_id: run_id.clone(),
                        account_id,
                    },
                );

                let current_session =
                    match active_session_for_batch(&app, &state, session_generation).await {
                        Ok(session) => session,
                        Err(error) => {
                            if cancellation.is_cancelled() {
                                summary.lock().await.mark_cancelled(account_id);
                                emit(
                                    &app,
                                    BatchEvent::Cancelled {
                                        run_id: run_id.clone(),
                                        account_id,
                                    },
                                );
                                break;
                            }

                            summary.lock().await.mark_finished(account_id, false);
                            emit(
                                &app,
                                BatchEvent::Finished {
                                    run_id: run_id.clone(),
                                    account_id,
                                    status: "failed".to_owned(),
                                    latency_ms: 0,
                                    message: error,
                                    http_status: None,
                                },
                            );
                            continue;
                        }
                    };

                let started = Instant::now();
                let result = test_account_for_session(
                    &client,
                    &current_session.tokens.access_token,
                    account_id,
                    &model_id,
                    cancellation.clone(),
                    current_session.cancellation.clone(),
                )
                .await;
                let latency_ms = started.elapsed().as_millis() as u64;

                if cancellation.is_cancelled() {
                    summary.lock().await.mark_cancelled(account_id);
                    emit(
                        &app,
                        BatchEvent::Cancelled {
                            run_id: run_id.clone(),
                            account_id,
                        },
                    );
                    continue;
                }

                let result = match result {
                    SessionTestResult::Completed(result) => result,
                    SessionTestResult::SessionReplaced => {
                        // A refresh installed a new access token while this
                        // request was active. Retry the account with the new
                        // session rather than recording an old-token failure.
                        queue.lock().await.push_front(account_id);
                        continue;
                    }
                };

                match result {
                    Ok(outcome) => {
                        summary.lock().await.mark_finished(account_id, true);
                        emit(
                            &app,
                            BatchEvent::Finished {
                                run_id: run_id.clone(),
                                account_id,
                                status: "succeeded".to_owned(),
                                latency_ms,
                                message: outcome.message,
                                http_status: Some(outcome.http_status),
                            },
                        );
                    }
                    Err(error) => {
                        let recovery = recover_batch_session_after_auth_failure(
                            &app,
                            &state,
                            current_session,
                            error.http_status,
                            &error.message,
                        )
                        .await;
                        if cancellation.is_cancelled() {
                            summary.lock().await.mark_cancelled(account_id);
                            emit(
                                &app,
                                BatchEvent::Cancelled {
                                    run_id: run_id.clone(),
                                    account_id,
                                },
                            );
                            continue;
                        }

                        match recovery {
                            Ok(Some(refreshed_session)) => {
                                let retry_started = Instant::now();
                                let retry = test_account_for_session(
                                    &client,
                                    &refreshed_session.tokens.access_token,
                                    account_id,
                                    &model_id,
                                    cancellation.clone(),
                                    refreshed_session.cancellation.clone(),
                                )
                                .await;
                                let retry_latency_ms = retry_started.elapsed().as_millis() as u64;

                                if cancellation.is_cancelled() {
                                    summary.lock().await.mark_cancelled(account_id);
                                    emit(
                                        &app,
                                        BatchEvent::Cancelled {
                                            run_id: run_id.clone(),
                                            account_id,
                                        },
                                    );
                                    continue;
                                }

                                let retry = match retry {
                                    SessionTestResult::Completed(result) => result,
                                    SessionTestResult::SessionReplaced => {
                                        queue.lock().await.push_front(account_id);
                                        continue;
                                    }
                                };

                                match retry {
                                    Ok(outcome) => {
                                        summary.lock().await.mark_finished(account_id, true);
                                        emit(
                                            &app,
                                            BatchEvent::Finished {
                                                run_id: run_id.clone(),
                                                account_id,
                                                status: "succeeded".to_owned(),
                                                latency_ms: latency_ms
                                                    .saturating_add(retry_latency_ms),
                                                message: outcome.message,
                                                http_status: Some(outcome.http_status),
                                            },
                                        );
                                    }
                                    Err(retry_error) => {
                                        summary.lock().await.mark_finished(account_id, false);
                                        emit(
                                            &app,
                                            BatchEvent::Finished {
                                                run_id: run_id.clone(),
                                                account_id,
                                                status: "failed".to_owned(),
                                                latency_ms: latency_ms
                                                    .saturating_add(retry_latency_ms),
                                                http_status: retry_error.http_status.or_else(
                                                    || http_status_from_error(&retry_error.message),
                                                ),
                                                message: retry_error.message,
                                            },
                                        );
                                    }
                                }
                            }
                            Ok(None) => {
                                summary.lock().await.mark_finished(account_id, false);
                                emit(
                                    &app,
                                    BatchEvent::Finished {
                                        run_id: run_id.clone(),
                                        account_id,
                                        status: "failed".to_owned(),
                                        latency_ms,
                                        http_status: error
                                            .http_status
                                            .or_else(|| http_status_from_error(&error.message)),
                                        message: error.message,
                                    },
                                );
                            }
                            Err(recovery_error) => {
                                summary.lock().await.mark_finished(account_id, false);
                                emit(
                                    &app,
                                    BatchEvent::Finished {
                                        run_id: run_id.clone(),
                                        account_id,
                                        status: "failed".to_owned(),
                                        latency_ms,
                                        http_status: error
                                            .http_status
                                            .or_else(|| http_status_from_error(&error.message)),
                                        message: recovery_error,
                                    },
                                );
                            }
                        }
                    }
                }
            }
        });
    }

    join_all(workers).await;

    let remaining: Vec<i64> = queue.lock().await.drain(..).collect();
    for account_id in remaining {
        summary.lock().await.mark_cancelled(account_id);
        emit(
            &app,
            BatchEvent::Cancelled {
                run_id: run_id.clone(),
                account_id,
            },
        );
    }

    let summary = summary.lock().await.clone();
    // See the early-client-error branch above. Persist the terminal state
    // before releasing the registry so completion recovery cannot observe an
    // ambiguous gap between an inactive run and its final aggregate.
    record_batch_completion(
        &state,
        &run_id,
        summary.succeeded,
        summary.failed,
        summary.cancelled,
    )
    .await;
    remove_batch_registration(&state, &run_id).await;
    emit(
        &app,
        BatchEvent::Complete {
            run_id: run_id.clone(),
            succeeded: summary.succeeded,
            failed: summary.failed,
            cancelled: summary.cancelled,
        },
    );
}

async fn remove_batch_registration(state: &AppState, run_id: &str) {
    state.batches.lock().await.remove(run_id);
}

async fn record_batch_completion(
    state: &AppState,
    run_id: &str,
    succeeded: usize,
    failed: usize,
    cancelled: usize,
) {
    state.completed_batches.lock().await.insert(
        run_id.to_owned(),
        BatchCompletionRecord {
            succeeded,
            failed,
            cancelled,
        },
    );
}

async fn test_account_for_session(
    client: &Sub2ApiClient,
    access_token: &str,
    account_id: i64,
    model_id: &str,
    batch_cancellation: CancellationToken,
    session_cancellation: CancellationToken,
) -> SessionTestResult {
    tokio::select! {
        biased;
        _ = session_cancellation.cancelled() => SessionTestResult::SessionReplaced,
        result = client.test_account(access_token, account_id, model_id, batch_cancellation) => {
            SessionTestResult::Completed(result)
        }
    }
}

fn emit(app: &AppHandle, event: BatchEvent) {
    let _ = app.emit("batch://event", event);
}

enum SessionTestResult {
    Completed(Result<TestOutcome, TestFailure>),
    SessionReplaced,
}

fn http_status_from_error(error: &str) -> Option<u16> {
    http_status_from_text(error)
}

#[cfg(test)]
mod tests {
    use super::{record_batch_completion, remove_batch_registration, BatchEvent};
    use crate::state::{AppState, BatchCompletionRecord};
    use tokio_util::sync::CancellationToken;

    #[test]
    fn serializes_batch_events_with_frontend_field_names() {
        let event = BatchEvent::Testing {
            run_id: "run-1".to_owned(),
            account_id: 7,
        };

        assert_eq!(
            serde_json::to_value(event).unwrap(),
            serde_json::json!({
                "kind": "testing",
                "runId": "run-1",
                "accountId": 7
            })
        );
    }

    #[tokio::test]
    async fn releases_the_batch_registration_before_emitting_completion() {
        let state = AppState::default();
        state
            .batches
            .lock()
            .await
            .insert("run-1".to_owned(), CancellationToken::new());

        remove_batch_registration(&state, "run-1").await;

        assert!(state.batches.lock().await.is_empty());
    }

    #[tokio::test]
    async fn records_terminal_aggregate_for_renderer_recovery() {
        let state = AppState::default();

        record_batch_completion(&state, "run-1", 2, 1, 3).await;

        assert_eq!(
            state.completed_batches.lock().await.get("run-1"),
            Some(&BatchCompletionRecord {
                succeeded: 2,
                failed: 1,
                cancelled: 3,
            })
        );
    }
}
