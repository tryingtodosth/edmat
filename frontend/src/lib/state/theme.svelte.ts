// Theme engine — a Svelte 5 rune module, the project's convention for global reactive state that
// isn't page-scoped. Three user-facing modes: 'light' | 'dark' | 'system' ('system' = follow the OS
// preference, the default until a visitor explicitly picks one via ThemeToggle). Persisted to
// localStorage — the one deliberate exception to "nothing survives a reload" in this mocked phase,
// since forgetting a dark-mode choice on every reload would be a real regression, not just honest
// mock-phase behavior. See src/app.html for the no-flash pre-hydration script this bootstraps from.

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'edmat-theme';

function getSystemPreference(): ResolvedTheme {
	if (typeof window === 'undefined') return 'light';
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStoredMode(): ThemeMode {
	if (typeof window === 'undefined') return 'system';
	try {
		const stored = window.localStorage.getItem(STORAGE_KEY);
		if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
	} catch {
		// localStorage can throw in a locked-down/private-browsing context — fall back silently.
	}
	return 'system';
}

let mode = $state<ThemeMode>(readStoredMode());
let systemPreference = $state<ResolvedTheme>(getSystemPreference());

function applyToDocument(resolved: ResolvedTheme) {
	if (typeof document === 'undefined') return;
	document.documentElement.setAttribute('data-theme', resolved);
}

export const themeStore = {
	get mode(): ThemeMode {
		return mode;
	},
	get resolved(): ResolvedTheme {
		return mode === 'system' ? systemPreference : mode;
	},
	setMode(next: ThemeMode): void {
		mode = next;
		try {
			window.localStorage.setItem(STORAGE_KEY, next);
		} catch {
			// Best-effort persistence only — a failure here just means the next reload falls back
			// to 'system', not a broken app.
		}
		applyToDocument(this.resolved);
	},
	/** Cycles light -> dark -> system -> light, for a single-button toggle UI. */
	cycle(): void {
		const order: ThemeMode[] = ['light', 'dark', 'system'];
		const next = order[(order.indexOf(mode) + 1) % order.length];
		this.setMode(next);
	},
	/** Wires the live OS-preference listener; call once from the root layout. */
	init(): () => void {
		applyToDocument(this.resolved);
		if (typeof window === 'undefined') return () => {};
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		const handler = (e: MediaQueryListEvent) => {
			systemPreference = e.matches ? 'dark' : 'light';
			if (mode === 'system') applyToDocument(systemPreference);
		};
		media.addEventListener('change', handler);
		return () => media.removeEventListener('change', handler);
	}
};
