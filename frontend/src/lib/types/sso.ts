// Sign in with Google / Apple / Microsoft (backend `sso/`, 2026-10-14). Mirrors
// `backend/sso/providers.py` (the ids) and `backend/sso/services.py: ERROR_CODES` (the refusal
// words) — said in both files (house rule 13). The words' sentences live in
// `lib/utils/labels.ts: SSO_ERROR_LABELS`.

/** Every provider the backend can know. A new one is a registry entry there and a mark here. */
export type SsoProviderId = 'google' | 'apple' | 'github' | 'facebook' | 'microsoft';

export interface SsoProvider {
	id: SsoProviderId;
	label: string;
}

export type SsoIntent = 'login' | 'link';

/** One provider account linked to the signed-in EdMat account (Settings → Sign-in methods). */
export interface SsoIdentity {
	id: string;
	provider: SsoProviderId;
	email: string;
	emailVerified: boolean;
	linkedAt: string;
	lastLoginAt: string | null;
}

export interface SsoIdentities {
	identities: SsoIdentity[];
	hasPassword: boolean;
}

/** What the complete-signup page pre-fills from a signup ticket. */
export interface SsoTicket {
	provider: SsoProviderId;
	email: string;
	emailVerified: boolean;
	suggestedName: string;
	suggestedUsername: string;
	asksAge: boolean;
	expiresAt: string;
}
