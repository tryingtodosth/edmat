<script lang="ts">
	// Experience, skills, and an activity feed you can actually narrow down.
	//
	// The three are separate sections rather than one merged timeline because they answer different
	// questions: what somebody has done, what they claim to be good at, and what they have been doing
	// here lately. Merging them would make each harder to read than either alone.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import {
		createExperience,
		createSkill,
		deleteExperience,
		deleteSkill,
		getUserActivity,
		getUserExtras,
		swapOrder,
		updateExperience,
		updateSkill
	} from '$lib/services/profileExtras';
	import MeatballsMenu from '$lib/components/shared/MeatballsMenu.svelte';
	import type {
		ActivityFeed,
		ActivityItem,
		ExperienceEntry,
		SkillEntry
	} from '$lib/types/profileExtras';

	// `canEdit` is passed by the page, which knows whose profile this is and who is signed in. The
	// page stays exactly what a visitor sees — these controls are additions to it, not a different
	// screen, which is the whole point of editing in place.
	let { userId, canEdit = false }: { userId: string; canEdit?: boolean } = $props();

	// Which row is open in a form, and what is in it. `null` is "nothing being edited"; an id is that
	// row; the empty string is a new one, which is genuinely different from editing row "".
	let editingExperience = $state<string | null>(null);
	let editingSkill = $state<string | null>(null);
	let draft = $state<Record<string, string>>({});
	let busy = $state(false);
	let editError = $state('');

	function startExperience(entry: ExperienceEntry | null) {
		editingSkill = null;
		editingExperience = entry?.id ?? '';
		draft = {
			kind: entry?.kind ?? 'study',
			title: entry?.title ?? '',
			organisation: entry?.organisation ?? '',
			startedOn: entry?.startedOn ?? '',
			endedOn: entry?.endedOn ?? '',
			description: entry?.description ?? ''
		};
		editError = '';
	}

	function startSkill(entry: SkillEntry | null) {
		editingExperience = null;
		editingSkill = entry?.id ?? '';
		draft = { label: entry?.label ?? '', level: entry?.level ?? 'comfortable' };
		editError = '';
	}

	function cancelEdit() {
		editingExperience = null;
		editingSkill = null;
		editError = '';
	}

	/** Every write goes through here: run it, reload from the server, report failure in place.
	 *
	 * Reloading rather than patching local state is deliberate — the server owns `order` and applies
	 * its own sort, so guessing the new arrangement client-side is how a list ends up disagreeing
	 * with the one everybody else sees. */
	async function run(fn: () => Promise<unknown>) {
		busy = true;
		editError = '';
		try {
			await fn();
			const extras = await getUserExtras(userId);
			experience = extras.experience;
			skills = extras.skills;
			cancelEdit();
		} catch {
			editError = m.common_error_generic();
		} finally {
			busy = false;
		}
	}

	function saveExperience(event: SubmitEvent) {
		event.preventDefault();
		const payload = {
			kind: draft.kind as ExperienceEntry['kind'],
			title: draft.title.trim(),
			organisation: draft.organisation.trim(),
			startedOn: draft.startedOn || null,
			endedOn: draft.endedOn || null,
			description: draft.description.trim()
		};
		if (!payload.title) return;
		const id = editingExperience;
		run(() =>
			id
				? updateExperience(id, payload)
				: createExperience({ ...payload, order: experience.length })
		);
	}

	function saveSkill(event: SubmitEvent) {
		event.preventDefault();
		const payload = { label: draft.label.trim(), level: draft.level as SkillEntry['level'] };
		if (!payload.label) return;
		const id = editingSkill;
		run(() => (id ? updateSkill(id, payload) : createSkill({ ...payload, order: skills.length })));
	}

	/** Move by swapping with a neighbour — the simplest honest reorder, and the same shape the
	 * material/exercise requirement editors already use rather than drag-and-drop. */
	function move(kind: 'experience' | 'skill', index: number, by: -1 | 1) {
		const list: { id: string; order: number }[] = kind === 'experience' ? experience : skills;
		const other = list[index + by];
		if (!other) return;
		run(() => swapOrder(kind, list[index], other));
	}

	function confirmRemove(label: string): boolean {
		// A native confirm rather than a bespoke dialog: this app has exactly one modal shell and it
		// is built for content, not for a yes/no. Deleting is the one irreversible thing here.
		return typeof window === 'undefined' || window.confirm(m.profile_edit_confirmRemove({ label }));
	}

	let experience = $state<ExperienceEntry[]>([]);
	let skills = $state<SkillEntry[]>([]);
	let feed = $state<ActivityFeed>({ items: [], tags: [], kinds: [] });

	/** How many tags a single feed row prints before it starts counting instead. */
	const TAGS_PER_ROW = 3;
	/** How many filter chips show before the rest go behind a toggle. Somebody with a broad history
	 * had twenty-five of these, which pushed the feed they belong to off the screen. */
	const TAGS_IN_FILTER = 10;
	let showAllTags = $state(false);
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
	{#if experience.length > 0 || canEdit}
		<section class="profile-section">
			<div class="section-head">
				<h2>{m.profile_experienceHeading()}</h2>
				{#if canEdit}
					<MeatballsMenu
						label={m.profile_edit_menuFor({ section: m.profile_experienceHeading() })}
						items={[{ label: m.profile_edit_add(), onselect: () => startExperience(null) }]}
					/>
				{/if}
			</div>
			<!-- Said once, plainly: none of this is checked. The education card above it may be, and the
			     difference is the point of showing them separately. -->
			<p class="note">{m.profile_experienceNote()}</p>
			<ul class="timeline">
				{#each experience as entry, index (entry.id)}
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
						{#if canEdit}
							<div class="row-menu">
								<MeatballsMenu
									label={m.profile_edit_menuFor({ section: entry.title })}
									items={[
										{ label: m.profile_edit_edit(), onselect: () => startExperience(entry) },
										{
											label: m.profile_edit_moveUp(),
											disabled: index === 0,
											onselect: () => move('experience', index, -1)
										},
										{
											label: m.profile_edit_moveDown(),
											disabled: index === experience.length - 1,
											onselect: () => move('experience', index, 1)
										},
										{
											label: m.profile_edit_remove(),
											danger: true,
											onselect: () =>
												confirmRemove(entry.title) && run(() => deleteExperience(entry.id))
										}
									]}
								/>
							</div>
						{/if}
					</li>
				{/each}
			</ul>

			{#if canEdit && editingExperience !== null}
				<form class="edit-form" onsubmit={saveExperience}>
					<label>
						<span>{m.profile_edit_title()}</span>
						<input type="text" bind:value={draft.title} maxlength="200" required />
					</label>
					<label>
						<span>{m.profile_edit_organisation()}</span>
						<input type="text" bind:value={draft.organisation} maxlength="200" />
					</label>
					<label>
						<span>{m.profile_edit_kind()}</span>
						<select bind:value={draft.kind}>
							<option value="study">{m.profile_kind_study()}</option>
							<option value="work">{m.profile_kind_work()}</option>
							<option value="teaching">{m.profile_kind_teaching()}</option>
							<option value="project">{m.profile_kind_project()}</option>
							<option value="other">{m.profile_kind_other()}</option>
						</select>
					</label>
					<label>
						<span>{m.profile_edit_startedOn()}</span>
						<input type="date" bind:value={draft.startedOn} />
					</label>
					<label>
						<span>{m.profile_edit_endedOn()}</span>
						<input type="date" bind:value={draft.endedOn} />
						<!-- Empty means ongoing, which is a different statement from an unknown end date. -->
						<span class="hint">{m.profile_edit_endedOnHint()}</span>
					</label>
					<label class="wide">
						<span>{m.profile_edit_description()}</span>
						<textarea bind:value={draft.description} rows="3"></textarea>
					</label>
					<div class="edit-form__actions">
						<button type="submit" class="primary" disabled={busy}>{m.common_save()}</button>
						<button type="button" onclick={cancelEdit}>{m.common_cancel()}</button>
					</div>
					{#if editError}<p class="error">{editError}</p>{/if}
				</form>
			{/if}
		</section>
	{/if}

	{#if skills.length > 0 || canEdit}
		<section class="profile-section">
			<div class="section-head">
				<h2>{m.profile_skillsHeading()}</h2>
				{#if canEdit}
					<MeatballsMenu
						label={m.profile_edit_menuFor({ section: m.profile_skillsHeading() })}
						items={[{ label: m.profile_edit_add(), onselect: () => startSkill(null) }]}
					/>
				{/if}
			</div>
			<ul class="skills">
				{#each skills as skill, index (skill.id)}
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
						{#if canEdit}
							<MeatballsMenu
								label={m.profile_edit_menuFor({ section: skill.label })}
								items={[
									{ label: m.profile_edit_edit(), onselect: () => startSkill(skill) },
									{
										label: m.profile_edit_moveUp(),
										disabled: index === 0,
										onselect: () => move('skill', index, -1)
									},
									{
										label: m.profile_edit_moveDown(),
										disabled: index === skills.length - 1,
										onselect: () => move('skill', index, 1)
									},
									{
										label: m.profile_edit_remove(),
										danger: true,
										onselect: () => confirmRemove(skill.label) && run(() => deleteSkill(skill.id))
									}
								]}
							/>
						{/if}
					</li>
				{/each}
			</ul>

			{#if canEdit && editingSkill !== null}
				<form class="edit-form" onsubmit={saveSkill}>
					<label>
						<span>{m.profile_edit_label()}</span>
						<input type="text" bind:value={draft.label} maxlength="100" required />
					</label>
					<label>
						<span>{m.profile_edit_level()}</span>
						<select bind:value={draft.level}>
							<option value="learning">{LEVEL_LABEL.learning()}</option>
							<option value="comfortable">{LEVEL_LABEL.comfortable()}</option>
							<option value="teaching">{LEVEL_LABEL.teaching()}</option>
						</select>
					</label>
					<!-- No evidence picker: 'registry' means an institution said so, and the API refuses
					     to let anybody type it. Anything added here is self-declared by definition. -->
					<div class="edit-form__actions">
						<button type="submit" class="primary" disabled={busy}>{m.common_save()}</button>
						<button type="button" onclick={cancelEdit}>{m.common_cancel()}</button>
					</div>
					{#if editError}<p class="error">{editError}</p>{/if}
				</form>
			{/if}
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
					{#each showAllTags ? feed.tags : feed.tags.slice(0, TAGS_IN_FILTER) as tag (tag)}
						<button
							type="button"
							class="tag"
							class:tag--active={tagFilter === tag}
							onclick={() => (tagFilter = tagFilter === tag ? '' : tag)}
						>
							#{tag}
						</button>
					{/each}
					{#if feed.tags.length > TAGS_IN_FILTER}
						<button
							type="button"
							class="tag tag--toggle"
							onclick={() => (showAllTags = !showAllTags)}
						>
							{showAllTags
								? m.profile_activity_fewerTags()
								: m.profile_activity_moreTags({ count: feed.tags.length - TAGS_IN_FILTER })}
						</button>
					{/if}
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
							<div class="row">
								<!-- MathTitle, not plain text: an exercise's title is written with inline LaTeX
								     (`\(\ell^p\)`), and printing it raw put backslashes and braces in the feed
								     where the same title renders properly two sections further down. -->
								{#if href}
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href already comes from resolve() in hrefFor(); the rule cannot see through the helper -->
									<a {href}><MathTitle text={item.title} /></a>
								{:else}
									<span class="title"><MathTitle text={item.title} /></span>
								{/if}

								{#if item.rating || item.tags.length > 0}
									<p class="meta">
										{#if item.rating}<span class="rating">{item.rating}★</span>{/if}
										<!-- Capped rather than printed in full: several of these rows carry eight or
										     nine tags, and at full length the tags were longer than the thing they
										     described and ran together into one grey block. The count keeps the
										     total honest instead of silently hiding it. -->
										{#each item.tags.slice(0, TAGS_PER_ROW) as tag (tag)}
											<span class="tag">#{tag}</span>
										{/each}
										{#if item.tags.length > TAGS_PER_ROW}
											<span class="tag tag--more">+{item.tags.length - TAGS_PER_ROW}</span>
										{/if}
									</p>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.row-menu {
		display: flex;
		justify-content: flex-end;
	}
	.edit-form {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: flex-end;
		margin-top: var(--space-3);
		padding-top: var(--space-3);
		border-top: 1px solid var(--border-color);
	}
	.edit-form label {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
	}
	.edit-form .wide {
		flex: 1;
		min-width: 14rem;
	}
	.edit-form .hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.edit-form input,
	.edit-form select,
	.edit-form textarea {
		@include mix.focus-ring;
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
	}
	.edit-form__actions {
		display: flex;
		gap: var(--space-2);
	}
	.edit-form button {
		@include mix.focus-ring;
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
		cursor: pointer;
	}
	.edit-form .primary {
		border: none;
		background: var(--accent);
		color: var(--bg-surface);
	}
	.error {
		font-size: var(--font-size-sm);
		color: var(--status-danger, #c0392b);
	}

	section {
		@include mix.card-surface;
		padding: var(--space-4);
	}

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
		display: flex;
		gap: var(--space-2);
		align-items: baseline;
		padding: var(--space-1) 0;
		border-bottom: 1px solid var(--border-color);
	}
	.feed li:last-child {
		border-bottom: none;
	}
	.feed .row {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.feed .title {
		color: var(--text-primary);
	}
	.feed .meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		align-items: baseline;
	}
	.feed .rating {
		color: var(--accent);
		font-weight: 600;
	}
	.feed .tag {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		background: var(--bg-surface-alt);
		border-radius: var(--radius-sm);
		padding: 0 var(--space-1);
	}
	.feed .tag--more {
		font-weight: 600;
	}
</style>
