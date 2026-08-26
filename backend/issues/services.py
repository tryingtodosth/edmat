from notifications.services import notify


def notify_status_change(issue, actor) -> None:
    """Tells the reporter — when there is one — that staff moved their report. This is the whole of
    what a reporter gets instead of being able to revisit a private report, so it carries the note."""
    notify(
        issue.reporter,
        'issue_status_changed',
        actor=actor,
        target_label=issue.title,
        issue=issue,
        note=issue.staff_note,
    )
