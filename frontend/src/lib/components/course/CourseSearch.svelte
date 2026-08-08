<script lang="ts">
	// Finding something inside one course.
	//
	// It sits above the tabs rather than inside one because what it finds is spread across all of
	// them: a chapter is on Content, a file is on Attachments, a reply is on Discussion, and somebody
	// who cannot remember which will not think to pick the right tab first.
	//
	// The server does the searching, not this component. Two reasons, and the second is the load-
	// bearing one: the page only ever holds what the viewer may see of the course CONTENT, and the
	// discussion is fetched separately and only when its tab is open — so a client-side filter would
	// silently never match a comment, which is exactly what "where did we talk about that" is asking
	// for. Everything here is presentation over what the search endpoint already decided.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { searchCourse } from '$lib/services/course';
	import type { Course, CourseSearchHit, CourseSearchKind } from '$lib/types/course';

	let { course }: { course: Course } = $props();

	let query = $state('');
	let hits = $state<CourseSearchHit[]>([]);
	let terms = $state<string[]>([]);
	let truncated = $state(false);
	let searching = $state(false);
	let searched = $state(false);
	let failed = $state(false);

	/** Two characters, mirroring `MIN_QUERY_LENGTH` server-side. Checked here as well so a single
	 * letter costs no request at all — the server still refuses it, and says why, so this is a saved
	 * round trip rather than the rule itself living in the client. */
	const MIN_LENGTH = 2;

	const DEBOUNCE_MS = 250;
	let timer: ReturnType<typeof setTimeout> | undefined;

	/** Which request the answer on screen belongs to.
	 *
	 * Debouncing alone does not stop out-of-order results: typing `ca` then `cauchy` fires two
	 * requests, and nothing guarantees the first finishes first. Without this counter the narrower
	 * query's results can be overwritten by the broader one that was already in flight, so the list
	 * would not match the box. */
	let issued = 0;

	function schedule() {
		clearTimeout(timer);
		const trimmed = query.trim();
		if (trimmed.length < MIN_LENGTH) {
			// Not merely "do not search": clear what is there, or a stale result list sits under a box
			// that no longer says what produced it.
			issued += 1;
			hits = [];
			terms = [];
			truncated = false;
			searching = false;
			searched = false;
			failed = false;
			return;
		}
		searching = true;
		timer = setTimeout(() => void run(trimmed), DEBOUNCE_MS);
	}

	async function run(trimmed: string) {
		const mine = ++issued;
		try {
			const result = await searchCourse(course.id, trimmed);
			if (mine !== issued) return;
			hits = result.hits;
			terms = result.terms;
			truncated = result.truncated;
			failed = false;
		} catch {
			if (mine !== issued) return;
			// A search that fails should say so rather than render as "nothing matched" — the two mean
			// very different things to somebody who is sure the thing is there.
			hits = [];
			failed = true;
		} finally {
			if (mine === issued) {
				searching = false;
				searched = true;
			}
		}
	}

	function clear() {
		query = '';
		schedule();
	}

	/** The order groups are shown in: the course, then its structure, then what is filed in it, then
	 * the conversation. Roughly outermost-first, which is also how the page itself reads. */
	const GROUP_ORDER: CourseSearchKind[] = [
		'course',
		'chapter',
		'lesson',
		'item',
		'attachment',
		'comment'
	];

	let groups = $derived(
		GROUP_ORDER.map((kind) => ({ kind, rows: hits.filter((hit) => hit.kind === kind) })).filter(
			(group) => group.rows.length > 0
		)
	);

	function groupLabel(kind: CourseSearchKind): string {
		switch (kind) {
			case 'course':
				return m.courseSearch_group_course(); // "This course"
			case 'chapter':
				return m.courseSearch_group_chapter(); // "Chapters"
			case 'lesson':
				return m.courseSearch_group_lesson(); // "Sessions"
			case 'item':
				return m.courseSearch_group_item(); // "Content"
			case 'attachment':
				return m.courseSearch_group_attachment(); // "Files"
			default:
				return m.courseSearch_group_comment(); // "Discussion"
		}
	}

	/** Which field matched, in words. A snippet on its own does not say whether the words were in a
	 * title, in the participant notes or in somebody's reply, and that is often the answer. */
	function fieldLabel(hit: CourseSearchHit): string {
		if (hit.field === 'participant_notes') return m.courseSearch_field_notes(); // "in the notes"
		if (hit.field === 'note') return m.courseSearch_field_curatorNote(); // "in the note"
		if (hit.field === 'summary' || hit.field === 'description')
			return m.courseSearch_field_description(); // "in the description"
		if (hit.field === 'body') return m.courseSearch_field_comment(); // "in a comment"
		return m.courseSearch_field_title(); // "in the title"
	}

	const contentTab = $derived(`${resolve('/courses/[id]', { id: course.id })}?tab=content`);

	/** Where clicking a hit goes.
	 *
	 * Content, chapters and sessions live on this page, so those are hash links into it — which is why
	 * `CourseContent` grew ids. Everything else has a page of its own and gets a real link there: an
	 * exercise, a material and an event are corpus rows a course merely points at, and a course file
	 * has its own page with its own thread. */
	function href(hit: CourseSearchHit): string | null {
		switch (hit.kind) {
			case 'course':
				return '#course-overview';
			case 'chapter':
				return `${contentTab}#course-chapter-${hit.id}`;
			case 'lesson':
				return `${contentTab}#course-lesson-${hit.id}`;
			case 'attachment':
				return resolve('/courses/[id]/attachments/[attachmentId]', {
					id: course.id,
					attachmentId: hit.id
				});
			case 'item':
				return itemHref(hit);
			case 'comment':
				return threadHref(hit);
			default:
				return null;
		}
	}

	function itemHref(hit: CourseSearchHit): string | null {
		if (!hit.targetId) return null;
		if (hit.itemKind === 'exercise') return resolve('/exercises/[id]', { id: hit.targetId });
		if (hit.itemKind === 'material') return resolve('/materials/[id]', { id: hit.targetId });
		if (hit.itemKind === 'event') return resolve('/events/[id]', { id: hit.targetId });
		return resolve('/courses/[id]/attachments/[attachmentId]', {
			id: course.id,
			attachmentId: hit.targetId
		});
	}

	function threadHref(hit: CourseSearchHit): string | null {
		const thread = hit.thread;
		if (!thread) return null;
		if (thread.kind === 'course')
			return `${resolve('/courses/[id]', { id: course.id })}?tab=discussion`;
		if (thread.kind === 'lesson') return `${contentTab}#course-lesson-${thread.id}`;
		if (thread.kind === 'chapter') return `${contentTab}#course-chapter-${thread.id}`;
		return resolve('/courses/[id]/attachments/[attachmentId]', {
			id: course.id,
			attachmentId: thread.id
		});
	}

	/** A snippet split into plain runs and matched runs, so the matched words can be marked.
	 *
	 * Segments rather than a string of `<mark>` tags and `{@html}`: the snippet is user-written text
	 * from a description or somebody's comment, and building markup around it would be handing that
	 * text to the HTML parser. Rendering `<mark>` elements around plain text nodes cannot inject
	 * anything, whatever the text says.
	 *
	 * Matching uses the folded terms the server already handed back — `toLocaleLowerCase()` on both
	 * sides, which is the browser's nearest equivalent to the `casefold()` those terms came from, so
	 * `ĆWICZENIA` highlights for `ćwiczenia` rather than only the server knowing they matched. */
	function segments(snippet: string): { text: string; hit: boolean }[] {
		if (terms.length === 0 || !snippet) return [{ text: snippet, hit: false }];
		const haystack = snippet.toLocaleLowerCase();
		// One boundary set rather than one pass per term: overlapping terms would otherwise produce
		// nested or duplicated runs.
		const marked = new Array<boolean>(snippet.length).fill(false);
		for (const term of terms) {
			if (!term) continue;
			let from = haystack.indexOf(term);
			while (from !== -1) {
				for (let i = from; i < from + term.length; i += 1) marked[i] = true;
				from = haystack.indexOf(term, from + term.length);
			}
		}
		const out: { text: string; hit: boolean }[] = [];
		for (let i = 0; i < snippet.length; i += 1) {
			const last = out[out.length - 1];
			if (last && last.hit === marked[i]) last.text += snippet[i];
			else out.push({ text: snippet[i], hit: marked[i] });
		}
		return out;
	}

	/** The line under a hit saying where it sits.
	 *
	 * Never repeats the hit's own title, which the first version did: a chapter carries itself as its
	 * location, so the panel printed "Ćwiczenia wstępne" as the row and then again underneath it. A
	 * chapter is its own place, a session's place is its chapter, and only an item is properly two
	 * levels down. Caught by reading a screenshot rather than by any assertion. */
	function where(hit: CourseSearchHit): string {
		if (hit.kind === 'comment' && hit.thread) {
			return m.courseSearch_inThread({ thread: hit.thread.title }); // "in the discussion on {thread}"
		}
		if (hit.kind === 'chapter') return '';
		if (hit.kind === 'lesson') return hit.chapter?.title ?? '';
		if (hit.lesson && hit.chapter) return `${hit.chapter.title} › ${hit.lesson.title}`;
		return hit.chapter?.title ?? '';
	}
</script>

<section class="course-search">
	<label class="field">
		<span>{m.courseSearch_label()}</span>
		<!-- "Search in this course" -->

		<!-- type="search" rather than text: it is what the control is, and it gets the platform's own
		     clear affordance on the browsers that draw one. -->
		<input
			type="search"
			bind:value={query}
			oninput={schedule}
			placeholder={m.courseSearch_placeholder()}
			autocomplete="off"
		/>
	</label>

	<!-- One live region for every state, so a screen reader hears the outcome change rather than only
	     the results appearing silently below. -->
	<p class="status" role="status" aria-live="polite">
		{#if query.trim().length > 0 && query.trim().length < MIN_LENGTH}
			{m.courseSearch_tooShort({ count: MIN_LENGTH })}
			<!-- "Type at least {count} characters." -->
		{:else if searching}
			{m.common_loading()}
			<!-- "Loading…" -->
		{:else if failed}
			{m.common_error_generic()}
			<!-- "Something went wrong." -->
		{:else if searched && hits.length === 0}
			{m.courseSearch_noResults({ query: query.trim() })}
			<!-- "Nothing in this course matches “{query}”." -->
		{:else if searched}
			{m.courseSearch_resultCount({ count: hits.length })}
			<!-- "Found: {count}" -->
		{/if}
	</p>

	{#if truncated}
		<p class="note">{m.courseSearch_truncated()}</p>
		<!-- "Showing the first matches only — there are more." -->
	{/if}

	{#if groups.length > 0}
		<div class="results">
			{#each groups as group (group.kind)}
				<section class="group">
					<h3>{groupLabel(group.kind)} <span class="count">{group.rows.length}</span></h3>
					<ul>
						{#each group.rows as hit (`${hit.kind}-${hit.id}`)}
							{@const target = href(hit)}
							<li>
								<p class="hit__head">
									{#if target}
										<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a resolved route plus a query string and an in-page anchor, which resolve() cannot express -->
										<a href={target} onclick={clear}>{hit.title}</a>
									{:else}
										<span>{hit.title}</span>
									{/if}
									<span class="field-label">{fieldLabel(hit)}</span>
									{#if hit.status === 'pending'}
										<!-- Staff and the submitter are the only people who can see one of these, so
										     saying it is still waiting is information rather than noise. -->
										<span class="pill">{m.course_item_pending()}</span>
										<!-- "Waiting for review" -->
									{/if}
									{#if hit.kind === 'chapter' && hit.isUnlocked === false}
										<span class="pill">{m.courseSearch_locked()}</span>
										<!-- "Not open yet" -->
									{/if}
								</p>
								{#if hit.snippet}
									<!-- Printed as text, never rendered: this is a slice out of the middle of
									     Markdown, so rendering it would be rendering a fragment whose tags do not
									     balance. The server already stripped the markup for legibility. -->
									<p class="snippet">
										{#each segments(hit.snippet) as part, index (index)}{#if part.hit}<mark
													>{part.text}</mark
												>{:else}{part.text}{/if}{/each}
									</p>
								{/if}
								{#if where(hit)}
									<p class="where">{where(hit)}</p>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	{/if}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	// Token names are the ones _theme.scss actually defines (`--border-color`, `--bg-surface`,
	// `--text-secondary`, …). The first version of this file invented a `--color-*` set that does not
	// exist here, so every rule using one silently fell back to nothing and the panel rendered with no
	// card at all — caught by looking at a screenshot, since nothing about it fails a type check.
	.course-search {
		margin: var(--space-4) 0;
		padding: var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);

		span {
			font-size: var(--font-size-sm);
			font-weight: 600;
			color: var(--text-secondary);
		}

		input {
			@include mix.focus-ring;
			padding: var(--space-1) var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-page);
			color: var(--text-primary);
			font: inherit;
		}
	}

	.status {
		// A fixed minimum height so the results below do not jump up and down as the line changes
		// between "Loading…", a count and nothing.
		margin: var(--space-2) 0 0;
		min-height: 1.2em;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}

	.note {
		margin: var(--space-1) 0 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}

	.results {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-top: var(--space-2);
	}

	.group h3 {
		margin: 0 0 var(--space-1);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}

	.count {
		font-weight: 400;
		opacity: 0.8;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	li {
		padding-left: var(--space-2);
		border-left: 3px solid var(--border-color);
	}

	.hit__head {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2);
	}

	.field-label {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}

	.pill {
		font-size: var(--font-size-xs);
		padding: 0 var(--space-1);
		border-radius: 999px;
		border: 1px solid var(--border-color);
		color: var(--text-secondary);
	}

	.snippet {
		margin: var(--space-1) 0 0;
		font-size: var(--font-size-sm);
		color: var(--text-primary);

		mark {
			// The browser default is a fixed yellow, unreadable against the dark theme's own text
			// colour. `--accent-soft` is the theme's own tint of the accent and works in both.
			background: var(--accent-soft);
			color: inherit;
			border-radius: var(--radius-sm);
		}
	}

	.where {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
</style>
