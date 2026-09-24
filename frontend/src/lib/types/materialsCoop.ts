// The cooperation overview of one material (backend materials_coop/): who does what on its
// project, under which policy, and what happened when.
//
// Everything here is DERIVED on the server from coauthoring's rows and filtered per row through
// that app's own visibility rule, so a reader's overview is built only from what they could reach
// anyway. The `MaterialProject` type stays the one for acting on a project; this is the one for
// looking at it as a team.
//
// The string unions mirror `backend/materials_coop/models.py` (`POLICY_CHOICES`) and
// `backend/materials_coop/overview.py` (`TIMELINE_KINDS`) exactly; the label maps live in
// `lib/components/coop/labels.ts`, which names the same files (house rule 13).

import type {
	JoinBlockReason,
	MaterialVersionSummary,
	ProjectMemberRole,
	ProposeBlockReason
} from './materialProject';

/** `open` is what every project was before the policy existed, and what a project with no
 *  settings row still is. `request` closes proposals to outsiders and opens applications;
 *  `closed` closes both. */
export type CoopPolicy = 'open' | 'request' | 'closed';

export type CoopTimelineKind =
	| 'version_drafted'
	| 'version_proposed'
	| 'version_published'
	| 'version_rejected'
	| 'version_withdrawn'
	| 'member_joined';

/** Why this person cannot write in the cooperation thread. */
export type CoopPostBlockReason = 'authentication_required' | 'members_only';

/** A team member, or (with `role` null) somebody outside the team whose work is in the history —
 *  an accepted proposal makes a contributor without making a co-author. Counts are recounts over
 *  the versions the READER may see, so the same person can show different numbers to a member and
 *  to a stranger, honestly. */
export interface CoopMember {
	userId: string;
	displayName: string;
	role: ProjectMemberRole | null;
	addedAt: string | null;
	versionsCount: number;
	publishedCount: number;
	lastActiveAt: string | null;
}

export interface CoopTimelineEvent {
	kind: CoopTimelineKind;
	at: string;
	actorId: string | null;
	actorDisplayName: string;
	versionId: string | null;
	versionNumber: number | null;
	/** The change note when there is one, else the version's title; empty for a membership. */
	label: string;
}

export interface CoopStats {
	versionsTotal: number;
	publishedCount: number;
	/** Members only; 0 for everybody else. */
	proposalsPending: number;
	/** Managers only; 0 for everybody else. */
	joinRequestsPending: number;
	membersCount: number;
	/** Members plus outside contributors. */
	contributorsCount: number;
	commentCount: number;
	firstPublishedAt: string | null;
	lastPublishedAt: string | null;
}

export interface CoopOverview {
	materialId: string | null;
	projectId: string;
	title: string;
	policy: CoopPolicy;
	welcomeNote: string;
	myRole: ProjectMemberRole | null;
	canEdit: boolean;
	canManage: boolean;
	canPropose: boolean;
	proposeBlockReason: ProposeBlockReason | null;
	joinBlockReason: JoinBlockReason | null;
	canPost: boolean;
	postBlockReason: CoopPostBlockReason | null;
	publishedVersion: MaterialVersionSummary | null;
	headVersion: MaterialVersionSummary | null;
	members: CoopMember[];
	contributors: CoopMember[];
	/** Newest first, only what the reader may see. */
	versions: MaterialVersionSummary[];
	pendingProposals: MaterialVersionSummary[];
	stats: CoopStats;
	timeline: CoopTimelineEvent[];
}

export interface CoopSettingsPatch {
	policy?: CoopPolicy;
	welcomeNote?: string;
}
