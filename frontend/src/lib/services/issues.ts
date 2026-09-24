// Site issue reports — mirrors backend/issues/views.py's IssueViewSet.
import { apiClient } from '$lib/api/client';
import { mapIssue, type RawIssue } from '$lib/api/mappers';
import type { Issue, IssueArea, IssueDraft, IssueSource, IssueStatus } from '$lib/types/issue';

function query(params: Record<string, string | undefined>): string {
	const entries = Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]));
	return entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
}

export async function getIssues(
	filters: {
		status?: IssueStatus | '';
		/** Which product the report came from; '' is every product. */
		source?: IssueSource | '';
		/** Only meaningful with a source that has areas — the backend refuses a mismatched pair. */
		area?: IssueArea;
		all?: boolean;
	} = {}
): Promise<Issue[]> {
	const raw = await apiClient.get<RawIssue[]>(
		`/issues/${query({
			status: filters.status || undefined,
			source: filters.source || undefined,
			area: filters.area || undefined,
			all: filters.all ? '1' : undefined
		})}`
	);
	return raw.map(mapIssue);
}

export async function getIssueById(id: string): Promise<Issue | undefined> {
	try {
		return mapIssue(await apiClient.get<RawIssue>(`/issues/${encodeURIComponent(id)}/`));
	} catch {
		return undefined;
	}
}

export async function reportIssue(draft: IssueDraft): Promise<Issue> {
	const raw = await apiClient.post<RawIssue>('/issues/', {
		kind: draft.kind,
		// The site's own modal never sets these: the backend defaults to 'site' with no area, which
		// is what a report filed from here is. They are here so this one seam can file on behalf of
		// another surface if it ever needs to.
		source: draft.source,
		area: draft.area,
		title: draft.title,
		body: draft.body,
		context: {
			path: draft.context.path,
			page_title: draft.context.pageTitle,
			locale: draft.context.locale,
			viewport: draft.context.viewport,
			user_agent: draft.context.userAgent,
			role: draft.context.role
		},
		anonymous: draft.anonymous,
		contact_email: draft.contactEmail,
		is_public: draft.isPublic
	});
	return mapIssue(raw);
}

/** Staff only: move a report, leave a note, or pull it out of the public list. */
export async function updateIssue(
	id: string,
	patch: { status?: IssueStatus; staffNote?: string; isPublic?: false }
): Promise<Issue> {
	const raw = await apiClient.patch<RawIssue>(`/issues/${encodeURIComponent(id)}/`, {
		status: patch.status,
		staff_note: patch.staffNote,
		is_public: patch.isPublic
	});
	return mapIssue(raw);
}
