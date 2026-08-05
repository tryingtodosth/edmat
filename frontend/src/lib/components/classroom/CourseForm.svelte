<script lang="ts">
	// Shared by creating and editing, since they ask exactly the same questions — two copies would
	// drift the moment one gained a field.
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type {
		ContributionPolicy,
		DiscussionMode,
		TaughtCourse,
		TaughtCourseDraft
	} from '$lib/types/classroom';

	let {
		initial = null,
		submitting = false,
		error = '',
		submitLabel,
		onsubmit
	}: {
		initial?: TaughtCourse | null;
		submitting?: boolean;
		error?: string;
		submitLabel: string;
		onsubmit: (draft: TaughtCourseDraft) => void;
	} = $props();

	let title = $state(untrack(() => initial?.title ?? ''));
	let summary = $state(untrack(() => initial?.summary ?? ''));
	let description = $state(untrack(() => initial?.description ?? ''));
	let visibility = $state<TaughtCourse['visibility']>(
		untrack(() => initial?.visibility ?? 'only_you')
	);
	let status = $state<TaughtCourse['status']>(untrack(() => initial?.status ?? 'open'));
	let enrollmentPolicy = $state<TaughtCourse['enrollmentPolicy']>(
		untrack(() => initial?.enrollmentPolicy ?? 'open')
	);
	let capacity = $state(untrack(() => initial?.capacity ?? 0));
	let language = $state(untrack(() => initial?.language ?? 'pl'));
	let startsOn = $state(untrack(() => initial?.startsOn ?? ''));
	let endsOn = $state(untrack(() => initial?.endsOn ?? ''));
	let price = $state(untrack(() => initial?.price ?? ''));
	let discussionMode = $state<DiscussionMode>(
		untrack(() => initial?.discussionMode ?? 'participants')
	);
	let announceNewLessons = $state(untrack(() => initial?.announceNewLessons ?? true));
	let announceNewPosts = $state(untrack(() => initial?.announceNewPosts ?? true));
	let contributionPolicy = $state<ContributionPolicy>(
		untrack(() => initial?.contributionPolicy ?? 'approval')
	);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		onsubmit({
			title: title.trim(),
			summary: summary.trim(),
			description: description.trim(),
			// Subject/field tagging is a separate picker this first version does not have; sending
			// what already exists keeps an edit from silently clearing tags set elsewhere.
			subjects: initial?.subjectSlugs ?? [],
			field: initial?.fieldSlug ?? null,
			visibility,
			status,
			enrollmentPolicy,
			capacity: Number(capacity) || 0,
			language,
			startsOn: startsOn || null,
			endsOn: endsOn || null,
			price: price || null,
			currency: initial?.currency || 'PLN',
			discussionMode,
			announceNewLessons,
			announceNewPosts,
			contributionPolicy
		});
	}
</script>

<form onsubmit={submit}>
	<label class="field">
		<span>{m.classroom_form_title()}</span>
		<input type="text" bind:value={title} maxlength="200" required />
	</label>

	<label class="field">
		<span>{m.classroom_form_summary()}</span>
		<input type="text" bind:value={summary} maxlength="300" />
		<span class="hint">{m.classroom_form_summaryHint()}</span>
	</label>

	<label class="field">
		<span>{m.classroom_form_description()}</span>
		<textarea bind:value={description} rows="6"></textarea>
	</label>

	<!-- Radios, not a <select>, because each option needs a sentence before it means anything — and a
	     dropdown shows one line at a time, which is how "Running" ended up sitting in a list of
	     visibility options with nothing to explain it. Who can see the course and how far along it is
	     are now two questions, asked separately. -->
	<fieldset class="field choice-set">
		<legend>{m.classroom_form_visibility()}</legend>

		<label class="choice">
			<input type="radio" bind:group={visibility} value="only_you" />
			<span class="choice__body">
				<span class="choice__label">{m.classroom_visibility_onlyYou()}</span>
				<span class="choice__hint">{m.classroom_visibility_onlyYouHint()}</span>
			</span>
		</label>

		<label class="choice">
			<input type="radio" bind:group={visibility} value="private" />
			<span class="choice__body">
				<span class="choice__label">{m.classroom_visibility_private()}</span>
				<span class="choice__hint">{m.classroom_visibility_privateHint()}</span>
			</span>
		</label>

		<label class="choice">
			<input type="radio" bind:group={visibility} value="public" />
			<span class="choice__body">
				<span class="choice__label">{m.classroom_visibility_public()}</span>
				<span class="choice__hint">{m.classroom_visibility_publicHint()}</span>
			</span>
		</label>

		<!-- The thing this form never said anywhere: how anybody actually gets into a course that is
		     not listed. Without it, picking "Private" reads as a dead end rather than as the option
		     that hands you a link to send. -->
		<p class="choice-set__note">{m.classroom_form_inviteNote()}</p>
	</fieldset>

	<label class="field">
		<span>{m.classroom_form_status()}</span>
		<select bind:value={status}>
			<option value="open">{m.classroom_status_open()}</option>
			<option value="running">{m.classroom_status_running()}</option>
			<option value="finished">{m.classroom_status_finished()}</option>
		</select>
		<span class="hint">{m.classroom_form_statusHint()}</span>
	</label>

	<label class="field">
		<span>{m.classroom_form_policy()}</span>
		<select bind:value={enrollmentPolicy}>
			<option value="open">{m.classroom_form_policyOpen()}</option>
			<option value="approval">{m.classroom_form_policyApproval()}</option>
		</select>
	</label>

	<label class="field">
		<span>{m.classroom_form_capacity()}</span>
		<input type="number" bind:value={capacity} min="0" />
		<span class="hint">{m.classroom_form_capacityHint()}</span>
	</label>

	<div class="row">
		<label class="field">
			<span>{m.classroom_form_startsOn()}</span>
			<input type="date" bind:value={startsOn} />
		</label>
		<label class="field">
			<span>{m.classroom_form_endsOn()}</span>
			<input type="date" bind:value={endsOn} />
		</label>
	</div>

	<label class="field">
		<span>{m.classroom_form_price()}</span>
		<input type="text" bind:value={price} inputmode="decimal" />
		<!-- Display-only, exactly like a tutoring listing's rate: nothing here takes money. -->
		<span class="hint">{m.classroom_form_priceHint()}</span>
	</label>

	<fieldset>
		<legend>{m.classroom_form_discussionLegend()}</legend>
		<label class="field">
			<span>{m.classroom_form_discussionMode()}</span>
			<select bind:value={discussionMode}>
				<option value="participants">{m.classroom_form_discussionParticipants()}</option>
				<option value="public">{m.classroom_form_discussionPublic()}</option>
				<option value="off">{m.classroom_form_discussionOff()}</option>
			</select>
			<!-- Reading and posting are separate questions; only the first is configurable, because
			     letting strangers post into somebody's course would be a different feature. -->
			<span class="hint">{m.classroom_form_discussionHint()}</span>
		</label>
	</fieldset>

	<fieldset>
		<legend>{m.classroom_form_contributionLegend()}</legend>
		<label class="field">
			<span>{m.classroom_form_contributionPolicy()}</span>
			<select bind:value={contributionPolicy}>
				<option value="approval">{m.classroom_form_contributionApproval()}</option>
				<option value="open">{m.classroom_form_contributionOpen()}</option>
				<option value="staff">{m.classroom_form_contributionStaff()}</option>
			</select>
			<!-- Approval is the default because it is the only value that is safe to pick on somebody's
			     behalf: an unattended course neither accepts uploads silently nor refuses them. -->
			<span class="hint">{m.classroom_form_contributionHint()}</span>
		</label>
	</fieldset>

	<fieldset>
		<legend>{m.classroom_form_announceLegend()}</legend>
		<label class="check">
			<input type="checkbox" bind:checked={announceNewLessons} />
			<span>{m.classroom_form_announceLessons()}</span>
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={announceNewPosts} />
			<span>{m.classroom_form_announcePosts()}</span>
		</label>
		<!-- Said plainly, because it is the thing that makes these switches safe to leave on: each
		     participant can still mute the course, and their account settings win over both. -->
		<span class="hint">{m.classroom_form_announceHint()}</span>
	</fieldset>

	{#if error}
		<p class="error">{error}</p>
	{/if}

	<button type="submit" class="primary" disabled={submitting}>{submitLabel}</button>
</form>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.row {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		> :global(*) {
			flex: 1;
			min-width: 10rem;
		}
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 500;
	}
	.hint {
		font-weight: 400;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	/* A fieldset carries the group's accessible name on its legend, which a div of radios cannot do:
	   without it a screen reader announces three unlabelled options and never says what they choose
	   between. Its default border/padding are reset because every other control here is borderless. */
	.choice-set {
		border: none;
		margin: 0;
		padding: 0;
		gap: var(--space-2);
	}
	.choice-set legend {
		padding: 0;
		font-weight: 500;
	}
	.choice {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		font-weight: 400;
	}
	/* The radio must not stretch to the height of a two-line label, and must not shrink when the
	   description wraps. */
	.choice input {
		flex: none;
		margin-top: 2px;
	}
	.choice__body {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.choice__label {
		font-weight: 500;
	}
	.choice__hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.choice-set__note {
		margin: var(--space-1) 0 0;
		font-size: var(--font-size-xs);
		font-weight: 400;
		color: var(--text-secondary);
	}
	input,
	select,
	textarea {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		font: inherit;
	}
	fieldset {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: var(--space-3);
	}
	legend {
		font-size: var(--font-size-sm);
		font-weight: 600;
		padding: 0 var(--space-1);
	}
	.check {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
	}
	.error {
		color: var(--status-danger);
		font-size: var(--font-size-sm);
	}
	.primary {
		@include mix.button-primary;
		align-self: flex-start;
	}
</style>
