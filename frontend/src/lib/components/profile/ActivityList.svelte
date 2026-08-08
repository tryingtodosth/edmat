<script lang="ts">
	// What somebody has actually done here: posted, commented, reviewed, finished, saved.
	//
	// One list with a kind filter rather than a section per kind, which is what lets the six summary
	// tiles on the profile all open the same modal with a different filter pre-applied instead of each
	// needing its own view. `kindFilter` is bindable for exactly that: the tile sets it on the way in,
	// and the reader can widen it from inside.
	//
	// Filtering and sorting are client-side over an already-fetched list. At one person's real activity
	// volume that is instant, and a round trip per filter click would be slower and no more correct.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatRelativeDate } from '$lib/utils/format';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import type { ActivityFeed, ActivityItem, ActivityKind } from '$lib/types/profileExtras';

	let {
		feed,
		kindFilter = $bindable(''),
		limit
	}: {
		feed: ActivityFeed;
		kindFilter?: ActivityKind | '';
		/** Set on the profile's own inline preview, omitted in the modal. */
		limit?: number;
	} = $props();

	let tagFilter = $state('');
	let sort = $state<'newest' | 'oldest'>('newest');
	let showAllTags = $state(false);

	/** How many filter chips show before the rest go behind a toggle. Somebody with a broad history has
	 * twenty-five of these, which pushed the feed they belong to off the screen entirely. */
	const TAGS_IN_FILTER = 8;
	/** How many tags a single row prints before it starts counting instead. */
	const TAGS_PER_ROW = 3;

	// The catalogue is mirrored by hand from `UserActivityView`'s own `kind` strings — the one place
	// drift between backend and frontend could creep in, flagged here and in the type rather than left
	// unstated, the same call this codebase already made for NOTIFICATION_TYPE_LABELS.
	const KIND_LABEL: Record<string, () => string> = {
		exercise: () => m.profile_activity_kind_exercise(), // "Exercise"
		material: () => m.profile_activity_kind_material(), // "Material"
		review: () => m.profile_activity_kind_review(), // "Review"
		service_review: () => m.profile_activity_kind_serviceReview(), // "Tutoring review"
		comment: () => m.profile_activity_kind_comment(), // "Comment"
		course_taught: () => m.profile_activity_kind_courseTaught(), // "Runs a course"
		course_joined: () => m.profile_activity_kind_courseJoined(), // "Takes a course"
		lesson_done: () => m.profile_activity_kind_lessonDone(), // "Finished a session"
		saved_set: () => m.profile_activity_kind_savedSet() // "Saved set"
	};
	const kindLabel = (kind: string) => KIND_LABEL[kind]?.() ?? kind;

	let visible = $derived.by(() => {
		const rows = feed.items
			.filter((i) => !kindFilter || i.kind === kindFilter)
			.filter((i) => !tagFilter || i.tags.includes(tagFilter))
			.slice()
			.sort((a, b) => {
				// Undated items (the imported corpus carries no submission timestamp) always sort last,
				// whichever direction is chosen — they are not "oldest", they are unknown.
				if (!a.createdAt && !b.createdAt) return 0;
				if (!a.createdAt) return 1;
				if (!b.createdAt) return -1;
				return sort === 'newest'
					? b.createdAt.localeCompare(a.createdAt)
					: a.createdAt.localeCompare(b.createdAt);
			});
		return limit ? rows.slice(0, limit) : rows;
	});

	/** Where a row points, or nothing when there is no page for it.
	 *
	 * A comment has no page of its own — the exercise it sits under does, but the feed does not carry
	 * which one, so linking it would be a guess. Returning undefined and rendering plain text is the
	 * honest answer rather than a link that lands somewhere unrelated. */
	function href(item: ActivityItem): string | undefined {
		if (item.exerciseId) return resolve('/exercises/[id]', { id: item.exerciseId });
		if (item.materialId) return resolve('/materials/[id]', { id: item.materialId });
		if (item.serviceId) return resolve('/services/[id]', { id: item.serviceId });
		if (item.setId) return resolve('/sets/[id]', { id: item.setId });
		if (item.courseId) return resolve('/courses/[id]', { id: item.courseId });
		return undefined;
	}

	let tagsToShow = $derived(showAllTags ? feed.tags : feed.tags.slice(0, TAGS_IN_FILTER));
</script>

{#if !limit}
	<div class="filters">
		<label>
			<span class="filters__label">{m.profile_activity_kind()}</span>
			<!-- "Show" -->
			<select bind:value={kindFilter}>
				<option value="">{m.profile_activity_allKinds()}</option>
				<!-- "Everything" -->
				{#each feed.kinds as kind (kind)}
					<option value={kind}>{kindLabel(kind)} ({feed.counts[kind as ActivityKind] ?? 0})</option>
				{/each}
			</select>
		</label>
		<label>
			<span class="filters__label">{m.profile_activity_sort()}</span>
			<!-- "Sort" -->
			<select bind:value={sort}>
				<option value="newest">{m.profile_activity_newest()}</option>
				<option value="oldest">{m.profile_activity_oldest()}</option>
			</select>
		</label>
	</div>

	{#if feed.tags.length > 0}
		<div class="tags">
			<button
				type="button"
				class="tag"
				class:tag--active={tagFilter === ''}
				onclick={() => (tagFilter = '')}
			>
				{m.profile_activity_allTags()}
				<!-- "All tags" -->
			</button>
			{#each tagsToShow as tag (tag)}
				<button
					type="button"
					class="tag"
					class:tag--active={tagFilter === tag}
					onclick={() => (tagFilter = tagFilter === tag ? '' : tag)}
				>
					{tag}
				</button>
			{/each}
			{#if feed.tags.length > TAGS_IN_FILTER}
				<button type="button" class="tag tag--more" onclick={() => (showAllTags = !showAllTags)}>
					{showAllTags
						? m.profile_activity_fewerTags()
						: m.profile_activity_moreTags({ count: feed.tags.length - TAGS_IN_FILTER })}
				</button>
			{/if}
		</div>
	{/if}
{/if}

{#if visible.length === 0}
	<p class="empty">{m.profile_activity_noMatches()}</p>
	<!-- "Nothing matches those filters." -->
{:else}
	<ul class="feed">
		{#each visible as item, index (`${item.kind}-${index}-${item.title}`)}
			{@const target = href(item)}
			<li class="row">
				<!-- The kind and the date share the first line and the title gets the second, rather than
				     all three competing for one row. At 390px the one-line version squeezed a long title
				     into a four-character column between the pill and the date and stacked it vertically —
				     visible the moment the page was looked at on a phone, and invisible to every assertion
				     about it, since the text was all present and merely unreadable. -->
				<div class="row__head">
					<span class="row__kind">{kindLabel(item.kind)}</span>
					<span class="row__date">
						{item.createdAt ? formatRelativeDate(item.createdAt, getLocale()) : ''}
					</span>
				</div>
				<span class="row__title">
					{#if target}
						<!-- eslint-disable svelte/no-navigation-without-resolve -- `target` IS a resolve()
						     result; which of five routes it came from depends on the row, so the rule cannot
						     see through the variable. Kept as a block pair rather than a next-line disable,
						     since the rule reports at the href attribute and reformatting moves that line. -->
						<a href={target}>
							<!-- An exercise title can contain real LaTeX (this corpus's whole content model), so
							     it goes through the same KaTeX pipeline the exercise card renders it with; every
							     other kind's title is plain text and interpolating it is correct. -->
							{#if item.kind === 'exercise' || item.kind === 'review'}
								<MathTitle text={item.title} />
							{:else}
								{item.title}
							{/if}
						</a>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{:else}
						{item.title}
					{/if}
				</span>
				<div class="row__foot">
					{#if item.rating}
						<span class="row__rating">{'★'.repeat(item.rating)}</span>
					{/if}
					{#if item.kind === 'saved_set'}
						<span class="row__note">
							{m.profile_activity_setSize({ count: item.setSize ?? 0 })}
							<!-- "{count} exercises" -->
							{#if item.isPublic === false}
								· {m.profile_activity_setPrivate()}
								<!-- "only you" -->
							{/if}
						</span>
					{/if}
					{#each item.tags.slice(0, TAGS_PER_ROW) as tag (tag)}
						<span class="row__tag">{tag}</span>
					{/each}
					{#if item.tags.length > TAGS_PER_ROW}
						<span class="row__tag">+{item.tags.length - TAGS_PER_ROW}</span>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.filters {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		label {
			display: flex;
			flex-direction: column;
			gap: 2px;
			flex: 1;
			min-width: 9rem;
		}
		select {
			@include mix.focus-ring;
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-page);
			color: var(--text-primary);
		}
	}
	.filters__label {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.tag {
		@include mix.focus-ring;
		background: var(--bg-page);
		border: 1px solid var(--border-color);
		border-radius: 999px;
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
		padding: 2px var(--space-2);
		cursor: pointer;
	}
	.tag--active {
		border-color: var(--accent);
		color: var(--accent);
	}
	.tag--more {
		font-style: italic;
	}
	.feed {
		display: flex;
		flex-direction: column;
	}
	.row {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--border-color);
		font-size: var(--font-size-sm);
		&:last-child {
			border-bottom: none;
		}
	}
	.row__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.row__kind {
		@include mix.status-pill(var(--status-neutral), var(--status-neutral-bg));
		flex-shrink: 0;
	}
	.row__title {
		// `anywhere`, not `break-word`: a course title can be one long unbroken token, and without this
		// it widens the row past the viewport rather than wrapping.
		overflow-wrap: anywhere;
		a {
			color: var(--text-primary);
			font-weight: 600;
			&:hover {
				color: var(--accent);
			}
		}
	}
	.row__foot {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
		// Collapses to nothing when the row has no rating, note or tags, so an ordinary row is two lines
		// rather than two lines and a gap.
		&:empty {
			display: none;
		}
	}
	.row__rating {
		color: var(--accent);
	}
	.row__note,
	.row__date {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		flex-shrink: 0;
	}
	.row__tag {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		background: var(--bg-page);
		border-radius: 999px;
		padding: 0 var(--space-2);
	}
	.empty {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
</style>
