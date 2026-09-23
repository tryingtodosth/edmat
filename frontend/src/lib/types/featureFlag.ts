// Platform-wide moderator "kill switches" (backend moderation/models.py's FeatureFlag) — a fixed,
// curated set of 21 keys, not a user-creatable list; see moderation/permissions.py's feature_gate
// for how each one actually blocks the feature it names, not just hides its own UI.
//
// THIS UNION AND `FEATURE_FLAG_LABELS` (utils/labels.ts) BOTH MIRROR THE BACKEND'S OWN
// `FEATURE_FLAG_CHOICES`. Adding a key there means adding it in both places here, in the same
// change — the drift has already cost this project twice (see `classroom` below, and `galleries`,
// which was seeded by migration 0032 and left out of both, so the moderation page's Flags tab
// called `undefined()` and threw the moment it was opened). The label lookup now falls back to the
// raw key, so the next omission degrades to an ugly row rather than a white screen — that is a
// safety net, not permission to skip this file.
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
	// Freehand whiteboard sketches (backend sketches/, Excalidraw). Off: the Sketch button leaves
	// every composer and `/api/sketches/` closes for a non-staff caller; pictures already embedded
	// in content keep rendering, because by then they are ordinary media files.
	| 'sketches'
	// Picture galleries on a piece of content (backend galleries/). Off: no gallery, no adding a
	// picture, and the gallery strip leaves every content page.
	| 'galleries'
	// The age gate on self-registration (backend accounts/serializers.py's RegisterSerializer).
	// Off: /register stops asking for a year of birth and stops refusing an under-16. Deliberately
	// NOTHING else — the minors regime (accounts/minors.py) and Settings -> Children keep working
	// exactly as before, since neither has ever depended on this question.
	| 'age_verification'
	// Co-authoring a material (backend coauthoring/): the version history, a project's team, the
	// proposals readers send it, invites and join requests. Off: no project panel, no proposals, no
	// members/invites; creating a new material still answers to `material_submissions`, which is a
	// genuinely different ability (a flood of new uploads is not the same problem as a fight over
	// one document's text) — two abilities, two switches. Deliberately unable to hide content:
	// `Material` stays the published projection of whichever version is current, so every material
	// keeps rendering and downloading with this off.
	| 'coauthoring'
	// The wiki-like pages for the things exercises and materials are ABOUT (backend concepts/,
	// CONCEPTS-BRIEF.md §0). Off: the nav entry, the homepage tab, the "New concept" menu item, the
	// search section, the moderation tab and the linked-concept chip rows all go, and every concept
	// endpoint 403s a non-staff caller — with one deliberate exception,
	// `GET /api/concept-links/?target_type=…`, which answers `[]` so the exercise and material pages
	// keep working while showing nothing for it (house rule 3). A `[[slug]]` anchor already written
	// into somebody's content still renders; the page it leads to shows the gate.
	| 'concepts'
	// The six conference surfaces (CONFERENCE-BRIEF.md §0), seeded together by moderation migration
	// 0043 so that the seven parallel branches never each add a flag. Each closes its own app's
	// endpoints to a non-staff caller and takes its own links with it; the older events surfaces
	// (programme, registration, contributions) keep working with all six off.
	| 'venues'
	| 'event_documents'
	| 'tickets'
	| 'shifts'
	| 'cloakroom'
	| 'role_preview'
	| 'material_uploads_verified_only';

export interface FeatureFlag {
	key: FeatureFlagKey;
	isEnabled: boolean;
	updatedAt: string;
	updatedByDisplayName: string | null;
}
