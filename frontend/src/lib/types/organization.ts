// Organisations — management step A (MANAGEMENT-BRIEF.md §3.A). These unions MIRROR
// `backend/organizations/models.py` (`ORGANIZATION_KIND_CHOICES`, `ORGANIZATION_ROLE_CHOICES`,
// `LINK_KIND_CHOICES`) and that file names this one back (house rule 13); the human-readable label
// for each value lives in `lib/utils/labels.ts`, which says the same thing again from its side.

import type { NodeRef } from './node';

export type OrganizationKind =
	'university' | 'faculty' | 'school' | 'student_circle' | 'ngo' | 'company' | 'other';

/** Three fixed roles, never a checkbox permission editor (MANAGEMENT-BRIEF.md §1). An owner may
 *  rearrange the owners; an admin runs the roster and the links; a member is listed. */
export type OrganizationRole = 'owner' | 'admin' | 'member';

/** What the organisation is claiming. `runs` is "this is ours"; `supports` is "we are behind it". */
export type OrganizationLinkKind = 'runs' | 'supports';

/** A person as every roster here answers them: an id and a display name, never an email. */
export interface OrganizationPerson {
	id: string;
	displayName: string;
}

/** A list row and a badge. */
export interface OrganizationSummary {
	id: string;
	name: string;
	slug: string;
	kind: OrganizationKind;
	city: string;
	isActive: boolean;
	memberCount: number;
	linkCount: number;
}

/** The detail shape. `myRole` and `canManage` are the SERVER's answers — a page that decided for
 *  itself who may edit it is how a control appears for somebody the API then refuses. */
export interface Organization extends OrganizationSummary {
	description: string;
	website: string;
	createdBy: OrganizationPerson | null;
	createdAt: string;
	myRole: OrganizationRole | null;
	canManage: boolean;
}

export interface OrganizationMember {
	id: string;
	user: OrganizationPerson;
	role: OrganizationRole;
	addedBy: OrganizationPerson | null;
	addedAt: string;
}

/** A link reads back as its node's `NodeRef` rather than as a content type and an integer — the
 *  panel drawing it needs a title and a kind, and `config/nodes.py` is the one place that knows how
 *  to produce those for a course, an event or a material alike. */
export interface OrganizationLink {
	id: string;
	organization: OrganizationSummary;
	node: NodeRef | null;
	kind: OrganizationLinkKind;
	addedBy: OrganizationPerson | null;
	addedAt: string;
}

/** Every refusal word `backend/organizations/` can answer with (house rule 6). The frontend has a
 *  sentence for each in `ORGANIZATION_BLOCK_LABELS`. */
export type OrganizationBlockReason =
	| 'minor'
	| 'last_owner'
	| 'not_org_manager'
	| 'not_org_owner'
	| 'not_node_manager'
	| 'not_linkable'
	| 'already_linked'
	| 'already_member'
	| 'no_such_user';

export interface OrganizationDraft {
	name: string;
	kind: OrganizationKind;
	description?: string;
	website?: string;
	city?: string;
}
