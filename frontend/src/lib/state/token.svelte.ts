// The raw DRF auth token — deliberately its own tiny module, separate from auth.svelte.ts's own
// richer `User` state. lib/api/client.ts needs to READ the token (to attach it to every request's
// Authorization header) and lib/state/auth.svelte.ts needs to WRITE it (on login/register/logout) —
// if the token lived inside auth.svelte.ts itself, client.ts importing it would create a circular
// import (client.ts -> auth.svelte.ts -> client.ts, since auth.svelte.ts itself calls apiClient for
// its own login/register/logout requests). This module has no dependency on either, breaking the cycle.
//
// Persisted to localStorage — a deliberate Phase 3 change from Phase 1's own "session-only, a
// reload logs you out" mock-era choice (lib/state/auth.svelte.ts's original header comment): that
// was fine for a fake login with no real-world cost to losing on reload, but a real account against
// a real backend should survive a page refresh like any real app's login does.

const STORAGE_KEY = 'edmat-auth-token';

function readStored(): string | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
}

let token = $state<string | null>(readStored());

export const tokenStore = {
	get value(): string | null {
		return token;
	},
	set(next: string | null): void {
		token = next;
		if (typeof localStorage === 'undefined') return;
		try {
			if (next) localStorage.setItem(STORAGE_KEY, next);
			else localStorage.removeItem(STORAGE_KEY);
		} catch {
			// Best-effort persistence only — a failure here just means the session doesn't survive
			// a reload, not a broken app (mirrors theme.svelte.ts's own try/catch discipline).
		}
	}
};
