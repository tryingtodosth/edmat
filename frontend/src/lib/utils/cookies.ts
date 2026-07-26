// Plain document.cookie helpers — SSR-guarded the same way theme.svelte.ts's own localStorage
// reads already are, since `document` doesn't exist during server-side rendering. Used by
// cookieConsent.svelte.ts to persist a visitor's consent choice as an actual cookie rather than
// localStorage, on purpose: a consent record is the one thing in this app that arguably SHOULD be
// readable server-side one day (a future hooks.server.ts respecting it before setting anything
// itself), the same reasoning the Paraglide i18n scaffold this project's own i18n setup was copied
// from already uses a cookie (PARAGLIDE_LOCALE) for locale persistence rather than localStorage.

export function getCookie(name: string): string | null {
	if (typeof document === 'undefined') return null;
	const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
	return match ? decodeURIComponent(match[1]) : null;
}

export function setCookie(name: string, value: string, maxAgeSeconds: number): void {
	if (typeof document === 'undefined') return;
	document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`;
}
