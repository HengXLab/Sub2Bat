use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};
use uuid::Uuid;

const CLAIM_DIRECTORY: &str = "scheduled-automation-claims";
const CLAIM_FORMAT_VERSION: &str = "v2";
const LEGACY_CLAIM_FORMAT_VERSION: &str = "v1";
const ACTIVE_EXECUTION_LOCK_FILE: &str = "active-execution.lock";
const MAX_CLAIM_COMPONENT_CHARS: usize = 256;
const CLAIM_STATE_VERSION: u8 = 1;
// A rule edit creates a new compact state file. Retain inactive revisions long
// enough to reject delayed timers, then reclaim them; active rules update their
// modification time on every cycle and therefore remain intact.
const CLAIM_STATE_RETENTION: Duration = Duration::from_secs(90 * 24 * 60 * 60);
// The former v1 implementation created one file per cycle. Keep a little more
// than the maximum 31-day interval before removing its historical markers.
const LEGACY_CLAIM_RETENTION: Duration = Duration::from_secs(35 * 24 * 60 * 60);

/// The durable identity for one saved automation rule revision. A new
/// explicitly-started schedule receives a fresh generation inside this state.
#[derive(Clone, Debug, Eq, PartialEq)]
struct ScheduledAutomationExecutionIdentity {
    scope: String,
    rule_id: String,
    updated_at: String,
}

impl ScheduledAutomationExecutionIdentity {
    fn new(scope: &str, rule_id: &str, updated_at: &str) -> Result<Self, String> {
        Ok(Self {
            scope: normalize_component(scope, "自动化身份范围")?,
            rule_id: normalize_component(rule_id, "自动化规则 ID")?,
            updated_at: normalize_component(updated_at, "自动化规则更新时间")?,
        })
    }

    fn marker_file_name(&self) -> String {
        let mut digest = Sha256::new();
        digest.update(b"sub2bat-scheduled-automation-claim\0v2");
        append_component(&mut digest, b"scope", &self.scope);
        append_component(&mut digest, b"rule-id", &self.rule_id);
        append_component(&mut digest, b"updated-at", &self.updated_at);
        format!("{CLAIM_FORMAT_VERSION}-{:x}.state", digest.finalize())
    }
}

/// A durable identity for one cycle within an explicitly-started schedule.
/// The state file records the schedule generation and its highest claimed
/// cycle, rather than producing one file per cycle.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScheduledAutomationExecutionClaim {
    identity: ScheduledAutomationExecutionIdentity,
    schedule_id: String,
    schedule_cycle: u64,
}

impl ScheduledAutomationExecutionClaim {
    pub fn new(
        scope: &str,
        rule_id: &str,
        updated_at: &str,
        schedule_id: &str,
        schedule_cycle: u64,
    ) -> Result<Self, String> {
        if schedule_cycle == 0 {
            return Err("自动化调度周期必须从 1 开始。".to_owned());
        }

        Ok(Self {
            identity: ScheduledAutomationExecutionIdentity::new(scope, rule_id, updated_at)?,
            schedule_id: normalize_component(schedule_id, "自动化调度代次")?,
            schedule_cycle,
        })
    }

    fn marker_file_name(&self) -> String {
        self.identity.marker_file_name()
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedClaimState {
    version: u8,
    schedule_id: String,
    highest_cycle: u64,
}

enum ClaimStateRead {
    Missing,
    Legacy,
    Current(PersistedClaimState),
}

/// Holds an OS-backed file lock for the complete automatic execution. The
/// handle intentionally stays in `AppState` until the renderer releases it or
/// the desktop process exits, at which point the operating system releases it.
pub struct ScheduledAutomationExecutionLease {
    lease_id: String,
    _lock_file: File,
}

impl ScheduledAutomationExecutionLease {
    pub fn id(&self) -> &str {
        &self.lease_id
    }

    pub fn matches(&self, lease_id: &str) -> bool {
        self.lease_id == lease_id
    }
}

/// Acquires the single local automatic-execution lease. `Ok(None)` means a
/// different Sub2Bat process currently owns it; callers should retry later.
pub fn acquire_scheduled_automation_execution_lease(
    app_local_data_dir: &Path,
    lease_id: &str,
) -> Result<Option<ScheduledAutomationExecutionLease>, String> {
    let lease_id = normalize_component(lease_id, "自动化执行租约")?;
    let marker_dir = marker_directory(app_local_data_dir)?;
    let lock_path = marker_dir.join(ACTIVE_EXECUTION_LOCK_FILE);
    let lock_file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(lock_path)
        .map_err(|error| format!("无法打开自动化执行锁：{error}"))?;

    match lock_file.try_lock() {
        Ok(()) => Ok(Some(ScheduledAutomationExecutionLease {
            lease_id,
            _lock_file: lock_file,
        })),
        Err(std::fs::TryLockError::WouldBlock) => Ok(None),
        Err(std::fs::TryLockError::Error(error)) => Err(format!("无法获得自动化执行锁：{error}")),
    }
}

/// Starts a new explicit automatic schedule for a rule revision and returns
/// its server-issued generation. This is deliberately separate from a cycle
/// claim: stopping and starting a rule (or restarting the app) starts over at
/// cycle one without reviving an older schedule generation.
pub fn begin_scheduled_automation_execution(
    app_local_data_dir: &Path,
    scope: &str,
    rule_id: &str,
    updated_at: &str,
) -> Result<String, String> {
    let identity = ScheduledAutomationExecutionIdentity::new(scope, rule_id, updated_at)?;
    let marker_dir = marker_directory(app_local_data_dir)?;
    cleanup_expired_claim_states(&marker_dir);
    cleanup_expired_legacy_claims(app_local_data_dir);

    let marker_path = marker_dir.join(identity.marker_file_name());
    let _state_lock = lock_claim_state(&marker_path)?;
    // A legacy numeric marker can be retired only by an explicit user start.
    // Empty or malformed state is never treated as absent, so a crash cannot
    // silently permit a duplicate destructive cycle.
    let _existing_state = read_claim_state(&marker_path)?;
    let schedule_id = Uuid::new_v4().to_string();
    write_claim_state_atomically(
        &marker_path,
        &PersistedClaimState {
            version: CLAIM_STATE_VERSION,
            schedule_id: schedule_id.clone(),
            highest_cycle: 0,
        },
    )?;

    Ok(schedule_id)
}

/// Atomically records the highest claimed cycle for one explicit schedule
/// generation. A stale generation or a cycle at or below the recorded value
/// was already claimed by another local client.
pub fn claim_scheduled_automation_execution(
    app_local_data_dir: &Path,
    claim: &ScheduledAutomationExecutionClaim,
) -> Result<bool, String> {
    let marker_dir = marker_directory(app_local_data_dir)?;
    cleanup_expired_claim_states(&marker_dir);
    cleanup_expired_legacy_claims(app_local_data_dir);

    let marker_path = marker_dir.join(claim.marker_file_name());
    let _state_lock = lock_claim_state(&marker_path)?;
    let state = match read_claim_state(&marker_path)? {
        ClaimStateRead::Current(state) => state,
        ClaimStateRead::Missing | ClaimStateRead::Legacy => {
            return Err("自动化执行状态尚未初始化，请重新启动该自动化后重试。".to_owned());
        }
    };

    if state.schedule_id != claim.schedule_id || state.highest_cycle >= claim.schedule_cycle {
        return Ok(false);
    }

    write_claim_state_atomically(
        &marker_path,
        &PersistedClaimState {
            version: CLAIM_STATE_VERSION,
            schedule_id: state.schedule_id,
            highest_cycle: claim.schedule_cycle,
        },
    )?;

    Ok(true)
}

fn marker_directory(app_local_data_dir: &Path) -> Result<PathBuf, String> {
    let marker_dir = app_local_data_dir
        .join(CLAIM_DIRECTORY)
        .join(CLAIM_FORMAT_VERSION);
    fs::create_dir_all(&marker_dir)
        .map_err(|error| format!("无法准备自动化执行状态目录：{error}"))?;
    Ok(marker_dir)
}

fn lock_claim_state(marker_path: &Path) -> Result<File, String> {
    let lock_path = marker_path.with_extension("lock");
    let lock_file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(lock_path)
        .map_err(|error| format!("无法打开自动化执行状态锁：{error}"))?;
    lock_file
        .lock()
        .map_err(|error| format!("无法锁定自动化执行状态：{error}"))?;
    Ok(lock_file)
}

fn read_claim_state(marker_path: &Path) -> Result<ClaimStateRead, String> {
    let contents = match fs::read_to_string(marker_path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ClaimStateRead::Missing)
        }
        Err(error) => return Err(format!("无法读取自动化执行状态：{error}")),
    };
    let contents = contents.trim();
    if contents.is_empty() {
        return Err(corrupt_claim_state_error());
    }

    if let Ok(cycle) = contents.parse::<u64>() {
        if cycle == 0 {
            return Err(corrupt_claim_state_error());
        }
        return Ok(ClaimStateRead::Legacy);
    }

    let state = serde_json::from_str::<PersistedClaimState>(contents)
        .map_err(|_| corrupt_claim_state_error())?;
    if state.version != CLAIM_STATE_VERSION {
        return Err(corrupt_claim_state_error());
    }
    let schedule_id = normalize_component(&state.schedule_id, "自动化调度代次")
        .map_err(|_| corrupt_claim_state_error())?;

    Ok(ClaimStateRead::Current(PersistedClaimState {
        version: CLAIM_STATE_VERSION,
        schedule_id,
        highest_cycle: state.highest_cycle,
    }))
}

fn write_claim_state_atomically(
    marker_path: &Path,
    state: &PersistedClaimState,
) -> Result<(), String> {
    let parent = marker_path
        .parent()
        .ok_or_else(|| "无法定位自动化执行状态目录。".to_owned())?;
    let marker_name = marker_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "自动化执行状态文件名无效。".to_owned())?;
    let temporary_path = parent.join(format!(".{marker_name}.{}.tmp", Uuid::new_v4()));

    let result = (|| {
        let payload = serde_json::to_vec(state)
            .map_err(|error| format!("无法编码自动化执行状态：{error}"))?;
        let mut temporary = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
            .map_err(|error| format!("无法创建自动化执行状态临时文件：{error}"))?;
        temporary
            .write_all(&payload)
            .and_then(|_| temporary.write_all(b"\n"))
            .and_then(|_| temporary.sync_all())
            .map_err(|error| format!("无法安全写入自动化执行状态：{error}"))?;
        drop(temporary);

        // The replacement happens only after the complete temporary state is
        // durable. A crash therefore leaves either the prior complete state
        // or the new complete state, never a truncated marker.
        replace_claim_state_file(&temporary_path, marker_path)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}

#[cfg(not(windows))]
fn replace_claim_state_file(temporary_path: &Path, marker_path: &Path) -> Result<(), String> {
    fs::rename(temporary_path, marker_path)
        .map_err(|error| format!("无法原子替换自动化执行状态：{error}"))
}

#[cfg(windows)]
fn replace_claim_state_file(temporary_path: &Path, marker_path: &Path) -> Result<(), String> {
    use std::{iter, os::windows::ffi::OsStrExt};
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, ReplaceFileW, MOVEFILE_WRITE_THROUGH, REPLACEFILE_WRITE_THROUGH,
    };

    let temporary_path_wide = temporary_path
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
    let marker_path_wide = marker_path
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();

    match fs::metadata(marker_path) {
        Ok(_) => {
            // ReplaceFileW keeps the old completed marker in place if the
            // replacement cannot be committed; unlike remove-then-rename it
            // never creates a window in which a reader sees no state.
            let replaced = unsafe {
                ReplaceFileW(
                    marker_path_wide.as_ptr(),
                    temporary_path_wide.as_ptr(),
                    std::ptr::null(),
                    REPLACEFILE_WRITE_THROUGH,
                    std::ptr::null(),
                    std::ptr::null(),
                )
            };
            if replaced == 0 {
                return Err(format!(
                    "无法原子替换自动化执行状态：{}",
                    std::io::Error::last_os_error()
                ));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // The first state file has no previous marker to preserve.
            let moved = unsafe {
                MoveFileExW(
                    temporary_path_wide.as_ptr(),
                    marker_path_wide.as_ptr(),
                    MOVEFILE_WRITE_THROUGH,
                )
            };
            if moved == 0 {
                return Err(format!(
                    "无法创建自动化执行状态：{}",
                    std::io::Error::last_os_error()
                ));
            }
        }
        Err(error) => return Err(format!("无法检查自动化执行状态：{error}")),
    }

    Ok(())
}

fn corrupt_claim_state_error() -> String {
    "自动化执行状态已损坏，为避免重复运行，请停止该自动化并检查本地状态后重试。".to_owned()
}

fn cleanup_expired_claim_states(marker_dir: &Path) {
    cleanup_expired_files(marker_dir, "state", CLAIM_STATE_RETENTION);
}

fn cleanup_expired_legacy_claims(app_local_data_dir: &Path) {
    let legacy_dir = app_local_data_dir
        .join(CLAIM_DIRECTORY)
        .join(LEGACY_CLAIM_FORMAT_VERSION);
    cleanup_expired_files(&legacy_dir, "claim", LEGACY_CLAIM_RETENTION);
}

fn cleanup_expired_files(directory: &Path, extension: &str, retention: Duration) {
    let cutoff = SystemTime::now()
        .checked_sub(retention)
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some(extension) {
            continue;
        }
        let Ok(modified) = entry.metadata().and_then(|metadata| metadata.modified()) else {
            continue;
        };
        if modified < cutoff {
            let _ = fs::remove_file(path);
        }
    }
}

fn append_component(digest: &mut Sha256, name: &[u8], value: &str) {
    digest.update((name.len() as u64).to_be_bytes());
    digest.update(name);
    digest.update((value.len() as u64).to_be_bytes());
    digest.update(value.as_bytes());
}

fn normalize_component(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{label}不能为空。"));
    }
    if value.chars().count() > MAX_CLAIM_COMPONENT_CHARS {
        return Err(format!(
            "{label}不能超过 {MAX_CLAIM_COMPONENT_CHARS} 个字符。"
        ));
    }
    if value.chars().any(char::is_control) {
        return Err(format!("{label}不能包含控制字符。"));
    }
    Ok(value.to_owned())
}

#[cfg(test)]
mod tests {
    use super::{
        acquire_scheduled_automation_execution_lease, begin_scheduled_automation_execution,
        claim_scheduled_automation_execution, ScheduledAutomationExecutionClaim,
    };
    use std::{
        fs,
        path::PathBuf,
        sync::{Arc, Barrier},
        thread,
    };
    use uuid::Uuid;

    struct TemporaryClaimDirectory(PathBuf);

    impl TemporaryClaimDirectory {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "sub2bat-automation-claim-{label}-{}",
                Uuid::new_v4()
            ));
            Self(path)
        }
    }

    impl Drop for TemporaryClaimDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn claim(
        scope: &str,
        updated_at: &str,
        schedule_id: &str,
        cycle: u64,
    ) -> ScheduledAutomationExecutionClaim {
        ScheduledAutomationExecutionClaim::new(
            scope,
            "rule-08f14f2d",
            updated_at,
            schedule_id,
            cycle,
        )
        .expect("valid test claim")
    }

    fn begin_schedule(
        directory: &TemporaryClaimDirectory,
        scope: &str,
        updated_at: &str,
    ) -> String {
        begin_scheduled_automation_execution(&directory.0, scope, "rule-08f14f2d", updated_at)
            .expect("schedule should start")
    }

    #[test]
    fn only_first_claim_for_the_same_cycle_succeeds() {
        let directory = TemporaryClaimDirectory::new("one-shot");
        let scope = "profile-a|https://example.test";
        let updated_at = "2026-07-15T12:00:00.000Z";
        let schedule_id = begin_schedule(&directory, scope, updated_at);
        let claim = claim(scope, updated_at, &schedule_id, 1);

        assert_eq!(
            claim_scheduled_automation_execution(&directory.0, &claim),
            Ok(true)
        );
        assert_eq!(
            claim_scheduled_automation_execution(&directory.0, &claim),
            Ok(false)
        );
    }

    #[test]
    fn later_cycle_reuses_the_same_compact_state_file() {
        let directory = TemporaryClaimDirectory::new("compact");
        let scope = "profile-a|https://example.test";
        let updated_at = "2026-07-15T12:00:00.000Z";
        let schedule_id = begin_schedule(&directory, scope, updated_at);
        let first = claim(scope, updated_at, &schedule_id, 1);
        let second = claim(scope, updated_at, &schedule_id, 2);

        assert_eq!(
            claim_scheduled_automation_execution(&directory.0, &first),
            Ok(true)
        );
        assert_eq!(
            claim_scheduled_automation_execution(&directory.0, &second),
            Ok(true)
        );
        assert_eq!(
            claim_scheduled_automation_execution(&directory.0, &first),
            Ok(false)
        );

        let state_dir = directory.0.join("scheduled-automation-claims").join("v2");
        let state_count = fs::read_dir(state_dir)
            .expect("state directory should exist")
            .flatten()
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .is_some_and(|value| value == "state")
            })
            .count();
        assert_eq!(state_count, 1);
    }

    #[test]
    fn updated_rule_revision_receives_a_new_state_file() {
        let directory = TemporaryClaimDirectory::new("revision");
        let scope = "profile-a|https://example.test";
        let original_updated_at = "2026-07-15T12:00:00.000Z";
        let updated_at = "2026-07-15T12:01:00.000Z";
        let original_schedule = begin_schedule(&directory, scope, original_updated_at);
        let updated_schedule = begin_schedule(&directory, scope, updated_at);
        let original = claim(scope, original_updated_at, &original_schedule, 1);
        let updated = claim(scope, updated_at, &updated_schedule, 1);

        assert_eq!(
            claim_scheduled_automation_execution(&directory.0, &original),
            Ok(true)
        );
        assert_eq!(
            claim_scheduled_automation_execution(&directory.0, &updated),
            Ok(true)
        );
    }

    #[test]
    fn concurrent_claims_have_exactly_one_winner() {
        let directory = Arc::new(TemporaryClaimDirectory::new("concurrent"));
        let scope = "profile-a|https://example.test";
        let updated_at = "2026-07-15T12:00:00.000Z";
        let schedule_id = begin_schedule(&directory, scope, updated_at);
        let claim = Arc::new(claim(scope, updated_at, &schedule_id, 1));
        let worker_count = 8;
        let barrier = Arc::new(Barrier::new(worker_count));
        let handles = (0..worker_count)
            .map(|_| {
                let directory = Arc::clone(&directory);
                let claim = Arc::clone(&claim);
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    claim_scheduled_automation_execution(&directory.0, &claim)
                })
            })
            .collect::<Vec<_>>();

        let results = handles
            .into_iter()
            .map(|handle| handle.join().expect("claim worker should not panic"))
            .collect::<Result<Vec<_>, _>>()
            .expect("claim should not fail");
        assert_eq!(results.into_iter().filter(|claimed| *claimed).count(), 1);
    }

    #[test]
    fn active_execution_lease_excludes_a_second_local_process() {
        let directory = TemporaryClaimDirectory::new("lease");
        let first = acquire_scheduled_automation_execution_lease(&directory.0, "lease-a")
            .expect("first lease should not fail")
            .expect("first lease should be granted");
        assert!(
            acquire_scheduled_automation_execution_lease(&directory.0, "lease-b")
                .expect("second lease should not fail")
                .is_none()
        );
        drop(first);
        assert!(
            acquire_scheduled_automation_execution_lease(&directory.0, "lease-c")
                .expect("released lease should not fail")
                .is_some()
        );
    }

    #[test]
    fn invalid_claim_components_are_rejected_before_touching_disk() {
        let error =
            ScheduledAutomationExecutionClaim::new("scope", "", "2026-07-15", "schedule", 1)
                .expect_err("empty rule ID must fail");
        assert!(error.contains("规则 ID"));

        let error =
            ScheduledAutomationExecutionClaim::new("scope", "rule", "\u{0007}", "schedule", 1)
                .expect_err("control characters must fail");
        assert!(error.contains("控制字符"));

        let error =
            ScheduledAutomationExecutionClaim::new("scope", "rule", "2026-07-15", "schedule", 0)
                .expect_err("zero cycle must fail");
        assert!(error.contains("周期"));

        let error = ScheduledAutomationExecutionClaim::new("scope", "rule", "2026-07-15", "", 1)
            .expect_err("empty schedule ID must fail");
        assert!(error.contains("调度代次"));
    }

    #[test]
    fn claims_are_isolated_between_login_scopes() {
        let directory = TemporaryClaimDirectory::new("scope");
        let first_scope_name = "profile-a|https://first.example.test";
        let second_scope_name = "profile-b|https://second.example.test";
        let updated_at = "2026-07-15T12:00:00.000Z";
        let first_schedule = begin_schedule(&directory, first_scope_name, updated_at);
        let second_schedule = begin_schedule(&directory, second_scope_name, updated_at);
        let first_scope = claim(first_scope_name, updated_at, &first_schedule, 1);
        let second_scope = claim(second_scope_name, updated_at, &second_schedule, 1);

        assert_eq!(
            claim_scheduled_automation_execution(&directory.0, &first_scope),
            Ok(true)
        );
        assert_eq!(
            claim_scheduled_automation_execution(&directory.0, &second_scope),
            Ok(true)
        );
    }

    #[test]
    fn restarted_schedule_can_claim_cycle_one_but_stale_schedule_cannot_resume() {
        let directory = TemporaryClaimDirectory::new("restart");
        let scope = "profile-a|https://example.test";
        let updated_at = "2026-07-15T12:00:00.000Z";
        let first_schedule = begin_schedule(&directory, scope, updated_at);
        let first_cycle = claim(scope, updated_at, &first_schedule, 1);
        assert_eq!(
            claim_scheduled_automation_execution(&directory.0, &first_cycle),
            Ok(true)
        );

        let restarted_schedule = begin_schedule(&directory, scope, updated_at);
        assert_ne!(restarted_schedule, first_schedule);
        let restarted_first_cycle = claim(scope, updated_at, &restarted_schedule, 1);
        assert_eq!(
            claim_scheduled_automation_execution(&directory.0, &restarted_first_cycle),
            Ok(true)
        );
        let stale_second_cycle = claim(scope, updated_at, &first_schedule, 2);
        assert_eq!(
            claim_scheduled_automation_execution(&directory.0, &stale_second_cycle),
            Ok(false)
        );
    }

    #[test]
    fn empty_state_is_rejected_instead_of_being_treated_as_unclaimed() {
        let directory = TemporaryClaimDirectory::new("empty-state");
        let scope = "profile-a|https://example.test";
        let updated_at = "2026-07-15T12:00:00.000Z";
        let schedule_id = begin_schedule(&directory, scope, updated_at);
        let first_cycle = claim(scope, updated_at, &schedule_id, 1);
        let marker_path = directory
            .0
            .join("scheduled-automation-claims")
            .join("v2")
            .join(first_cycle.marker_file_name());
        fs::write(&marker_path, b"").expect("test can simulate a damaged state file");

        let error = claim_scheduled_automation_execution(&directory.0, &first_cycle)
            .expect_err("an empty state must fail closed");
        assert!(error.contains("已损坏"));
        let error =
            begin_scheduled_automation_execution(&directory.0, scope, "rule-08f14f2d", updated_at)
                .expect_err("a new schedule must not overwrite an empty state");
        assert!(error.contains("已损坏"));
    }
}
