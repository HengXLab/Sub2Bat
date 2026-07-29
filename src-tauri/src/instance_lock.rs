use std::{
    fs::{self, File, OpenOptions},
    path::Path,
};

const INSTANCE_LOCK_FILE: &str = "sub2bat-instance.lock";

/// Keeps a single Sub2Bat process responsible for account mutations. The OS
/// releases this advisory lock automatically if the process exits unexpectedly.
pub struct ApplicationInstanceLease {
    _lock_file: File,
}

pub fn acquire_application_instance_lease(
    app_local_data_dir: &Path,
) -> Result<ApplicationInstanceLease, String> {
    fs::create_dir_all(app_local_data_dir)
        .map_err(|error| format!("无法准备应用实例锁目录：{error}"))?;
    let lock_path = app_local_data_dir.join(INSTANCE_LOCK_FILE);
    let lock_file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(lock_path)
        .map_err(|error| format!("无法打开应用实例锁：{error}"))?;

    match lock_file.try_lock() {
        Ok(()) => Ok(ApplicationInstanceLease {
            _lock_file: lock_file,
        }),
        Err(std::fs::TryLockError::WouldBlock) => {
            Err("Sub2Bat 已在运行。请先关闭当前窗口后再启动新的实例。".to_owned())
        }
        Err(std::fs::TryLockError::Error(error)) => {
            Err(format!("无法获得应用实例锁：{error}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::acquire_application_instance_lease;
    use std::{fs, path::PathBuf};
    use uuid::Uuid;

    struct TemporaryInstanceDirectory(PathBuf);

    impl TemporaryInstanceDirectory {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!(
                "sub2bat-instance-lock-{}",
                Uuid::new_v4()
            )))
        }
    }

    impl Drop for TemporaryInstanceDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn keeps_a_second_local_instance_from_acquiring_the_operation_lock() {
        let directory = TemporaryInstanceDirectory::new();
        let first = acquire_application_instance_lease(&directory.0)
            .expect("first application instance should acquire the lock");
        assert!(acquire_application_instance_lease(&directory.0).is_err());
        drop(first);
        assert!(acquire_application_instance_lease(&directory.0).is_ok());
    }
}
