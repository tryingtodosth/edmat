/** Guardian accounts (AUDIENCE-BRIEF.md §2): a guardian makes, reads and removes a child's
 * account, and sees what the child wrote. Everything here is the guardian's own; a stranger's
 * request 404s. */
import { apiClient } from '$lib/api/client';

interface RawChild {
	id: number;
	username: string;
	display_name: string;
	is_active: boolean;
}
interface RawItem {
	id: number;
	body: string;
	created_at: string;
	held: boolean;
}

export interface Child {
	id: string;
	username: string;
	displayName: string;
	isActive: boolean;
}
export interface ChildContent {
	comments: { id: string; body: string; createdAt: string; held: boolean }[];
	posts: { id: string; body: string; createdAt: string; held: boolean }[];
}

function mapChild(c: RawChild): Child {
	return {
		id: String(c.id),
		username: c.username,
		displayName: c.display_name,
		isActive: c.is_active
	};
}

export async function getChildren(): Promise<Child[]> {
	const raw = await apiClient.get<RawChild[]>('/auth/children/');
	return raw.map(mapChild);
}
export async function createChild(
	username: string,
	password: string,
	displayName: string
): Promise<Child> {
	const c = await apiClient.post<RawChild>('/auth/children/', {
		username,
		password,
		display_name: displayName
	});
	return mapChild(c);
}
export async function deleteChild(id: string): Promise<void> {
	await apiClient.delete(`/auth/children/${id}/`);
}
/** Suspend (or reactivate) the child's account — reversible, short of deleting it: they cannot
 * sign in while suspended, and nothing they wrote is touched. */
export async function setChildActive(id: string, isActive: boolean): Promise<void> {
	await apiClient.patch(`/auth/children/${id}/`, { is_active: isActive });
}
export async function getChildContent(id: string): Promise<ChildContent> {
	const raw = await apiClient.get<{ comments: RawItem[]; posts: RawItem[] }>(
		`/auth/children/${id}/content/`
	);
	const row = (r: RawItem) => ({
		id: String(r.id),
		body: r.body,
		createdAt: r.created_at,
		held: !!r.held
	});
	return { comments: (raw.comments ?? []).map(row), posts: (raw.posts ?? []).map(row) };
}
export async function removeChildItem(
	id: string,
	kind: 'comment' | 'post',
	itemId: string
): Promise<void> {
	await apiClient.delete(`/auth/children/${id}/content/${kind}/${itemId}/`);
}
