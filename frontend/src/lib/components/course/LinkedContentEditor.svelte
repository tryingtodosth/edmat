<script lang="ts">
	// What a chapter or a lesson actually points at, edited where you edit the chapter or lesson.
	//
	// The thing this replaces is a link pasted into the description, which is the only way a course
	// could reference anything before there was a picker: it renders, and that is all it does. A real
	// link is a row (`CourseItem`, or `LessonExerciseSet` for a whole set), so the course can show
	// the material's live title, drop an exercise a moderator has pulled, order it against everything
	// else in the week, and find it in the course's own search. None of that is available to a string
	// in a paragraph.
	//
	// So the form takes the thing people actually have — the address of the page they are looking at
	// — and turns it into that row. `contentLinks.ts` does the reading; this is the surface.
	//
	// Deliberately dumb about the network: it hands the parent a parsed reference and lets the page
	// own the request, matching `AddCoverageForm` and `RequirementsEditor`, so the same editor serves
	// a chapter and a lesson without knowing which endpoints either of them uses.
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { searchExercises } from '$lib/services/exercises';
	import { searchMaterials } from '$lib/services/materials';
	import { getPostsForCourse } from '$lib/services/activity';
	import CoursePicker from '$lib/components/shared/CoursePicker.svelte';
	import type { ExerciseSet, Post } from '$lib/types';
	import type { CourseItem, LessonExerciseSet } from '$lib/types/course';
	import {
		parseContentRef,
		type LinkableKind,
		type LinkedContentRef
	} from '$lib/utils/contentLinks';

	let {
		courseId,
		items,
		sets,
		mySets,
		onadd,
		onremoveitem,
		onunlinkset
	}: {
		/** The course being edited: left out of the course picker, and the owner of the board whose
		 *  posts the `post` kind lists. */
		courseId: string;
		/** What is already filed at this level. Read-only here — removing goes back through the
		 * parent, which owns the request. */
		items: CourseItem[];
		sets: LessonExerciseSet[];
		/** The curator's own saved sets, offered as a list. There is no way to enumerate somebody
		 * else's, by design — a colleague's shared set is linked by pasting its link, which is the
		 * same thing that link already is. */
		mySets: ExerciseSet[];
		onadd: (ref: LinkedContentRef, note: string) => void;
		onremoveitem: (itemId: string) => void;
		onunlinkset: (linkId: string) => void;
	} = $props();

	/** The parsed kinds, plus `link` — an address outside EdMat, typed rather than parsed
	 * (2026-10-21: "external courses, from edmat itself or as a link"). */
	let kind = $state<LinkableKind | 'link'>('exercise');
	let value = $state('');
	let note = $state('');
	let linkTitle = $state('');

	// --- lists before paste (owner, 2026-10-21: "give user a list instead") ----------------------
	// An exercise or a material is found by title through the searches the post composer already
	// uses; another course through `CoursePicker`; a board post from this course's own board. The
	// address box stays underneath for everything a list cannot reach — a discussion thread (a
	// comment has no title to search by), a set by link, and anything the search did not find.
	let found = $state<{ id: string; label: string }[]>([]);
	let searching = $state(false);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	function onSearchInput() {
		clearTimeout(searchTimer);
		const q = value.trim();
		if (!q || /^\d+$/.test(q) || /^https?:\/\//i.test(q) || q.startsWith('/')) {
			found = [];
			return;
		}
		if (kind !== 'exercise' && kind !== 'material') return;
		searchTimer = setTimeout(async () => {
			searching = true;
			try {
				if (kind === 'exercise')
					found = (await searchExercises(q, getLocale(), 6)).map((e) => ({
						id: e.id,
						label: e.title
					}));
				else
					found = (await searchMaterials(q))
						.slice(0, 6)
						.map((mat) => ({ id: mat.id, label: mat.title }));
			} catch {
				found = [];
			} finally {
				searching = false;
			}
		}, 300);
	}
	function pickFound(row: { id: string; label: string }) {
		if (kind !== 'exercise' && kind !== 'material') return;
		onadd({ kind, id: row.id }, note.trim());
		value = '';
		note = '';
		found = [];
	}
	let pickedCourse = $state<string | null>(null);
	function pickCourse(id: string | null) {
		// Choosing a course in the picker IS the add — there is nothing else to fill in.
		if (!id) return;
		onadd({ kind: 'course', id }, note.trim());
		note = '';
		pickedCourse = null;
	}
	let boardPosts = $state<Post[]>([]);
	let boardLoadedFor = $state<string | null>(null);
	$effect(() => {
		if (kind !== 'post' || boardLoadedFor === courseId) return;
		boardLoadedFor = courseId;
		getPostsForCourse(courseId, { limit: 50 })
			.then((rows) => (boardPosts = rows))
			.catch(() => (boardPosts = []));
	});
	let pickedPost = $state('');
	function pickPost() {
		if (!pickedPost) return;
		onadd({ kind: 'post', id: pickedPost }, note.trim());
		note = '';
		pickedPost = '';
	}
	const postLabel = (post: Post) => post.body.replace(/\s+/g, ' ').slice(0, 80);
	let pickedSlug = $state('');
	// Shown only after a real attempt, never while somebody is still typing — an error that appears
	// on the first keystroke is an error about nothing.
	let unrecognised = $state(false);

	/** All five item kinds, not only the ones this editor can add: the list shows everything filed at
	 * this level, and an attachment or an event gets there through the page's own "Add something"
	 * panel. Reuses the same message keys the course page's own `kindLabel` does, so a file is
	 * called the same thing in both places. */
	function itemKindLabel(kind: CourseItem['kind']): string {
		if (kind === 'material') return m.course_items_material(); // "Material"
		if (kind === 'exercise') return m.course_items_exercise(); // "Exercise"
		if (kind === 'attachment') return m.course_items_attachment(); // "File"
		if (kind === 'event') return m.course_items_event(); // "Event"
		if (kind === 'course') return m.course_items_course(); // "Course"
		if (kind === 'link') return m.course_items_link(); // "Link"
		if (kind === 'post') return m.course_items_post(); // "Post"
		return m.course_items_discussion(); // "Discussion"
	}

	/** Not a `<form>`, and not a `type="submit"` button. This editor is rendered INSIDE the chapter
	 * and lesson dialogs, which are already forms — nesting one form in another is invalid HTML and
	 * browsers resolve it by silently dropping the inner one, so the "add" button would submit the
	 * dialog and save the chapter instead. A plain button plus an Enter handler on the text field
	 * gives the same two ways in without the nesting. */
	function submit() {
		unrecognised = false;

		if (kind === 'link') {
			// An outside address is sent as it is — http(s) only, which the browser's own URL field
			// does not enforce and the server does. Anything else is "unrecognised" here too.
			const url = value.trim();
			if (!/^https?:\/\//i.test(url)) {
				unrecognised = true;
				return;
			}
			onadd({ kind: 'link', url, title: linkTitle.trim() }, note.trim());
		} else if (kind === 'set') {
			const slug = pickedSlug.trim() || value.trim();
			if (!slug) return;
			// A pasted set link resolves through the same parser as everything else, so somebody who
			// has a link rather than a set of their own is not stuck with the dropdown.
			const parsed = parseContentRef(slug, 'set');
			onadd(parsed ?? { kind: 'set', slug }, note.trim());
		} else {
			const parsed = parseContentRef(value, kind);
			if (!parsed) {
				unrecognised = true;
				return;
			}
			// A pasted link overrules a stale select rather than being refused by it — see
			// `parseContentRef`. Reading it back keeps the form honest about what just happened.
			if (parsed.kind !== kind) kind = parsed.kind;
			onadd(parsed, note.trim());
		}
		value = '';
		note = '';
		linkTitle = '';
		pickedSlug = '';
	}
</script>

<section class="links">
	<h4>{m.course_links_heading()}</h4>
	<!-- "Paste the address of the exercise, material or discussion you want — it becomes a real
	     link, not just text." -->
	<p class="links__hint">{m.course_links_hint()}</p>

	{#if items.length === 0 && sets.length === 0}
		<p class="links__empty">{m.course_links_none()}</p>
	{:else}
		<ul class="links__list">
			{#each items as item (item.id)}
				<li>
					<!-- The item's OWN kind. A chapter can already hold an attachment or an event —
					     filed there by the page's own "Add something" panel — and this list shows
					     everything at this level, not only what it can add itself. Collapsing those
					     two into "Exercise" would have labelled a file as a problem to solve. -->
					<span class="links__kind">{itemKindLabel(item.kind)}</span>
					<span class="links__label">{item.label}</span>
					<button type="button" class="link danger" onclick={() => onremoveitem(item.id)}>
						{m.course_links_remove()}
					</button>
				</li>
			{/each}
			{#each sets as set (set.id)}
				<li>
					<span class="links__kind">{m.course_links_kindSet()}</span>
					<span class="links__label">{set.title}</span>
					<button type="button" class="link danger" onclick={() => onunlinkset(set.id)}>
						{m.course_links_remove()}
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="links__form">
		<label class="field">
			<span>{m.course_links_kind()}</span>
			<select bind:value={kind}>
				<option value="exercise">{m.course_links_kindExercise()}</option>
				<option value="material">{m.course_links_kindMaterial()}</option>
				<option value="discussion">{m.course_links_kindDiscussion()}</option>
				<option value="set">{m.course_links_kindSet()}</option>
				<option value="course">{m.course_links_kindCourse()}</option>
				<!-- "Another course on EdMat" -->
				<option value="post">{m.course_links_kindPost()}</option>
				<!-- "A board post" -->
				<option value="link">{m.course_links_kindLink()}</option>
				<!-- "A link outside EdMat" -->
			</select>
		</label>

		{#if kind === 'link'}
			<label class="field">
				<span>{m.course_links_linkTitle()}</span>
				<!-- "What to call it (optional)" -->
				<input type="text" bind:value={linkTitle} maxlength="200" />
			</label>
		{/if}

		{#if kind === 'set'}
			<label class="field">
				<span>{m.course_links_pickSet()}</span>
				<select bind:value={pickedSlug}>
					<option value="">{m.course_links_pickSetNone()}</option>
					{#each mySets as saved (saved.id)}
						<option value={saved.id}>{saved.name}</option>
					{/each}
				</select>
			</label>
		{/if}

		{#if kind === 'course'}
			<CoursePicker
				bind:value={pickedCourse}
				onchange={pickCourse}
				id="links-course"
				label={m.course_links_pickCourse()}
				exclude={[courseId]}
			/>
			<!-- "Which course" -->
		{:else if kind === 'post'}
			<label class="field">
				<span>{m.course_links_pickPost()}</span>
				<!-- "A post from this course's board" -->
				<select bind:value={pickedPost} onchange={pickPost}>
					<option value="">{m.course_links_pickPostNone()}</option>
					<!-- "— pick one, or paste a post's address below —" -->
					{#each boardPosts as post (post.id)}
						<option value={post.id}>{post.authorDisplayName}: {postLabel(post)}</option>
					{/each}
				</select>
			</label>
		{/if}

		{#if kind !== 'course'}
			<label class="field">
				<span
					>{kind === 'set'
						? m.course_links_valueSet()
						: kind === 'link'
							? m.course_links_valueLink()
							: kind === 'exercise' || kind === 'material'
								? m.course_links_search()
								: m.course_links_value()}</span
				>
				<!-- "The address (https://…)" -->
				<!-- Deliberately `type="text"`, not `type="url"`: the field also takes a bare id and a
			     path, both of which the browser's own URL validation would refuse outright — the same
			     reasoning the material form's source field already records. -->
				<input
					type="text"
					bind:value
					inputmode="url"
					placeholder={m.course_links_valuePlaceholder()}
					oninput={() => {
						unrecognised = false;
						onSearchInput();
					}}
					onkeydown={(e) => {
						if (e.key !== 'Enter') return;
						// Stopped rather than merely handled: this input sits inside the dialog's form, so
						// an unclaimed Enter would submit THAT — saving the chapter and closing the dialog
						// on somebody who was adding a link.
						e.preventDefault();
						submit();
					}}
				/>
				<span class="hint"
					>{kind === 'link' ? m.course_links_valueLinkHint() : m.course_links_valueHint()}</span
				>
				<!-- "Opens in a new tab. A MOOC, a recording, a lecturer's page — anything with an address." -->
			</label>
			{#if found.length > 0}
				<ul class="links__found" aria-label={m.course_links_found()}>
					<!-- "Matches" -->
					{#each found as row (row.id)}
						<li>
							<button type="button" class="links__pick" onclick={() => pickFound(row)}
								>{row.label}</button
							>
						</li>
					{/each}
				</ul>
			{:else if searching}
				<p class="links__hint">{m.common_loading()}</p>
			{/if}
		{/if}

		<label class="field">
			<span>{m.course_links_note()}</span>
			<input type="text" bind:value={note} maxlength="500" />
		</label>

		{#if unrecognised}
			<p class="links__error">{m.course_links_unrecognised()}</p>
		{/if}

		<button type="button" class="secondary" onclick={submit}>{m.course_links_add()}</button>
	</div>
</section>

<style lang="scss">
	.links {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		border-top: 1px solid var(--border-color);
		padding-top: var(--space-3);
	}
	h4 {
		font-size: var(--font-size-sm);
		font-weight: 600;
	}
	.links__hint,
	.links__empty {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.links__list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		li {
			display: flex;
			align-items: center;
			gap: var(--space-2);
			font-size: var(--font-size-sm);
		}
	}
	.links__kind {
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
		flex: 0 0 auto;
	}
	.links__label {
		// A thread's label is its opening words, which can be long — it truncates rather than
		// pushing the remove button off the row.
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.links__form {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	/* The dialogs this renders inside style their own `.field` rows, and Svelte scopes styles to the
	   component that declares them — so none of that reaches here, and without this the labels sit
	   beside their inputs and the hint wraps around them. Restated rather than lifted to a global:
	   the two dialogs are not this component's only possible home. */
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		> span {
			font-weight: 600;
		}
		input,
		select {
			width: 100%;
			font: inherit;
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	button.secondary {
		align-self: flex-start;
	}
	.links__error {
		font-size: var(--font-size-xs);
		color: var(--status-danger);
	}
	.links__found {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		max-height: 12rem;
		overflow: auto;
	}
	.links__pick {
		width: 100%;
		text-align: left;
		background: none;
		border: 0;
		font: inherit;
		font-size: var(--font-size-sm);
		color: var(--text-primary);
		padding: var(--space-1) var(--space-2);
		cursor: pointer;
		&:hover {
			background: var(--bg-surface-alt);
		}
	}
</style>
