// Whether this account may FOUND a course, an event, a tutoring listing or an organisation —
// `GET /api/creation/`, asked once per signed-in session (learning step F,
// prompts/07-creation-gate.md). The Header drives it, because the Header is mounted once for the
// whole app (`routes/+layout.svelte`), so every page — including a `…/new` page opened directly
// from a link — can read the answer without asking again.
//
// A rune module rather than a `$derived` in `Header.svelte`, for the reason
// `venueStaff.svelte.ts` and `notifications.svelte.ts` already establish: one fetch for the app,
// not one per route.
//
// **Three states, not two, and that is the whole design.** "Allowed", "refused, because X" and
// "we have not been told yet" are genuinely different, and collapsing the third into either of the
// other two produces a lie on screen:
//
//   - collapsed into ALLOWED, a refused account is shown a "Run a course" button that answers 403
//     when pressed — exactly what house rule 3 exists to prevent;
//   - collapsed into REFUSED, a verified contributor reads "new courses are started by verified
//     contributors" about themselves for as long as the request takes.
//
// So before the answer arrives `allows()` is false AND `reasonFor()` is null: the hub draws neither
// the button nor the sentence, which is the one honest thing to draw when nothing is known. The
// same applies to a failed request — a server that cannot answer this cannot accept the creation
// either, so the control stays away rather than appearing and failing.
//
// A signed-OUT reader is a deliberate exception: `allows()` is true for them, because the refusal
// they would meet is `anonymous`, and the four `…/new` pages already answer that with a sign-in
// prompt, which is a better destination than a missing menu entry. The hubs hide their create
// buttons from a signed-out reader on their own (`authStore.isAuthenticated`) and always did.

import { getCreationStatus } from '$lib/services/creation';
import type { CreationBlockReason, CreationKind, CreationStatus } from '$lib/types/creation';

let status = $state<CreationStatus | null>(null);
let signedOut = $state(false);
let loadedForUser = $state<string | null>(null);

export const creationStore = {
	/** Whether an answer (or a known signed-out context) is in hand. A page that wants to say "we
	 *  are still asking" rather than nothing at all can read this; none does today. */
	get ready(): boolean {
		return status !== null || signedOut;
	},

	/** May this account found a `kind`? False while nothing is known — see the module comment. */
	allows(kind: CreationKind): boolean {
		if (status !== null) return status[kind] === null;
		return signedOut;
	},

	/** Why not — or `null` when it may, when it is signed out, or when nothing is known yet. One
	 *  word, which `gateReasonLabel` turns into a sentence (house rule 6). */
	reasonFor(kind: CreationKind): CreationBlockReason | null {
		return status === null ? null : status[kind];
	},

	/** Idempotent per account, so an `$effect` in the header may call it on every run. `null` means
	 *  signed out: it clears the answer and records that, which is what makes `allows()` true again
	 *  for a visitor (the same `ensureLoaded(userId | null)` shape `venueStaffStore` and
	 *  `moderationQueueStore` use, so the header needs no guard of its own). */
	async ensureLoaded(userId: string | null): Promise<void> {
		if (userId === null) {
			status = null;
			loadedForUser = null;
			signedOut = true;
			return;
		}
		if (loadedForUser === userId) return;
		loadedForUser = userId;
		signedOut = false;
		try {
			status = await getCreationStatus();
		} catch {
			// Fails CLOSED (see the module comment): no answer means no button.
			status = null;
		}
	},

	/** Signing out, from the header's `logout()` alongside every other per-account store. */
	clear(): void {
		status = null;
		loadedForUser = null;
		signedOut = true;
	}
};
