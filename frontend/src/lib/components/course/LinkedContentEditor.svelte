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
	import type { ExerciseSet } from '$lib/types';
	import type { CourseItem, LessonExerciseSet } from '$lib/types/course';
	import {
		parseContentRef,
		type LinkableKind,
		type ParsedContentRef
	} from '$lib/utils/contentLinks';

	let {
		items,
		sets,
		mySets,
		onadd,
		onremoveitem,
		onunlinkset
	}: {
		/** What is already filed at this level. Read-only here — removing goes back through the
		 * parent, which owns the request. */
		items: CourseItem[];
		sets: LessonExerciseSet[];
		/** The curator's own saved sets, offered as a list. There is no way to enumerate somebody
		 * else's, by design — a colleague's shared set is linked by pasting its link, which is the
		 * same thing that link already is. */
		mySets: ExerciseSet[];
		onadd: (ref: ParsedContentRef, note: string) => void;
		onremoveitem: (itemId: string) => void;
		onunlinkset: (linkId: string) => void;
	} = $props();

	let kind = $state<LinkableKind>('exercise');
	let value = $state('');
	let note = $state('');
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
		return m.course_items_discussion(); // "Discussion"
	}

	/** Not a `<form>`, and not a `type="submit"` button. This editor is rendered INSIDE the chapter
	 * and lesson dialogs, which are already forms — nesting one form in another is invalid HTML and
	 * browsers resolve it by silently dropping the inner one, so the "add" button would submit the
	 * dialog and save the chapter instead. A plain button plus an Enter handler on the text field
	 * gives the same two ways in without the nesting. */
	function submit() {
		unrecognised = false;

		if (kind === 'set') {
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
			</select>
		</label>

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

		<label class="field">
			<span>{kind === 'set' ? m.course_links_valueSet() : m.course_links_value()}</span>
			<!-- Deliberately `type="text"`, not `type="url"`: the field also takes a bare id and a
			     path, both of which the browser's own URL validation would refuse outright — the same
			     reasoning the material form's source field already records. -->
			<input
				type="text"
				bind:value
				inputmode="url"
				placeholder={m.course_links_valuePlaceholder()}
				oninput={() => (unrecognised = false)}
				onkeydown={(e) => {
					if (e.key !== 'Enter') return;
					// Stopped rather than merely handled: this input sits inside the dialog's form, so
					// an unclaimed Enter would submit THAT — saving the chapter and closing the dialog
					// on somebody who was adding a link.
					e.preventDefault();
					submit();
				}}
			/>
			<span class="hint">{m.course_links_valueHint()}</span>
		</label>

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
			background: var(--surface);
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
</style>
