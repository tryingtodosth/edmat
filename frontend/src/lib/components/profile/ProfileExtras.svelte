<script lang="ts">
	// Experience, skills, and an activity feed you can actually narrow down.
	//
	// The three are separate sections rather than one merged timeline because they answer different
	// questions: what somebody has done, what they claim to be good at, and what they have been doing
	// here lately. Merging them would make each harder to read than either alone.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getUserActivity, getUserExtras } from '$lib/services/profileExtras';
	import type {
		ActivityFeed,
		ActivityItem,
		ExperienceEntry,
		SkillEntry
	} from '$lib/types/profileExtras';

	let { userId }: { userId: string } = $props();

	let experience = $state<ExperienceEntry[]>([]);
	let skills = $state<SkillEntry[]>([]);
	let feed = $state<ActivityFeed>({ items: [], tags: [], kinds: [] });
	let loading = $state(true);

	// The three controls. Deliberately plain client-side state over an already-fetched list: at a
	// person's real activity volume this is instant, and a round trip per filter click would be
	// slower and no more correct.
	let sort = $state<'newest' | 'oldest'>('newest');
	let kindFilter = $state('');
	let tagFilter = $state('');

	let loadedFor = $state<string | undefined>(undefined);
	$effect(() => {
		if (userId === loadedFor) return;
		loadedFor = userId;
		loading = true;
		Promise.all([getUserExtras(userId), getUserActivity(userId)])
			.then(([extras, activity]) => {
				experience = extras.experience;
				skills = extras.skills;
				feed = activity;
			})
			.catch(() => {
				experience = [];
				skills = [];
				feed = { items: [], tags: [], kinds: [] };
			})
			.finally(() => (loading = false));
	});

	const KIND_LABEL: Record<string, () => string> = {
		exercise: () => m.profile_activity_kind_exercise(),
		review: () => m.profile_activity_kind_review(),
		comment: () => m.profile_activity_kind_comment(),
		course_taught: () => m.profile_activity_kind_courseTaught(),
		course_joined: () => m.profile_activity_kind_courseJoined()
	};
	const LEVEL_LABEL: Record<string, () => string> = {
		learning: () => m.profile_skill_learning(),
		comfortable: () => m.profile_skill_comfortable(),
		teaching: () => m.profile_skill_teaching()
	};
	// Only a registry-backed claim gets a tick — a badge on something nobody checked would be exactly
	// as convincing to a reader whether or not it were true.
	const EVIDENCE_LABEL: Record<string, () => string> = {
		self_declared: () => m.profile_skill_selfDeclared(),
		coursework: () => m.profile_skill_coursework(),
		registry: () => m.profile_skill_registry()
	};
	const KIND_LABEL_OF = (kind: string) => KIND_LABEL[kind]?.() ?? kind;

	let visible = $derived(
		feed.items
			.filter((i) => !kindFilter || i.kind === kindFilter)
			.filter((i) => !tagFilter || i.tags.includes(tagFilter))
			.slice()
			.sort((a, b) => {
				// Undated items (imported exercises carry no submission timestamp) always sort last,
				// whichever direction is chosen — they are not "oldest", they are unknown.
				if (!a.createdAt && !b.createdAt) return 0;
				if (!a.createdAt) return 1;
				if (!b.createdAt) return -1;
				return sort === 'newest'
					? b.createdAt.localeCompare(a.createdAt)
					: a.createdAt.localeCompare(b.createdAt);
			})
	);

	function hrefFor(item: ActivityItem): string | undefined {
		if (item.exerciseId) return resolve('/exercises/[id]', { id: item.exerciseId });
		if (item.taughtCourseId) return resolve('/classroom/[id]', { id: item.taughtCourseId });
		return undefined;
	}

	function yearOf(value: string | null): string {
		return value ? value.slice(0, 4) : '';
	}
</script>

{#if !loading}
	{#if experience.length > 0}
		<section class="profile-section">
			<h2>{m.profile_experienceHeading()}</h2>
			<!-- Said once, plainly: none of this is checked. The education card above it may be, and the
			     difference is the point of showing them separately. -->
			<p class="note">{m.profile_experienceNote()}</p>
			<ul class="timeline">
				{#each experience as entry (entry.id)}
					<li>
						<div class="row">
							<strong>{entry.title}</strong>
							<span class="years">
								{yearOf(entry.startedOn)}{entry.startedOn ? ' – ' : ''}{entry.endedOn
									? yearOf(entry.endedOn)
									: m.profile_experiencePresent()}
							</span>
						</div>
						{#if entry.organisation}<p class="meta">{entry.organisation}</p>{/if}
						{#if entry.description}<p class="meta">{entry.description}</p>{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if skills.length > 0}
		<section class="profile-section">
			<h2>{m.profile_skillsHeading()}</h2>
			<ul class="skills">
				{#each skills as skill (skill.id)}
					<li class="skill">
						<span class="skill__label">{skill.label}</span>
						<span class="skill__level">{LEVEL_LABEL[skill.level]?.() ?? skill.level}</span>
						<span
							class="skill__evidence"
							class:skill__evidence--strong={skill.evidence !== 'self_declared'}
						>
							{skill.evidence === 'registry' ? '✓ ' : ''}{EVIDENCE_LABEL[skill.evidence]?.() ??
								skill.evidence}
						</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if feed.items.length > 0}
		<section class="profile-section">
			<h2>{m.profile_activityHeading()}</h2>
			<div class="controls">
				<label>
					<span>{m.profile_activity_sort()}</span>
					<select bind:value={sort}>
						<option value="newest">{m.profile_activity_newest()}</option>
						<option value="oldest">{m.profile_activity_oldest()}</option>
					</select>
				</label>
				<label>
					<span>{m.profile_activity_kind()}</span>
					<select bind:value={kindFilter}>
						<option value="">{m.profile_activity_allKinds()}</option>
						{#each feed.kinds as kind (kind)}
							<option value={kind}>{KIND_LABEL_OF(kind)}</option>
						{/each}
					</select>
				</label>
			</div>

			{#if feed.tags.length > 0}
				<div class="tags">
					<!-- Tag chips rather than a select: they double as a display of what this person's
					     work is actually about, which a collapsed dropdown would hide. -->
					<button
						type="button"
						class="tag"
						class:tag--active={tagFilter === ''}
						onclick={() => (tagFilter = '')}
					>
						{m.profile_activity_allTags()}
					</button>
					{#each feed.tags as tag (tag)}
						<button
							type="button"
							class="tag"
							class:tag--active={tagFilter === tag}
							onclick={() => (tagFilter = tagFilter === tag ? '' : tag)}
						>
							#{tag}
						</button>
					{/each}
				</div>
			{/if}

			{#if visible.length === 0}
				<p class="meta">{m.profile_activity_noMatches()}</p>
			{:else}
				<ul class="feed">
					{#each visible as item, index (item.kind + index)}
						{@const href = hrefFor(item)}
						<li>
							<span class="kind">{KIND_LABEL_OF(item.kind)}</span>
							{#if href}
								<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href already comes from resolve() in hrefFor(); the rule cannot see through the helper -->
								<a {href}>{item.title}</a>
							{:else}
								<span>{item.title}</span>
							{/if}
							{#if item.rating}<span class="meta"> · {item.rating}★</span>{/if}
							{#if item.tags.length > 0}
								<span class="meta"> · {item.tags.map((t) => `#${t}`).join(' ')}</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	h2 {
		font-size: var(--font-size-md);
		margin-bottom: var(--space-2);
	}
	.note,
	.meta {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.timeline,
	.feed,
	.skills {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		list-style: none;
	}
	.row {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		align-items: baseline;
	}
	.years {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		white-space: nowrap;
	}
	.skills {
		flex-direction: row;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.skill {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		min-width: 11rem;
	}
	.skill__label {
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.skill__level,
	.skill__evidence {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.skill__evidence--strong {
		color: var(--accent);
	}
	.controls {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		margin-bottom: var(--space-2);
		label {
			display: flex;
			flex-direction: column;
			gap: 2px;
			font-size: var(--font-size-xs);
			color: var(--text-secondary);
		}
		select {
			@include mix.focus-ring;
			padding: var(--space-1) var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-page);
			font-size: var(--font-size-sm);
			color: var(--text-primary);
		}
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin-bottom: var(--space-2);
	}
	.tag {
		@include mix.focus-ring;
		border: 1px solid var(--border-color);
		border-radius: 999px;
		background: var(--bg-page);
		padding: 2px var(--space-2);
		font-size: var(--font-size-xs);
		cursor: pointer;
		color: var(--text-secondary);
	}
	.tag--active {
		border-color: var(--accent);
		color: var(--accent);
		font-weight: 600;
	}
	.kind {
		display: inline-block;
		min-width: 6.5rem;
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}
	.feed li {
		font-size: var(--font-size-sm);
	}
</style>
