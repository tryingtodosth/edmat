// Hand-maintained mirrors of backend/issues/models.py's two choice lists — the same "mirror a
// small backend enum, flag the drift risk" convention labels.ts already follows.
import { m } from '$lib/paraglide/messages.js';
import type { IssueArea, IssueKind, IssueSource, IssueStatus } from '$lib/types/issue';

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

// The two categories the school-management demo files under — see backend/issues/models.py. They
// are mirrors of a backend enum like the two above, with the same drift risk, and the backend has
// a test that reads the demo's own module registry to catch it.
export const ISSUE_SOURCES: IssueSource[] = ['site', 'school_demo'];

export const ISSUE_SOURCE_LABELS: Record<IssueSource, () => string> = {
	site: () => m.issue_source_site(), // "EdMat site"
	school_demo: () => m.issue_source_schoolDemo() // "School demo"
};

/** '' is deliberately absent: an empty area is "no part named", which reads as nothing rather than
 *  as a label, and every call site already has to handle the empty case to decide that. */
export const ISSUE_AREA_LABELS: Record<Exclude<IssueArea, ''>, () => string> = {
	core: () => m.issue_area_core(), // "Core (login, sessions, audit)"
	logbook: () => m.issue_area_logbook(), // "Lesson logbook"
	grades: () => m.issue_area_grades(), // "Grades and remarks"
	homeroom: () => m.issue_area_homeroom(), // "Homeroom and classification"
	principal: () => m.issue_area_principal(), // "Principal"
	support: () => m.issue_area_support(), // "Psychological and pedagogical support"
	registry: () => m.issue_area_registry(), // "Registrar"
	student: () => m.issue_area_student(), // "Student account"
	parent: () => m.issue_area_parent(), // "Parent account"
	messages: () => m.issue_area_messages(), // "Messages and notifications"
	school: () => m.issue_area_school(), // "After-school care, cafeteria, library"
	courses: () => m.issue_area_courses(), // "Courses and materials"
	meetings: () => m.issue_area_meetings(), // "Video meetings"
	compliance: () => m.issue_area_compliance(), // "Compliance (GDPR, accessibility)"
	demo: () => m.issue_area_demo() // "Demo mode"
};

/** The areas a source actually has, mirroring `SOURCE_AREAS` in backend/issues/models.py. The site
 *  has none: the page it happened on already travels in `context.path`. */
export const SOURCE_AREAS: Record<IssueSource, Exclude<IssueArea, ''>[]> = {
	site: [],
	school_demo: Object.keys(ISSUE_AREA_LABELS) as Exclude<IssueArea, ''>[]
};

/** '' for an unnamed area, so a caller can render it or not with one check. */
export function issueAreaLabel(area: IssueArea): string {
	return area ? ISSUE_AREA_LABELS[area]() : '';
}
