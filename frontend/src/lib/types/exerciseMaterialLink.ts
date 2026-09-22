import type { Material } from './material';
import type { ResolvedExercise } from './exercise';

/**
 * Which question a link answers. `source` — the exercise IS in that material (transcribed from it);
 * `practice` — it is not in the material at all, it practises what the material teaches.
 *
 * Mirrors `EXERCISE_LINK_ROLE_CHOICES` in backend/exercises/models.py. The labels live in
 * `lib/utils/labels.ts`, which names that file too — house rule 13: a mirrored enum says so on
 * both sides, because that is where drift creeps in.
 */
export type ExerciseLinkRole = 'source' | 'practice';

/**
 * One exercise attached to one material — a script this site hosts, or a proprietary book it only
 * links to. The same row is read from both ends, which is why `exercise` and `material` are each
 * optional: the material page's list carries the EXERCISE (and never the material it is already
 * on), and the exercise page's list carries the MATERIAL. Neither endpoint ever sends both.
 *
 * `addedByDisplayName` comes resolved from the API rather than as an id the page then looks up —
 * the same N+1-over-the-network that `ExerciseContributor` already avoids.
 */
export interface ExerciseMaterialLink {
	id: string;
	role: ExerciseLinkRole;
	/** "p. 34, ex. 3.2" — free text, because a scan, a slide deck and a recording each number
	 * their own parts differently. Empty when nobody said where. */
	locator: string;
	addedByUserId?: string;
	addedByDisplayName?: string;
	createdAt: string;
	exercise?: ResolvedExercise;
	material?: Material;
}
