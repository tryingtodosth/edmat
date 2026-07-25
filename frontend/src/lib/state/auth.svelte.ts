// Session state — a Svelte 5 rune module. Phase 3: real auth against the Django backend's
// TokenAuthentication (CLAUDE.md Section 18, resolved in Phase 2). The raw token itself lives in
// token.svelte.ts, not here — see that file's own header comment for why (breaks a circular import
// between this module and lib/api/client.ts, which both need the token).

import type { User } from '$lib/types';
import { apiClient, ApiError } from '$lib/api/client';
import { mapUser, type RawProfile } from '$lib/api/mappers';
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
	}
};
