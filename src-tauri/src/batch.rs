use std::collections::HashMap;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AccountTestStatus {
    Queued,
    Testing,
    Succeeded,
    Failed,
    Cancelled,
}

impl AccountTestStatus {
    fn is_terminal(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed | Self::Cancelled)
    }
}

#[derive(Clone, Debug)]
pub struct BatchSummary {
    statuses: HashMap<i64, AccountTestStatus>,
    pub queued: usize,
    pub testing: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub cancelled: usize,
}

impl BatchSummary {
    pub fn new(account_ids: impl IntoIterator<Item = i64>) -> Self {
        let statuses = account_ids
            .into_iter()
            .map(|account_id| (account_id, AccountTestStatus::Queued))
            .collect();
        let mut summary = Self {
            statuses,
            queued: 0,
            testing: 0,
            succeeded: 0,
            failed: 0,
            cancelled: 0,
        };
        summary.recount();
        summary
    }

    pub fn status_for(&self, account_id: i64) -> Option<AccountTestStatus> {
        self.statuses.get(&account_id).copied()
    }

    pub fn mark_testing(&mut self, account_id: i64) {
        if self.status_for(account_id) == Some(AccountTestStatus::Queued) {
            self.statuses.insert(account_id, AccountTestStatus::Testing);
            self.recount();
        }
    }

    pub fn mark_finished(&mut self, account_id: i64, succeeded: bool) {
        let Some(status) = self.status_for(account_id) else {
            return;
        };
        if status.is_terminal() {
            return;
        }

        self.statuses.insert(
            account_id,
            if succeeded {
                AccountTestStatus::Succeeded
            } else {
                AccountTestStatus::Failed
            },
        );
        self.recount();
    }

    pub fn mark_cancelled(&mut self, account_id: i64) {
        let Some(status) = self.status_for(account_id) else {
            return;
        };
        if status.is_terminal() {
            return;
        }

        self.statuses
            .insert(account_id, AccountTestStatus::Cancelled);
        self.recount();
    }

    pub fn cancel_open_accounts(&mut self) {
        for status in self.statuses.values_mut() {
            if !status.is_terminal() {
                *status = AccountTestStatus::Cancelled;
            }
        }
        self.recount();
    }

    fn recount(&mut self) {
        self.queued = 0;
        self.testing = 0;
        self.succeeded = 0;
        self.failed = 0;
        self.cancelled = 0;

        for status in self.statuses.values() {
            match status {
                AccountTestStatus::Queued => self.queued += 1,
                AccountTestStatus::Testing => self.testing += 1,
                AccountTestStatus::Succeeded => self.succeeded += 1,
                AccountTestStatus::Failed => self.failed += 1,
                AccountTestStatus::Cancelled => self.cancelled += 1,
            }
        }
    }
}
