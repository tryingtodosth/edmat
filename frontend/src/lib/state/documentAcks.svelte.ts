// One number, bumped whenever somebody acknowledges an event document somewhere on the page.
//
// It exists because a briefing can be acknowledged from TWO places at once: the Documents panel's
// own "Read and understood" button, and the interstitial the check-in panel raises when the API
// refuses with 409 `briefing_unread`. Those two components are siblings on the event page with no
// relationship to each other, and the panel is mounted at its own marker on purpose
// (CONFERENCE-BRIEF.md §4 rule 3), so threading a callback between them would mean editing the
// event page beyond the one line this step is allowed.
//
// The bug this fixes was found by LOOKING at an e2e screenshot rather than by any assertion (house
// rule 2): the volunteer acknowledged the briefing through the interstitial, check-in went through,
// and the Documents panel below it went on showing "1 still to read" for the rest of the visit,
// because its copy of the list had been fetched before the acknowledgement. The pill was lying.
//
// A counter rather than the acknowledged ids: what a reader needs is "something changed, re-read",
// and a number cannot drift out of step with the server the way a locally-patched list can
// (house rule 5's instinct, one layer up).

let version = $state(0);

export const documentAcks = {
	get version(): number {
		return version;
	},
	/** Call after a successful acknowledgement. Every mounted documents view re-reads. */
	bump(): void {
		version += 1;
	}
};
