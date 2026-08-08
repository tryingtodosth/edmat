<script lang="ts">
	// Saving one exercise — to the working set, to a saved set, or into a course.
	//
	// This replaces a plain `+` / `✓` toggle that could only ever write to the anonymous working
	// set. The two things it changes are worth stating, because they are the whole point:
	//
	// 1. **Saved sets are reachable from where you are.** Before this, putting an exercise into
	//    "Kolokwium 2" meant adding it to the working set, going to /my-set, and re-saving the whole
	//    thing — so in practice nobody did, and a named set was a thing you built once.
	// 2. **The saved state says WHERE it was saved.** A checkmark answers "is this in something?",
	//    which is the less useful of the two questions once there is more than one place to put it.
	//    A bookmark that opens onto the list answers "in which?" — and the panel is the answer, not a
	//    separate view of it, so there is nothing to keep in step.
	//
	// The confirmation sits inside the panel, under the row that was just clicked, rather than as a
	// toast somewhere else on the page: it is about the thing you pressed, and it belongs next to it.
	import { m } from '$lib/paraglide/messages.js';
	import { ApiError } from '$lib/api/client';
	import { authStore } from '$lib/state/auth.svelte';
	import { guestSetStore } from '$lib/state/guestSet.svelte';
	import { saveTargetsStore } from '$lib/state/saveTargets.svelte';
	import { displayPrefs } from '$lib/state/displayPrefs.svelte';
	import Popover from '$lib/components/shared/Popover.svelte';

	let {
		exerciseId,
		variant = 'icon'
	}: {
		exerciseId: string;
		/** `icon` is the round button on a card; `labelled` is the wider one on the exercise page,
		 * which has room for a word and looks wrong as a lone circle in a toolbar. */
		variant?: 'icon' | 'labelled';
	} = $props();

	/** How many saved sets are listed before the rest go behind "Show all". Three, because the panel
	 * is a menu rather than a page — somebody with thirty sets should not get a scrolling wall over
	 * the card they were reading. */
	const VISIBLE_SETS = 3;

	let open = $state(false);
	let showAllSets = $state(false);
	let showCourses = $state(false);
	let naming = $state(false);
	let newName = $state('');
	let busy = $state('');
	let notice = $state('');
	let error = $state('');

	const inWorkingSet = $derived(guestSetStore.has(exerciseId));
	const containing = $derived(saveTargetsStore.setsContaining(exerciseId));
	/** Bookmarked when it is anywhere at all — the working set counts, since for a guest that is the
	 * only place there is. */
	const saved = $derived(inWorkingSet || containing.length > 0);
	const sets = $derived(saveTargetsStore.sets);
	const shownSets = $derived(showAllSets ? sets : sets.slice(0, VISIBLE_SETS));
	const hiddenCount = $derived(Math.max(sets.length - VISIBLE_SETS, 0));
	const courses = $derived(saveTargetsStore.courses);
	const stacked = $derived(displayPrefs.saveMenuLayout === 'above');

	// The sets have to be loaded for the button to be honest — a bookmark means "already saved
	// somewhere", and without them an exercise sitting in three named sets shows a plain `+`. That
	// was the first version's behaviour, found in a browser. Twenty cards asking costs one request:
	// the store's own owner check and `loading` flag collapse them.
	$effect(() => {
		saveTargetsStore.ensureSetsLoaded(authStore.user?.id ?? null);
	});

	// The courses, by contrast, stay lazy: nobody needs them until the menu is actually open, and
	// most of the buttons on a listing page are never opened at all.
	$effect(() => {
		if (open) {
			notice = '';
			error = '';
			saveTargetsStore.ensureCoursesLoaded(authStore.user?.id ?? null);
		}
	});

	function toggleWorking() {
		guestSetStore.toggle(exerciseId);
		notice = inWorkingSet ? m.save_removedFromWorking() : m.save_addedToWorking();
	}

	async function toggleSet(setId: string, name: string, isIn: boolean) {
		busy = setId;
		error = '';
		try {
			if (isIn) {
				await saveTargetsStore.removeFrom(setId, exerciseId);
				notice = m.save_removedFrom({ name });
			} else {
				await saveTargetsStore.addTo(setId, exerciseId);
				notice = m.save_addedTo({ name });
			}
		} catch {
			error = m.save_error();
		} finally {
			busy = '';
		}
	}

	async function createAndAdd(event: SubmitEvent) {
		event.preventDefault();
		const name = newName.trim();
		if (!name || !authStore.user) return;
		busy = 'new';
		error = '';
		try {
			await saveTargetsStore.createWith(authStore.user.id, name, exerciseId);
			notice = m.save_addedToNew({ name });
			newName = '';
			naming = false;
		} catch {
			error = m.save_error();
		} finally {
			busy = '';
		}
	}

	async function fileInto(courseId: string, title: string) {
		busy = courseId;
		error = '';
		try {
			await saveTargetsStore.fileIntoCourse(courseId, exerciseId);
			notice = m.save_sentToCourse({ title });
		} catch (e) {
			// The API distinguishes "it is already in that course" from an actual failure, and so
			// should this: one is an answer to what you asked and the other is a problem. Telling
			// somebody it failed when the exercise is already where they wanted it would send them
			// off looking for a fault that is not there.
			if (e instanceof ApiError && e.message === 'already_in_course') {
				notice = m.save_alreadyInCourse({ title });
			} else {
				error = m.save_courseError();
			}
		} finally {
			busy = '';
		}
	}
</script>

<div class="save" class:save--labelled={variant === 'labelled'}>
	<Popover label={m.save_label()} bind:open align="right">
		{#snippet trigger(isOpen)}
			<span
				class="save__trigger"
				class:save__trigger--saved={saved}
				class:save__trigger--open={isOpen}
			>
				{#if saved}
					<!-- A bookmark rather than a checkmark. "Done" is the wrong idea: the exercise has
					     been filed somewhere, and where it went is a question you can now ask. -->
					<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
						<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" fill="currentColor" />
					</svg>
				{:else}
					<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
						<path
							d="M12 5v14M5 12h14"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							fill="none"
						/>
					</svg>
				{/if}
				{#if variant === 'labelled'}
					<span class="save__word">{saved ? m.save_savedIn() : m.save_action()}</span>
				{/if}
			</span>
		{/snippet}

		<!-- The panel's contents go straight in as the default children snippet: Popover hands its
		     own `close` callback to a `{#snippet children(close)}`, and nothing here navigates away, so
		     an explicit snippet declaring a parameter it never uses would just be indirection. -->
		<div
			class="menu"
			class:menu--stacked={stacked}
			class:menu--twocol={!stacked && courses.length > 0}
		>
			{#snippet coursesSection()}
				{#if courses.length}
					<div class="menu__courses">
						<button
							type="button"
							class="menu__row menu__row--head"
							aria-expanded={showCourses}
							onclick={() => (showCourses = !showCourses)}
						>
							<span>{m.save_courses()}</span>
							<span class="menu__chev" class:menu__chev--open={showCourses}>›</span>
						</button>
						{#if showCourses}
							<ul class="menu__list">
								{#each courses as course (course.id)}
									<li>
										<button
											type="button"
											class="menu__row"
											disabled={busy === course.id}
											onclick={() => fileInto(course.id, course.title)}
										>
											<span class="menu__name">{course.title}</span>
											{#if course.contributionNeedsApproval}
												<!-- Said before the click, not after: somebody who files something
													     and then cannot find it assumes it failed. -->
												<span class="menu__hint">{m.save_needsApproval()}</span>
											{/if}
										</button>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/if}
			{/snippet}

			{#if stacked}
				{@render coursesSection()}
			{/if}

			<div class="menu__sets">
				<ul class="menu__list">
					<li>
						<button type="button" class="menu__row" onclick={toggleWorking}>
							<span class="menu__tick" aria-hidden="true">{inWorkingSet ? '✓' : ''}</span>
							<span class="menu__name">{m.save_workingSet()}</span>
						</button>
					</li>

					{#if authStore.isAuthenticated}
						{#each shownSets as set (set.id)}
							{@const isIn = set.exerciseIds.includes(exerciseId)}
							<li>
								<button
									type="button"
									class="menu__row"
									disabled={busy === set.id}
									aria-pressed={isIn}
									onclick={() => toggleSet(set.id, set.name, isIn)}
								>
									<span class="menu__tick" aria-hidden="true">{isIn ? '✓' : ''}</span>
									<span class="menu__name">{set.name}</span>
								</button>
							</li>
						{/each}

						{#if hiddenCount > 0 && !showAllSets}
							<li>
								<button
									type="button"
									class="menu__row menu__row--more"
									onclick={() => (showAllSets = true)}
								>
									{m.save_showAll({ n: hiddenCount })}
								</button>
							</li>
						{/if}

						<li>
							{#if naming}
								<form class="menu__new" onsubmit={createAndAdd}>
									<!-- svelte-ignore a11y_autofocus -->
									<input
										type="text"
										bind:value={newName}
										maxlength="100"
										required
										autofocus
										placeholder={m.save_newNamePlaceholder()}
									/>
									<button type="submit" disabled={busy === 'new'}>{m.save_create()}</button>
								</form>
							{:else}
								<button
									type="button"
									class="menu__row menu__row--more"
									onclick={() => (naming = true)}
								>
									{m.save_newSet()}
								</button>
							{/if}
						</li>
					{:else}
						<li class="menu__note">{m.save_signInForSets()}</li>
					{/if}
				</ul>
			</div>

			{#if !stacked}
				{@render coursesSection()}
			{/if}
		</div>

		{#if saveTargetsStore.loading}
			<p class="menu__status">{m.common_loading()}</p>
		{/if}
		{#if notice}
			<p class="menu__notice">{notice}</p>
		{/if}
		{#if error}
			<p class="menu__error">{error}</p>
		{/if}
	</Popover>
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.save {
		flex-shrink: 0;
	}

	.save__trigger {
		@include mix.focus-ring;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 1px solid var(--border-color);
		background: var(--bg-surface);
		color: var(--text-primary);

		&--saved {
			background: var(--accent);
			border-color: var(--accent);
			color: var(--accent-contrast);
		}

		&--open {
			border-color: var(--accent);
		}
	}

	.save--labelled .save__trigger {
		width: auto;
		height: auto;
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
	}

	.save__word {
		font-size: var(--font-size-sm);
	}

	.menu {
		display: flex;
		gap: var(--space-3);
		/* Wide enough to read a set name, which is the whole content of a row. The first version was
		   210px whether or not the courses half was there, which split into two ~100px columns and
		   truncated every name to "Trudne c…" — caught by looking at a screenshot rather than by any
		   assertion, since every row was present and in the right order. */
		min-width: 13rem;

		&--twocol {
			min-width: 23rem;
		}

		&--stacked {
			flex-direction: column;
			gap: var(--space-2);
		}
	}

	.menu__sets {
		min-width: 0;
		/* The sets take the larger share: there are more of them, their names run longer, and they
		   are what most people opened this for. */
		flex: 3 1 0;
	}

	.menu__courses {
		min-width: 0;
		flex: 2 1 0;
	}

	.menu__courses {
		border-left: 1px solid var(--border-color);
		padding-left: var(--space-2);
	}

	.menu--stacked .menu__courses {
		border-left: none;
		border-bottom: 1px solid var(--border-color);
		padding-left: 0;
		padding-bottom: var(--space-2);
	}

	.menu__list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.menu__row {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		width: 100%;
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: inherit;
		cursor: pointer;
		font-size: var(--font-size-sm);
		padding: 0.25rem 0.4rem;
		text-align: left;

		&:hover:not(:disabled) {
			background: var(--bg-surface-alt);
		}

		&:disabled {
			cursor: progress;
			opacity: 0.6;
		}

		&--more {
			color: var(--accent);
		}

		&--head {
			font-weight: 600;
			justify-content: space-between;
		}
	}

	.menu__tick {
		display: inline-block;
		width: 0.9em;
		color: var(--status-success);
	}

	.menu__name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.menu__hint {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
		margin-left: auto;
		padding-left: var(--space-1);
	}

	.menu__chev {
		display: inline-block;
		transition: transform 0.12s ease;

		&--open {
			transform: rotate(90deg);
		}
	}

	.menu__new {
		display: flex;
		gap: var(--space-1);
		padding: 0.25rem 0.4rem;

		input {
			min-width: 0;
			flex: 1;
		}
	}

	.menu__note,
	.menu__status {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
		padding: 0.25rem 0.4rem;
		margin: 0;
	}

	.menu__notice {
		color: var(--status-success);
		font-size: var(--font-size-xs);
		margin: var(--space-1) 0 0 0;
		padding: 0 0.4rem;
	}

	.menu__error {
		color: var(--status-danger);
		font-size: var(--font-size-xs);
		margin: var(--space-1) 0 0 0;
		padding: 0 0.4rem;
	}
</style>
