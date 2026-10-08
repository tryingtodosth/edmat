// Where a management node's own page is — the one answer four pages had each written for
// themselves (the plan page, the work dashboard, and now the task page and the task board's
// modal: house rule 13's third strike). Two of the copies disagreed, and one was wrong for an
// organisation, whose route is its SLUG and not its id (`/organizations/[slug]`); `config/nodes.py:
// node_ref` carries `slug` for that kind since 2026-10-08 so this can be a string operation.
import { resolve } from '$app/paths';
import { localizedPath } from '$lib/utils/localizedPath';
import type { NodeRef } from '$lib/types/node';

/** The project's own organisation (`work/edmat_project.py: ORGANIZATION_SLUG`), whose page is
 *  `/about` rather than `/organizations/edmat` — the same component behind both routes, but the
 *  first is the address people have. */
const PROJECT_SLUG = 'edmat';

export function nodeHref(node: NodeRef | null | undefined): string {
	if (!node) return resolve('/');
	switch (node.kind) {
		case 'course':
			return resolve('/courses/[id]', { id: node.id });
		case 'event':
			return resolve('/events/[id]', { id: node.id });
		case 'material':
			return localizedPath(resolve('/materials/[id]', { id: node.id }));
		case 'organization':
			if (!node.slug) return resolve('/organizations');
			if (node.slug === PROJECT_SLUG) return resolve('/about');
			return resolve('/organizations/[slug]', { slug: node.slug });
	}
}
