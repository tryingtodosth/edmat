// A management NODE — one of the things work can hang off (MANAGEMENT-BRIEF.md §2). THIS UNION
// MIRRORS `backend/config/nodes.py`'s `NODE_KINDS`, and that file says so from its side; adding a
// kind is a change to both, in the same commit (house rule 13). `organization` is listed here from
// the start so that step A's page compiles against the same type everybody else reads.
export type NodeKind = 'course' | 'event' | 'material' | 'organization';

// What `GET /api/nodes/{kind}/{id}/` answers: enough for a panel to know what it is sitting on and
// whether to show its controls, and nothing a stranger could not already see on the node's own
// page (the endpoint 404s to anyone the node itself 404s to).
export interface NodeRef {
	kind: NodeKind;
	id: string;
	title: string;
	/** On the roster: course staff, event staff (and host), a project's members, an
	 *  organisation's members. */
	isStaff: boolean;
	/** Staff, or enrolled on the course / going to the event. For a material, the same as staff. */
	isMember: boolean;
	/** May run the thing: can_administer|can_curate, can_organise, a project's governors, an
	 *  organisation's owners and admins. */
	canManage: boolean;
}

// One person on a node's roster, as `GET /api/nodes/{kind}/{id}/staff/` lists them — the
// assignee / decider picker every management panel needs (staff-only, 404 to everyone else).
export interface NodeStaffMember {
	id: string;
	displayName: string;
}
