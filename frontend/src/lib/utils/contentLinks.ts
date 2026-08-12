/** Turning a pasted link into a real relation.
 *
 * Before this, filing something into a course meant knowing its numeric row id — which nobody does,
 * so in practice people pasted a link into the chapter's description and let the Markdown render it.
 * That works exactly once: the course cannot then tell you the exercise was unpublished, cannot show
 * the material's real title, cannot reorder it, and cannot include it in the course's own search.
 *
 * A link is nevertheless what people HAVE — it is in the address bar of the page they are looking
 * at. So the linking form accepts one, and this is the part that reads it. The result is a real
 * `CourseItem`, not a string in a description.
 *
 * Deliberately tolerant about the shape and strict about the meaning: a full URL from another
 * origin, a path, a locale-prefixed path, a trailing slash and a query string all resolve, because
 * all of them are things a person genuinely ends up with on the clipboard. What it will not do is
 * guess — an unrecognised shape returns null and the form says so, rather than filing something the
 * person did not mean.
 */

/** What a pasted reference turned out to be. `id` is a row id for the first three and a share slug
 * for a set, matching how each is addressed everywhere else in this app. */
export type ParsedContentRef =
	{ kind: 'exercise' | 'material' | 'discussion'; id: string } | { kind: 'set'; slug: string };

/** The kinds a person can choose to add. `attachment` and `event` are deliberately absent: an
 * attachment is uploaded through its own tab (it does not exist until then, so there is no link to
 * paste), and an event is added from the event itself. */
export type LinkableKind = ParsedContentRef['kind'];

/** Strips the origin, any locale prefix, the query and the trailing slash — leaving `/exercises/12`
 * from anything that meant it. The locale prefix has to go because Paraglide serves the same page at
 * `/pl/exercises/12`, and somebody reading the Polish interface copies the Polish URL. */
function normalisePath(raw: string): { path: string; hash: string } {
	let value = raw.trim();
	if (!value) return { path: '', hash: '' };

	// A full URL from any origin — including one that is not this app's, which is caught later by
	// the path simply not matching rather than by comparing hostnames. Comparing them would refuse a
	// perfectly good link copied from a staging deployment or from behind a reverse proxy.
	if (/^https?:\/\//i.test(value)) {
		try {
			const url = new URL(value);
			value = url.pathname + url.hash;
		} catch {
			return { path: '', hash: '' };
		}
	}

	const hashAt = value.indexOf('#');
	const hash = hashAt === -1 ? '' : value.slice(hashAt + 1);
	let path = (hashAt === -1 ? value : value.slice(0, hashAt)).split('?')[0];

	path = path.replace(/^\/(en|pl)(?=\/|$)/, '');
	if (!path.startsWith('/')) path = `/${path}`;
	path = path.replace(/\/+$/, '');
	return { path, hash };
}

const PATH_KINDS: Array<{ prefix: string; kind: 'exercise' | 'material' }> = [
	{ prefix: '/exercises/', kind: 'exercise' },
	{ prefix: '/materials/', kind: 'material' }
];

/**
 * Read a pasted link, or a bare id typed in the `kind` the caller already chose.
 *
 * `expected` is what the person picked in the form. It is used for the bare-id case only — a bare
 * number cannot say what it is — and NOT to overrule a link: pasting an exercise URL while the
 * select still says "material" means the select is stale, and the link is the more deliberate of
 * the two statements. The caller reads the returned `kind` back into the select rather than
 * refusing.
 */
export function parseContentRef(raw: string, expected: LinkableKind): ParsedContentRef | null {
	const value = raw.trim();
	if (!value) return null;

	// A bare row id. Only meaningful with a chosen kind, which is why the select stays even though
	// most people will paste — an id is what an admin has, and what an error message quotes back.
	if (/^\d+$/.test(value)) {
		return expected === 'set' ? null : { kind: expected, id: value };
	}

	const { path, hash } = normalisePath(value);
	if (!path) return null;

	// A comment has no page of its own — it hangs off whatever its thread hangs off — so the only
	// thing that identifies one in a URL is the anchor `CommentNode` renders, which is exactly what
	// its own "copy link" action produces. Checked before the path prefixes, because that URL is
	// also a perfectly good exercise or material URL and the fragment is the more specific half.
	const comment = /^comment-(\d+)$/.exec(hash);
	if (comment) return { kind: 'discussion', id: comment[1] };

	for (const { prefix, kind } of PATH_KINDS) {
		if (path.startsWith(prefix)) {
			const id = path.slice(prefix.length).split('/')[0];
			if (/^\d+$/.test(id)) return { kind, id };
			return null;
		}
	}

	if (path.startsWith('/sets/')) {
		const slug = path.slice('/sets/'.length).split('/')[0];
		// A set is addressed by its share slug everywhere in this app, never by a row id — so an
		// all-digits value here is a slug that happens to look numeric, not a pk.
		return slug ? { kind: 'set', slug } : null;
	}

	// A set the person is looking at in their own list, where the URL is the sharing page rather
	// than the set itself.
	if (path === '/my-set') return null;

	return null;
}

/** The anchor id `CommentNode` renders and `parseContentRef` reads back. One definition, so the two
 * halves cannot drift into different spellings of the same fragment. */
export function commentAnchorId(commentId: string): string {
	return `comment-${commentId}`;
}
