<script lang="ts">
	// ONE course, chosen from a list rather than pasted as an address (owner, 2026-10-21: "lets
	// improve the course picker"). Two sources, both already the server's visibility rule: the
	// reader's own courses first (what they run, what they take — the course people most often
	// mean), and `GET /api/courses/?q=` as they type, which finds any course they may see. A pasted
	// address or id still works in the same box — `parseContentRef` reads it — so nothing that
	// worked before stops working.
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getCourse, getCourses, getMyParticipation, getMyTeaching } from '$lib/services/course';
	import { authStore } from '$lib/state/auth.svelte';
	import { parseContentRef } from '$lib/utils/contentLinks';
	import { COURSE_KIND_BADGES } from '$lib/utils/labels';
	import type { Course } from '$lib/types/course';

	let {
		value = $bindable(null),
		exclude = [],
		id = 'course-picker',
		label = m.course_picker_label(), // "Course"
		placeholder = m.course_picker_placeholder(), // "Type a course's title, or paste its address…"
		initialTitle = '',
		onchange
	}: {
		/** The chosen course's id, or null. */
		value: string | null;
		/** Ids never offered — the course itself, its ancestors. */
		exclude?: string[];
		id?: string;
		label?: string;
		placeholder?: string;
		/** The chosen course's title when `value` is set before this mounts (an edit form). */
		initialTitle?: string;
		/** Called with the new id on a choice and with null on "change" — for a parent whose act IS
		 *  the choice (the content editor adds the course the moment one is picked). */
		onchange?: (id: string | null) => void;
	} = $props();

	type Row = { id: string; title: string; kind: Course['kind']; mine: boolean };
	let mine = $state<Row[]>([]);
	let found = $state<Row[]>([]);
	let query = $state('');
	let searching = $state(false);
	let chosenTitle = $state(untrack(() => initialTitle));
	let mineLoaded = $state(false);

	/** First occurrence of each id wins — the reader's own rows come first in both callers. A plain
	 * object rather than a Set: eslint's `prefer-svelte-reactivity` reads any `new Set` in a
	 * component as state (frontend/CLAUDE.md trap 7), and this one is a scratch value. */
	function dedupe(rows: Row[]): Row[] {
		const seen: Record<string, true> = {};
		return rows.filter((r) => (seen[r.id] ? false : ((seen[r.id] = true), true)));
	}

	function toRow(course: Course, isMine: boolean): Row {
		return { id: course.id, title: course.title, kind: course.kind, mine: isMine };
	}

	// The reader's own courses, once, the first time the box is opened on an empty value — a
	// signed-out reader has none and `getCourses` still answers them.
	async function loadMine() {
		if (mineLoaded || !authStore.isAuthenticated) return;
		mineLoaded = true;
		try {
			const [teaching, taking] = await Promise.all([getMyTeaching(), getMyParticipation()]);
			mine = dedupe([...teaching, ...taking].map((c) => toRow(c, true)));
		} catch {
			mine = [];
		}
	}

	let timer: ReturnType<typeof setTimeout> | undefined;
	function onInput() {
		clearTimeout(timer);
		const q = query.trim();
		// A pasted address or a bare id resolves at once, the way the old box did.
		const parsed =
			/^\d+$/.test(q) || /\/courses\/\d+/.test(q) ? parseContentRef(q, 'course') : null;
		if (parsed && parsed.kind === 'course') {
			getCourse(parsed.id)
				.then((course) => {
					if (course) choose(toRow(course, false));
				})
				.catch(() => {});
			return;
		}
		if (!q) {
			found = [];
			return;
		}
		timer = setTimeout(async () => {
			searching = true;
			try {
				found = (await getCourses({ q })).map((c) => toRow(c, false));
			} catch {
				found = [];
			} finally {
				searching = false;
			}
		}, 300);
	}

	const offered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const rows = q ? [...mine.filter((r) => r.title.toLowerCase().includes(q)), ...found] : mine;
		return dedupe(rows.filter((r) => !exclude.includes(r.id))).slice(0, 8);
	});

	function choose(row: Row) {
		value = row.id;
		chosenTitle = row.title;
		query = '';
		found = [];
		onchange?.(row.id);
	}
	function reset() {
		value = null;
		chosenTitle = '';
		onchange?.(null);
	}
</script>

<div class="course-picker" data-course-picker>
	{#if value}
		<p class="course-picker__chosen">
			<span class="course-picker__label-text">{label}</span>
			<span class="course-picker__chip">{chosenTitle || `#${value}`}</span>
			<button type="button" class="course-picker__change" onclick={reset}
				>{m.ask_tagChange()}</button
			>
			<!-- "Change" -->
		</p>
	{:else}
		<label class="course-picker__label" for={id}>{label}</label>
		<input
			{id}
			type="text"
			bind:value={query}
			{placeholder}
			autocomplete="off"
			onfocus={loadMine}
			oninput={onInput}
			onkeydown={(e) => {
				if (e.key !== 'Enter') return;
				// Enter picks the first match rather than submitting the surrounding form.
				e.preventDefault();
				if (offered[0]) choose(offered[0]);
			}}
		/>
		{#if offered.length > 0}
			<ul class="course-picker__matches" aria-label={m.course_picker_matches()}>
				<!-- "Matching courses" -->
				{#each offered as row (row.id)}
					<li>
						<button type="button" class="course-picker__match" onclick={() => choose(row)}>
							<span class="course-picker__title">{row.title}</span>
							{#if row.kind === 'university'}<span class="course-picker__badge"
									>{COURSE_KIND_BADGES.university()}</span
								>{/if}
							{#if row.mine}<span class="course-picker__mine">{m.course_picker_mine()}</span>{/if}
							<!-- "yours" -->
						</button>
					</li>
				{/each}
			</ul>
		{:else if searching}
			<p class="course-picker__note">{m.common_loading()}</p>
		{:else if query.trim()}
			<p class="course-picker__note">{m.course_picker_noMatch()}</p>
			<!-- "No course you can see matches that." -->
		{:else if mineLoaded && mine.length === 0}
			<p class="course-picker__note">{m.course_picker_hint()}</p>
			<!-- "Type part of a title to search every course you can see." -->
		{/if}
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.course-picker {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		input {
			width: 100%;
			font: inherit;
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.course-picker__label,
	.course-picker__label-text {
		font-size: var(--font-size-sm);
		font-weight: 600;
	}
	.course-picker__chosen {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
	}
	.course-picker__chip {
		@include mix.selected-soft;
		padding: 0 var(--space-2);
		border-radius: var(--radius-sm);
	}
	.course-picker__change {
		@include mix.button-secondary;
		font-size: var(--font-size-xs);
	}
	.course-picker__matches {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 14rem;
		overflow: auto;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
	}
	.course-picker__match {
		@include mix.focus-ring;
		width: 100%;
		text-align: left;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		background: none;
		border: 0;
		font: inherit;
		color: var(--text-primary);
		cursor: pointer;
		&:hover {
			background: var(--bg-surface-alt);
		}
	}
	.course-picker__title {
		font-weight: 600;
	}
	.course-picker__badge {
		@include mix.neutral-pill;
		font-size: var(--font-size-xs);
	}
	.course-picker__mine,
	.course-picker__note {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
</style>
