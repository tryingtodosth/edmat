// Sign in with Google / Apple / Microsoft (backend `sso/`, `sso/CLAUDE.md`).
//
// The flow, from this side: `startSso` asks the backend for the provider's authorization URL and a
// one-off BROWSER KEY, keeps the key in this tab's sessionStorage, and sends the tab to the provider.
// The provider sends it back through the backend's callback, which redirects to `/auth/sso/done`
// (a two-minute code) or `/auth/sso/complete` (a signup ticket). Neither is worth anything without
// the key — that is what stops a forwarded callback link from signing somebody into an account
// that is not theirs. No token ever travels in a URL.

import { apiClient } from '$lib/api/client';
import type { RawProfile } from '$lib/api/mappers';
import type {
	SsoIdentities,
	SsoIdentity,
	SsoIntent,
	SsoProvider,
	SsoProviderId,
	SsoTicket
} from '$lib/types/sso';

const KEY = 'edmat.sso.browserKey';

function storeKey(key: string): void {
	try {
		sessionStorage.setItem(KEY, key);
	} catch {
		/* storage refused: the done page will say the link did not work, which is the truth */
	}
}

function readKey(): string {
	try {
		return sessionStorage.getItem(KEY) ?? '';
	} catch {
		return '';
	}
}

/** Forget the key once its code or ticket has been used — it belongs to one round trip. */
export function forgetSsoKey(): void {
	try {
		sessionStorage.removeItem(KEY);
	} catch {
		/* nothing to forget */
	}
}

/** The providers to draw a button for. Empty when none is configured or the switch is off. */
export async function getSsoProviders(): Promise<SsoProvider[]> {
	const res = await apiClient.get<{ providers: SsoProvider[] }>('/auth/sso/providers/');
	return res.providers;
}

/** Returns the URL to send the tab to; the caller does `window.location.assign`. */
export async function startSso(
	provider: SsoProviderId,
	intent: SsoIntent,
	next: string
): Promise<string> {
	const res = await apiClient.post<{ authorization_url: string; browser_key: string }>(
		`/auth/sso/${provider}/start/`,
		{ intent, next }
	);
	storeKey(res.browser_key);
	return res.authorization_url;
}

type RawIdentity = {
	id: number;
	provider: SsoProviderId;
	email: string;
	email_verified: boolean;
	linked_at: string;
	last_login_at: string | null;
};

function toIdentity(raw: RawIdentity): SsoIdentity {
	return {
		id: String(raw.id),
		provider: raw.provider,
		email: raw.email,
		emailVerified: raw.email_verified,
		linkedAt: raw.linked_at,
		lastLoginAt: raw.last_login_at
	};
}

export type SsoExchangeResult =
	| { kind: 'login'; token: string; rawProfile: RawProfile; next: string }
	| { kind: 'link'; identity: SsoIdentity; next: string };

/** Redeems the done page's code. Throws `ApiError` with `detail` 'code_invalid' |
 *  'wrong_account' | 'account_inactive' | 'already_linked'. */
export async function exchangeSsoCode(code: string): Promise<SsoExchangeResult> {
	const raw = await apiClient.post<
		| { kind: 'login'; token: string; profile: RawProfile; next: string }
		| { kind: 'link'; identity: RawIdentity; next: string }
	>('/auth/sso/exchange/', { code, browser_key: readKey() });
	if (raw.kind === 'login') {
		return {
			kind: 'login',
			token: raw.token,
			rawProfile: raw.profile,
			next: raw.next
		};
	}
	return { kind: 'link', identity: toIdentity(raw.identity), next: raw.next };
}

/** Throws `ApiError` with `detail: 'ticket_invalid'` for a ticket that is used, expired or not
 *  this tab's. */
export async function getSsoTicket(ticket: string): Promise<SsoTicket> {
	const raw = await apiClient.post<{
		provider: SsoProviderId;
		email: string;
		email_verified: boolean;
		suggested_name: string;
		suggested_username: string;
		asks_age: boolean;
		expires_at: string;
	}>('/auth/sso/ticket/', { ticket, browser_key: readKey() });
	return {
		provider: raw.provider,
		email: raw.email,
		emailVerified: raw.email_verified,
		suggestedName: raw.suggested_name,
		suggestedUsername: raw.suggested_username,
		asksAge: raw.asks_age,
		expiresAt: raw.expires_at
	};
}

/** Creates the account. Throws `ApiError` whose body names the field that failed:
 *  `username` ('taken' | 'invalid' | 'required' | 'too_long'), `birth_year` ('guardian_required'
 *  | 'required' | 'invalid'), `accept_terms` ('terms_required'), or `detail` ('ticket_invalid' |
 *  'email_in_use' | 'already_linked'). */
export async function completeSsoSignup(input: {
	ticket: string;
	username: string;
	displayName: string;
	birthYear?: number;
	acceptTerms: boolean;
	preferredLocale: string;
}): Promise<{ token: string; rawProfile: RawProfile; next: string }> {
	const raw = await apiClient.post<{ token: string; profile: RawProfile; next: string }>(
		'/auth/sso/complete/',
		{
			ticket: input.ticket,
			browser_key: readKey(),
			username: input.username,
			display_name: input.displayName,
			birth_year: input.birthYear,
			accept_terms: input.acceptTerms,
			preferred_locale: input.preferredLocale
		}
	);
	return { token: raw.token, rawProfile: raw.profile, next: raw.next };
}

export async function getSsoIdentities(): Promise<SsoIdentities> {
	const raw = await apiClient.get<{ identities: RawIdentity[]; has_password: boolean }>(
		'/auth/sso/identities/'
	);
	return { identities: raw.identities.map(toIdentity), hasPassword: raw.has_password };
}

/** Throws `ApiError` 409 `detail: 'set_password_first'` when this is the account's last way in. */
export async function unlinkSsoIdentity(id: string): Promise<void> {
	await apiClient.delete(`/auth/sso/identities/${id}/`);
}
