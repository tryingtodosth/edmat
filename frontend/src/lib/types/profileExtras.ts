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
	branchSlug: string | null;
	disciplineSlug: string | null;
	order: number;
}

/** A credential a third party issued — and, unlike a `Diploma`, one this site has only the holder's
 * word for. There is deliberately no file on it: an uploaded scan is not evidence, while `url` is
 * checkable by the reader in one click. See `accounts.Certificate` for the full reasoning. */
export interface Certificate {
	id: string;
	title: string;
	issuer: string;
	issuedOn: string | null;
	/** null means it does not expire, which is genuinely different from a date that has passed. */
	expiresOn: string | null;
	credentialId: string;
	url: string;
	/** Answered by the server, so this and the editor cannot disagree about it. */
	isExpired: boolean;
	order: number;
}

/** Every kind the derived feed can produce. Mirrors `UserActivityView`'s own `kind` strings — the one
 * place drift between the two could creep in, so a new kind must be added in both. */
export type ActivityKind =
	| 'exercise'
	| 'material'
	| 'review'
	| 'service_review'
	| 'comment'
	| 'course_taught'
	| 'course_joined'
	| 'lesson_done'
	| 'saved_set';

export interface ActivityItem {
	kind: ActivityKind;
	title: string;
	exerciseId?: string;
	materialId?: string;
	courseId?: string;
	serviceId?: string;
	/** A set's slug, not a numeric id — that is what `/sets/[id]` resolves by. */
	setId?: string;
	setSize?: number;
	isPublic?: boolean;
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
	/** Per-kind totals, counted server-side from what THIS reader was given — so a summary tile can
	 * never advertise a row the feed itself withholds. */
	counts: Partial<Record<ActivityKind, number>>;
}
