// Platform-wide moderator "kill switches" (backend moderation/models.py's FeatureFlag) — a fixed,
// curated set of 6 keys, not a user-creatable list; see moderation/permissions.py's feature_gate
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
	| 'classroom'
	| 'messaging'
	| 'exercise_submissions'
	| 'material_submissions'
	| 'material_uploads_verified_only';

export interface FeatureFlag {
	key: FeatureFlagKey;
	isEnabled: boolean;
	updatedAt: string;
	updatedByDisplayName: string | null;
}
