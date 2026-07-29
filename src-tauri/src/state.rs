use crate::{
    automation_claim::ScheduledAutomationExecutionLease,
    instance_lock::ApplicationInstanceLease,
    session::{ActiveSession, PendingTotp},
};
use std::{
    collections::HashMap,
    sync::{atomic::AtomicU64, Arc, Mutex as StdMutex},
};
use tokio::sync::{Mutex, RwLock};
use tokio_util::sync::CancellationToken;

/// Retains the final aggregate briefly so a renderer can recover when its
/// terminal event is lost during a WebView navigation or event delivery gap.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchCompletionRecord {
    pub succeeded: usize,
    pub failed: usize,
    pub cancelled: usize,
}

#[derive(Clone)]
pub struct AppState {
    pub session: Arc<RwLock<Option<ActiveSession>>>,
    /// Invalidates in-flight login, TOTP, and session-restoration attempts.
    pub session_generation: Arc<AtomicU64>,
    /// Serializes short session state and credential commits. Network requests
    /// deliberately never hold this lock.
    pub session_mutation: Arc<Mutex<()>>,
    /// Ensures an expiring access token is refreshed at most once at a time.
    pub session_refresh: Arc<Mutex<()>>,
    pub pending_totp: Arc<RwLock<Option<PendingTotp>>>,
    pub batches: Arc<Mutex<HashMap<String, CancellationToken>>>,
    /// Tracks model-catalog requests independently of batch tests so a stale
    /// filter scope can stop its queued and in-flight metadata calls.
    pub model_loads: Arc<Mutex<HashMap<String, CancellationToken>>>,
    pub completed_batches: Arc<Mutex<HashMap<String, BatchCompletionRecord>>>,
    /// Keeps the OS-backed automatic-execution lock alive while an automatic
    /// batch is running, including across separate Sub2Bat processes.
    pub automatic_execution_lease: Arc<Mutex<Option<ScheduledAutomationExecutionLease>>>,
    /// Prevents a second desktop process from issuing overlapping account
    /// mutations against the same configured Sub2API installation.
    pub application_instance_lease: Arc<StdMutex<Option<ApplicationInstanceLease>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            session: Arc::new(RwLock::new(None)),
            session_generation: Arc::new(AtomicU64::new(0)),
            session_mutation: Arc::new(Mutex::new(())),
            session_refresh: Arc::new(Mutex::new(())),
            pending_totp: Arc::new(RwLock::new(None)),
            batches: Arc::new(Mutex::new(HashMap::new())),
            model_loads: Arc::new(Mutex::new(HashMap::new())),
            completed_batches: Arc::new(Mutex::new(HashMap::new())),
            automatic_execution_lease: Arc::new(Mutex::new(None)),
            application_instance_lease: Arc::new(StdMutex::new(None)),
        }
    }
}
