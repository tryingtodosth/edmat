// Platform-wide moderator "kill switches" (backend moderation/models.py's FeatureFlag) — a fixed,
// curated set of 7 keys, not a user-creatable list; see moderation/permissions.py's feature_gate
// for how each one actually blocks the feature it names, not just hides its own UI.
//
// `material_uploads_verified_only` is the one DIFFERENTLY-SHAPED exception in this set — every
// other key is a plain kill switch (isEnabled=true means "the feature is up"); this one instead
// means "the RESTRICTION to verified contributors is on" (backend's own
// RequireVerifiedContributorForMaterialUploads doc comment). The frontend doesn't need to treat it
// specially beyond that inverted READING of the boolean — the moderation page's own toggle UI is
// otherwise identical for every key.
export type FeatureFlagKey =
	| 'tutoring'
	// Was 'classroom' — the backend app (and this flag's own seeded key) was renamed to `courses`
	// (backend/CLAUDE.md's own "vocabulary rename" table), but this frontend union, the
	// FEATURE_FLAG_LABELS map, and every `can('classroom')` call site were never updated to match.
	// A real, reproduced bug this caused: `featureFlagsStore.isEnabled()` fails OPEN for an unknown
	// key (`flags[key]?.isEnabled ?? true`), so the courses nav link/homepage tab/search integration
	// silently ignored the real kill switch entirely — and on the moderation page, rendering a row
	// for the real `courses` flag through the stale `FEATURE_FLAG_LABELS['classroom']` lookup threw
	// "is not a function" and crashed the whole Flags tab the instant it was opened.
	| 'courses'
	| 'messaging'
	| 'exercise_submissions'
	| 'material_submissions'
	| 'events'
	| 'issues'
	// Anchored micro-posts on the activity feed (backend activity/). Off: the composer, every
	// post row in the feed, and the post pages all go.
	| 'posts'
	// Chemistry drawings (backend chem/, Ketcher). Off: the editor button leaves every composer and
	// the drawing API closes; pictures already in content keep rendering.
	| 'chemistry'
	| 'material_uploads_verified_only';

export interface FeatureFlag {
	key: FeatureFlagKey;
	isEnabled: boolean;
	updatedAt: string;
	updatedByDisplayName: string | null;
}
