// Platform-wide moderator "kill switches" (backend moderation/models.py's FeatureFlag) — a fixed,
// curated set of 4 keys, not a user-creatable list; see moderation/permissions.py's feature_gate
// for how each one actually blocks the feature it names, not just hides its own UI.

export type FeatureFlagKey =
	'tutoring' | 'messaging' | 'exercise_submissions' | 'material_submissions';

export interface FeatureFlag {
	key: FeatureFlagKey;
	isEnabled: boolean;
	updatedAt: string;
	updatedByDisplayName: string | null;
}
