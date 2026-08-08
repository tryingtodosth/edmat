<script lang="ts">
	// The name a reader sees, the paragraph under it, and whether the profile is public at all.
	//
	// These four fields go together because they are the answer to one question — "what does my profile
	// say about me?" — and they save through one PATCH, which is why they share a modal rather than
	// getting one each. Everything with its own endpoint (the avatar, education, certificates) stays in
	// its own modal, matching the rule the settings page already follows for the same reason: a control
	// that saves on its own must not sit under somebody else's Save button.
	import { m } from '$lib/paraglide/messages.js';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import { authStore } from '$lib/state/auth.svelte';

	let { onClose }: { onClose: () => void } = $props();

	// Seeded once from the store rather than mirrored with `$derived`: this is a form, and a live mirror
	// would overwrite what somebody is typing the moment anything else refreshed the session.
	let displayName = $state(authStore.user?.displayName ?? '');
	let bio = $state(authStore.user?.bio ?? '');
	let showPublicly = $state(authStore.user?.showProfilePublicly ?? true);
	let offersTutoring = $state(authStore.user?.offersTutoring ?? false);
	let tutoringNote = $state(authStore.user?.tutoringNote ?? '');

	let busy = $state(false);
	let error = $state('');

	/** The model's own cap. Enforced here too so somebody learns before submitting rather than from a
	 * 400 after writing three paragraphs. */
	const BIO_LIMIT = 1000;

	async function save(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = '';
		const result = await authStore.updateProfile({
			displayName: displayName.trim(),
			bio: bio.trim(),
			showProfilePublicly: showPublicly,
			offersTutoring,
			tutoringNote: tutoringNote.trim()
		});
		busy = false;
		if (result.ok) {
			onClose();
		} else {
			error = result.error;
		}
	}
</script>

<ModalShell title={m.profile_edit_basicsHeading()} {onClose}>
	<!-- "Name and bio" -->
	<form class="edit-form" onsubmit={save}>
		<label>
			{m.settings_displayName()}
			<!-- "Display name" -->
			<input type="text" bind:value={displayName} />
		</label>

		<label>
			{m.profile_edit_bio()}
			<!-- "About you" -->
			<textarea rows="5" maxlength={BIO_LIMIT} bind:value={bio}></textarea>
			<span class="hint">{m.profile_edit_bioHint({ left: BIO_LIMIT - bio.length })}</span>
			<!-- "{left} characters left. Shown to anybody who opens your profile." -->
		</label>

		<label class="checkbox">
			<input type="checkbox" bind:checked={showPublicly} />
			<span>
				{m.settings_showProfilePublicly()}
				<!-- "Show my profile publicly" -->
				<span class="hint">{m.profile_edit_privacyHint()}</span>
				<!-- "Off hides your join date and badges from strangers. Your name stays visible wherever
				     you have posted — hiding that would break the comment, not the profile." -->
			</span>
		</label>

		<label class="checkbox">
			<input type="checkbox" bind:checked={offersTutoring} />
			<span>{m.settings_offersTutoring()}</span>
			<!-- "I'm open to being asked about tutoring" -->
		</label>
		{#if offersTutoring}
			<label>
				{m.settings_tutoringNote()}
				<!-- "Short note" -->
				<input type="text" maxlength="200" bind:value={tutoringNote} />
			</label>
		{/if}

		<div class="actions">
			<button type="submit" class="primary" disabled={busy}>{m.common_save()}</button>
			<button type="button" disabled={busy} onclick={onClose}>{m.common_cancel()}</button>
		</div>
		{#if error}
			<p class="error">{error}</p>
		{/if}
	</form>
</ModalShell>

<style lang="scss">
	@use '../../../styles/mixins' as mix;

	.edit-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--font-size-sm);
	}
	.checkbox {
		flex-direction: row;
		align-items: flex-start;
		gap: var(--space-2);
		input {
			margin-top: 3px;
		}
		span {
			display: flex;
			flex-direction: column;
		}
	}
	input[type='text'],
	textarea {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		color: var(--text-primary);
		font: inherit;
	}
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.primary {
		@include mix.button-primary;
	}
	.actions button:not(.primary) {
		@include mix.button-secondary;
	}
	.error {
		font-size: var(--font-size-sm);
		color: var(--status-danger);
	}
</style>
