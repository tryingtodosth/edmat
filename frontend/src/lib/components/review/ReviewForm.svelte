<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import StarRating from '$lib/components/shared/StarRating.svelte';

	let {
		onSubmit,
		// Given a label, the form is behind one button carrying it until somebody asks (owner,
		// 2026-10-09: an input nobody has asked for should not be sitting on the page). Left out by
		// the exercise page, where this form is already inside a modal somebody opened on purpose.
		//
		// `CommentForm` has the same three lines (house rule 13: this is strike two, flagged in
		// both files rather than extracted — a third collapsing form earns the shared one).
		collapsedLabel = undefined
	}: { onSubmit: (rating: number, body: string) => void; collapsedLabel?: string } = $props();

	let rating = $state(0);
	let body = $state('');
	let composing = $state(false);

	function submit() {
		if (rating < 1) return;
		onSubmit(rating, body);
		rating = 0;
		body = '';
		if (collapsedLabel) composing = false;
	}
</script>

{#if collapsedLabel && !composing}
	<button type="button" class="review-form__open" onclick={() => (composing = true)}
		>{collapsedLabel}</button
	>
{:else}
	<form class="review-form" onsubmit={(e) => (e.preventDefault(), submit())}>
		<label class="field">
			<span>{m.review_yourRating()}</span>
			<StarRating value={rating} interactive onChange={(n) => (rating = n)} />
		</label>
		<label class="field">
			<span class="visually-hidden">{m.review_commentPlaceholder()}</span>
			<textarea rows="2" placeholder={m.review_commentPlaceholder()} bind:value={body}></textarea>
		</label>
		<button type="submit" class="submit" disabled={rating < 1}>{m.review_submit()}</button>
	</form>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	// The quiet button that stands in for the form, drawn exactly as `CommentForm`'s does.
	.review-form__open {
		@include mix.button-secondary;
		align-self: flex-start;
		padding: var(--space-1) var(--space-3);
		font-size: var(--font-size-xs);
	}
	.review-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 500;
	}
	textarea {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		resize: vertical;
	}
	.submit {
		@include mix.button-primary;
		align-self: flex-start;
	}
	.visually-hidden {
		@include mix.visually-hidden;
	}
</style>
