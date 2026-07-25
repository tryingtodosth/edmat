<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import StarRating from '$lib/components/shared/StarRating.svelte';

	let { onSubmit }: { onSubmit: (rating: number, body: string) => void } = $props();

	let rating = $state(0);
	let body = $state('');

	function submit() {
		if (rating < 1) return;
		onSubmit(rating, body);
		rating = 0;
		body = '';
	}
</script>

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

<style lang="scss">
	@use '../../styles/mixins' as mix;

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
