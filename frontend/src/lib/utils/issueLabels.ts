// Hand-maintained mirrors of backend/issues/models.py's two choice lists — the same "mirror a
// small backend enum, flag the drift risk" convention labels.ts already follows.
import { m } from '$lib/paraglide/messages.js';
import type { IssueKind, IssueStatus } from '$lib/types/issue';

export const ISSUE_KIND_LABELS: Record<IssueKind, () => string> = {
	bug: () => m.issue_kind_bug(), // "Something is broken"
	content: () => m.issue_kind_content(), // "Wrong or misleading content"
	idea: () => m.issue_kind_idea(), // "An idea or suggestion"
	other: () => m.issue_kind_other() // "Something else"
};

export const ISSUE_STATUSES: IssueStatus[] = ['open', 'in_progress', 'resolved', 'closed'];

export const ISSUE_STATUS_LABELS: Record<IssueStatus, () => string> = {
	open: () => m.issue_status_open(), // "Open"
	in_progress: () => m.issue_status_inProgress(), // "In progress"
	resolved: () => m.issue_status_resolved(), // "Resolved"
	closed: () => m.issue_status_closed() // "Closed"
};
