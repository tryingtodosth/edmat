/** What somebody has done, what they claim to be good at, and what they have been doing here. */

export type ExperienceKind = 'study' | 'work' | 'teaching' | 'project' | 'other';
export type SkillLevel = 'learning' | 'comfortable' | 'teaching';
/** What actually backs a skill claim. `registry` is never self-assignable — that value means an
 * institution said so, and letting somebody type it would make the distinction worthless. */
export type SkillEvidence = 'self_declared' | 'coursework' | 'registry';

export interface ExperienceEntry {
	id: string;
	kind: ExperienceKind;
	title: string;
	organisation: string;
	startedOn: string | null;
	/** null means ongoing, which is genuinely different from an unknown end date. */
	endedOn: string | null;
	description: string;
	order: number;
}

export interface SkillEntry {
	id: string;
	label: string;
	level: SkillLevel;
	evidence: SkillEvidence;
	courseSlug: string | null;
	fieldSlug: string | null;
	order: number;
}

export interface ActivityItem {
	kind: 'exercise' | 'review' | 'comment' | 'course_taught' | 'course_joined';
	title: string;
	exerciseId?: string;
	taughtCourseId?: string;
	rating?: number;
	tags: string[];
	/** null for the imported corpus, which carries no submission timestamp — those sort last rather
	 * than being given a fake date. */
	createdAt: string | null;
}

export interface ActivityFeed {
	items: ActivityItem[];
	/** Every tag present in this feed, so the filter offers only what would actually match. */
	tags: string[];
	kinds: string[];
}
