// The one-off welcome card after registering (first-visitor audit finding 14, 2026-10-15: a new
// account landed on a homepage that looked exactly as it had signed out, with nothing saying that a
// confirmation mail was on its way or where to begin).
//
// Armed by the register page with the new account's id, read once by the root layout in onMount,
// and drawn by `WelcomeCard`. Kept in `localStorage`, not a flag on `/api/auth/me/`: the moment it
// marks — "this browser has just created this account" — happens on exactly one device, it needs no
// migration, no serializer field and no request, and if storage is unavailable the cost is a card
// that never shows, which is what everybody got before. The key is consumed the moment the card is
// drawn, so a reload does not bring it back: it is shown once, not until dismissed.

const KEY = 'edmat.welcome';

let pendingFor = $state<string | null>(null);

export const welcomeStore = {
	/** The account id the card is waiting to greet, or null. */
	get pendingFor(): string | null {
		return pendingFor;
	},
	/** Right after a successful registration. */
	arm(userId: string): void {
		pendingFor = userId;
		try {
			localStorage.setItem(KEY, userId);
		} catch {
			// Storage unavailable: the card still shows for this page view.
		}
	},
	/** From the root layout's onMount: a registration whose landing page was reloaded before the
	 *  card had a chance to draw. */
	load(): void {
		try {
			pendingFor = localStorage.getItem(KEY);
		} catch {
			pendingFor = null;
		}
	},
	/** The card has been drawn: forget it in storage, keep it on screen until dismissed. */
	consume(): void {
		try {
			localStorage.removeItem(KEY);
		} catch {
			// Nothing stored, nothing to forget.
		}
	},
	dismiss(): void {
		pendingFor = null;
		this.consume();
	}
};
