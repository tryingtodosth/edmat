// Session state — a Svelte 5 rune module. Phase 3: real auth against the Django backend's
// TokenAuthentication (CLAUDE.md Section 18, resolved in Phase 2). The raw token itself lives in
// token.svelte.ts, not here — see that file's own header comment for why (breaks a circular import
// between this module and lib/api/client.ts, which both need the token).

import type { NotificationType, User } from '$lib/types';
import { apiClient, ApiError } from '$lib/api/client';
import { mapUser, NOTIFICATION_TYPE_REVERSE_MAP, type RawProfile } from '$lib/api/mappers';
import { tokenStore } from './token.svelte';

function deriveUsername(email: string): string {
	const local =
		email
			.split('@')[0]
			.toLowerCase()
			.replace(/[^a-z0-9._-]/g, '') || 'user';
	// A short random suffix, not a sequential counter — this frontend has no way to check username
	// availability ahead of submitting (only the backend's own `username already taken` validation
	// error would tell it), so the goal is just making a collision unlikely enough not to matter for
	// a prototype, not guaranteeing uniqueness outright.
	return `${local}-${Math.random().toString(36).slice(2, 8)}`;
}

let user = $state<User | null>(null);

export const authStore = {
	get user(): User | null {
		return user;
	},
	get isAuthenticated(): boolean {
		return user !== null;
	},
	get isModerator(): boolean {
		return user?.isModerator ?? false;
	},
	get isNodeGovernor(): boolean {
		return user?.isNodeGovernor ?? false;
	},
	/** True for either kind of moderation authority — a real global (is_staff) moderator, OR a
	 * node governor scoped to at least one Field/Course. This is the gate the moderation nav
	 * link/route itself uses; the "Governors" management tab on that page still checks
	 * `isModerator` specifically, since only a global moderator can grant/revoke the scoped role
	 * (CLAUDE.md's own documented v1 scope decision). */
	get canModerate(): boolean {
		return this.isModerator || this.isNodeGovernor;
	},

	/** Restores `user` from a persisted token on app start — call once from the root layout. A
	 * token that no longer validates (revoked, expired, or the account deleted) is cleared rather
	 * than left dangling. */
	async init(): Promise<void> {
		if (!tokenStore.value) return;
		try {
			const raw = await apiClient.get<RawProfile>('/auth/me/');
			user = mapUser(raw);
		} catch {
			tokenStore.set(null);
			user = null;
		}
	},

	async login(
		email: string,
		password: string
	): Promise<{ ok: true } | { ok: false; error: string }> {
		try {
			const res = await apiClient.post<{ token: string; profile: RawProfile }>('/auth/login/', {
				username: email, // the backend's LoginView resolves an email in this field to its real username
				password
			});
			tokenStore.set(res.token);
			user = mapUser(res.profile);
			return { ok: true };
		} catch {
			return { ok: false, error: 'invalidCredentials' };
		}
	},

	async register(
		displayName: string,
		email: string,
		password: string,
		preferredLocale: string
	): Promise<{ ok: true } | { ok: false; error: string }> {
		try {
			const res = await apiClient.post<{ token: string; profile: RawProfile }>('/auth/register/', {
				username: deriveUsername(email),
				email,
				password,
				display_name: displayName,
				preferred_locale: preferredLocale
			});
			tokenStore.set(res.token);
			user = mapUser(res.profile);
			return { ok: true };
		} catch (e) {
			if (e instanceof ApiError && e.body && typeof e.body === 'object' && 'email' in e.body) {
				return { ok: false, error: 'emailTaken' };
			}
			// Any other real validation failure (most commonly Django's own password-strength
			// rejection — DEMO_PASSWORD itself would fail this for a genuinely new account, since
			// it's a common password Django's validator specifically flags) surfaces as the same
			// generic error the register form already knows how to render, carrying the real
			// message from the backend rather than a made-up one.
			const message = e instanceof ApiError ? e.message : undefined;
			return { ok: false, error: message ?? 'registrationFailed' };
		}
	},

	logout(): void {
		const hadToken = Boolean(tokenStore.value);
		tokenStore.set(null);
		user = null;
		// Fire-and-forget — logout() is called synchronously from a plain onclick (Header.svelte),
		// and the local session is already cleared above regardless of whether this call succeeds;
		// invalidating the token server-side is a courtesy, not something the UI needs to wait on.
		if (hadToken) apiClient.post('/auth/logout/').catch(() => {});
	},

	/** PATCH /api/auth/me/ — self-service display name / locale / privacy / notification-preference
	 * editing (the settings page's own profile-and-privacy form). Replaces the whole local `user`
	 * object from the response rather than merging a partial patch client-side, since the backend
	 * already returns the complete, authoritative shape (accounts/views.py's MeView.patch). */
	async updateProfile(
		patch: Partial<{
			displayName: string;
			preferredLocale: string;
			showProfilePublicly: boolean;
			timeFormat: '24h' | '12h';
			weekStartsOn: 'monday' | 'sunday';
			notifyOnCommentReply: boolean;
			notifyOnModerationDecision: boolean;
			notifyOnContentAction: boolean;
			notifyOnCourseActivity: boolean;
			notifyOnBooking: boolean;
			mutedNotificationTypes: NotificationType[];
			offersTutoring: boolean;
			tutoringNote: string;
		}>
	): Promise<{ ok: true } | { ok: false; error: string }> {
		const body: Record<string, unknown> = {};
		if (patch.displayName !== undefined) body.display_name = patch.displayName;
		if (patch.preferredLocale !== undefined) body.preferred_locale = patch.preferredLocale;
		if (patch.showProfilePublicly !== undefined)
			body.show_profile_publicly = patch.showProfilePublicly;
		if (patch.timeFormat !== undefined) body.time_format = patch.timeFormat;
		if (patch.weekStartsOn !== undefined) body.week_starts_on = patch.weekStartsOn;
		if (patch.notifyOnCommentReply !== undefined)
			body.notify_on_comment_reply = patch.notifyOnCommentReply;
		if (patch.notifyOnModerationDecision !== undefined) {
			body.notify_on_moderation_decision = patch.notifyOnModerationDecision;
		}
		if (patch.notifyOnCourseActivity !== undefined)
			body.notify_on_course_activity = patch.notifyOnCourseActivity;
		if (patch.notifyOnBooking !== undefined) body.notify_on_booking = patch.notifyOnBooking;
		if (patch.notifyOnContentAction !== undefined)
			body.notify_on_content_action = patch.notifyOnContentAction;
		if (patch.mutedNotificationTypes !== undefined) {
			body.muted_notification_types = patch.mutedNotificationTypes.map(
				(t) => NOTIFICATION_TYPE_REVERSE_MAP[t]
			);
		}
		if (patch.offersTutoring !== undefined) body.offers_tutoring = patch.offersTutoring;
		if (patch.tutoringNote !== undefined) body.tutoring_note = patch.tutoringNote;
		try {
			const raw = await apiClient.patch<RawProfile>('/auth/me/', body);
			user = mapUser(raw);
			return { ok: true };
		} catch (e) {
			const message = e instanceof ApiError ? e.message : undefined;
			return { ok: false, error: message ?? 'updateFailed' };
		}
	},

	/** POST /api/auth/me/avatar/ — its own multipart endpoint, deliberately not part of
	 * `updateProfile`'s JSON PATCH above (see accounts/views.py's AvatarView for why the backend
	 * splits them). Takes an already-cropped square `Blob` from AvatarEditor's own canvas export.
	 *
	 * The crop happening client-side is a UX affordance, NOT a security boundary — the backend
	 * re-decodes and re-encodes whatever arrives here regardless of shape or claimed type, so a
	 * caller bypassing this function entirely gains nothing. */
	async uploadAvatar(blob: Blob): Promise<{ ok: true } | { ok: false; error: string }> {
		const formData = new FormData();
		// A filename is required for the browser to send this as a real file part rather than a
		// plain string field. The backend discards it and generates a UUID name of its own, so this
		// value is never trusted or stored — it only has to exist.
		formData.append('avatar', blob, 'avatar.webp');
		try {
			const raw = await apiClient.postForm<RawProfile>('/auth/me/avatar/', formData);
			user = mapUser(raw);
			return { ok: true };
		} catch (e) {
			const message = e instanceof ApiError ? e.message : undefined;
			return { ok: false, error: message ?? 'uploadFailed' };
		}
	},

	/** DELETE /api/auth/me/avatar/ — removes the stored file, not just the reference. */
	async removeAvatar(): Promise<{ ok: true } | { ok: false; error: string }> {
		try {
			const raw = await apiClient.delete<RawProfile>('/auth/me/avatar/');
			user = mapUser(raw);
			return { ok: true };
		} catch (e) {
			const message = e instanceof ApiError ? e.message : undefined;
			return { ok: false, error: message ?? 'updateFailed' };
		}
	}
};
