use sub2bat_lib::batch::{AccountTestStatus, BatchSummary};

#[test]
fn tracks_terminal_results_without_double_counting_accounts() {
    let mut summary = BatchSummary::new([11_i64, 12, 13]);

    assert_eq!(summary.queued, 3);
    summary.mark_testing(11);
    summary.mark_finished(11, true);
    summary.mark_testing(12);
    summary.mark_finished(12, false);
    summary.mark_finished(12, true);

    assert_eq!(summary.queued, 1);
    assert_eq!(summary.testing, 0);
    assert_eq!(summary.succeeded, 1);
    assert_eq!(summary.failed, 1);
    assert_eq!(summary.status_for(12), Some(AccountTestStatus::Failed));
}

#[test]
fn cancels_only_accounts_that_have_not_reached_a_terminal_state() {
    let mut summary = BatchSummary::new([1_i64, 2, 3]);
    summary.mark_testing(1);
    summary.mark_finished(1, true);
    summary.cancel_open_accounts();

    assert_eq!(summary.succeeded, 1);
    assert_eq!(summary.cancelled, 2);
    assert_eq!(summary.queued, 0);
    assert_eq!(summary.testing, 0);
}

#[test]
fn can_mark_one_in_flight_account_as_cancelled() {
    let mut summary = BatchSummary::new([9_i64]);
    summary.mark_testing(9);
    summary.mark_cancelled(9);

    assert_eq!(summary.cancelled, 1);
    assert_eq!(summary.status_for(9), Some(AccountTestStatus::Cancelled));
}
