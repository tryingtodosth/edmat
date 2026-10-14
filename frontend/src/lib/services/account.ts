/** Download my data, delete my account, and take a deletion back (`backend/accounts/erasure.py`,
 * `export.py`, `erasure_views.py`). The rules live server-side; this module only carries them. */
import { apiClient } from '$lib/api/client';
import type { RawProfile } from '$lib/api/mappers';

/** Mirrors `accounts.erasure.ACTIONS` / `GROUPS` in the backend — a hand-kept copy (house rule 13),
 * named from there too. Each group has an `account_what_<group>` and `account_why_<group>` message. */
export type ErasureAction = 'delete' | 'anonymise' | 'keep' | 'end';
export const ERASURE_ACTIONS: ErasureAction[] = ['delete', 'anonymise', 'keep', 'end'];

export interface ErasurePlanItem {
	group: string;
	action: ErasureAction;
	count: number;
}

export interface ErasureBlocker {
	kind: 'course' | 'event' | 'contest' | 'organization' | 'material_project';
	id: string;
	/** Organisations are addressed by slug. */
	slug?: string;
	title: string;
	reason: 'course_has_participants' | 'event_has_attendees' | 'contest_running' | 'sole_owner';
}

export interface ErasurePlan {
	status: 'none' | 'pending' | 'erasing';
	dueAt: string | null;
	graceDays: number;
	/** What the confirmation asks to be typed. */
	username: string;
	/** Why this account may not ask itself, or null: `guardian_managed` | `password_required`. */
	refusal: string | null;
	blockers: ErasureBlocker[];
	children: { id: string; displayName: string }[];
	plan: ErasurePlanItem[];
}

interface RawPlan {
	status: ErasurePlan['status'];
	due_at: string | null;
	grace_days: number;
	username: string;
	refusal: string | null;
	blockers: {
		kind: ErasureBlocker['kind'];
		id: number;
		slug?: string;
		title: string;
		reason: ErasureBlocker['reason'];
	}[];
	children: { id: number; display_name: string }[];
	plan: ErasurePlanItem[];
}

export async function getErasurePlan(): Promise<ErasurePlan> {
	const raw = await apiClient.get<RawPlan>('/auth/me/erasure/');
	return {
		status: raw.status,
		dueAt: raw.due_at,
		graceDays: raw.grace_days,
		username: raw.username,
		refusal: raw.refusal,
		blockers: raw.blockers.map((b) => ({ ...b, id: String(b.id) })),
		children: raw.children.map((c) => ({ id: String(c.id), displayName: c.display_name })),
		plan: raw.plan
	};
}

/** Switches the account off at once; erased after the grace period. Refusals arrive as an
 * `ApiError` whose body carries `reason` (and `blockers` for `blocked`). */
export async function requestErasure(
	password: string,
	username: string
): Promise<{ dueAt: string; graceDays: number }> {
	const raw = await apiClient.post<{ due_at: string; grace_days: number }>('/auth/me/erasure/', {
		password,
		username
	});
	return { dueAt: raw.due_at, graceDays: raw.grace_days };
}

/** From the sign-in page: cancel and get the session back in one step. */
export async function cancelErasureWithPassword(
	identifier: string,
	password: string
): Promise<{ token: string; profile: RawProfile }> {
	return apiClient.post<{ token: string; profile: RawProfile }>('/auth/erasure/cancel/', {
		username: identifier,
		password
	});
}

/** From the link in the notice mail: cancels only — a link in a mailbox is not a password. */
export async function cancelErasureWithToken(token: string): Promise<void> {
	await apiClient.post('/auth/erasure/cancel/', { token });
}

/** The whole export as a file the browser saves. */
export async function downloadMyData(): Promise<Blob> {
	return apiClient.getBlob('/auth/me/export/');
}
