<!-- "Ask a question" (WP15, 2026-10-15 — the owner's "ask as ppl should be allowed to post in tags").

     A question IS a post anchored to a tag: the same `POST /api/posts/`, the same throttle, kill
     switch, minors hold, report button and reply thread every post already has. There is no
     "question" field on `Post` and this form does not invent one — the owner's words are satisfied
     by "a post in a tag", and a second kind would be a filter nobody asked for and one more thing
     to keep consistent. What this form changes is the FRAMING: it asks for the question and the
     tag, and nothing else a general post offers (no branch or discipline anchor, no reference, no
     picture — a picture into a minor band is held anyway, and a question that needs one can be
     written as an ordinary post from /activity).

     The audience band is asked because every submit form here asks it with no default
     (AUDIENCE-BRIEF.md §1); the language defaults to the interface language, as everywhere. -->
<script lang="ts">
	import RichEditor from '$lib/components/editor/RichEditor.svelte';
	import AudienceSelect from '$lib/components/shared/AudienceSelect.svelte';
	import ContentLocaleSelect from '$lib/components/shared/ContentLocaleSelect.svelte';
	import TagPicker from '$lib/components/shared/TagPicker.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import type { Audience, Post } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { createPost } from '$lib/services/activity';
	import { ApiError } from '$lib/api/client';
	import { untrack } from 'svelte';

	let {
		tag = '',
		onCreated
	}: {
		/** A tag to start from (the tag page, or `/ask?tag=`). Still changeable. */
		tag?: string;
		onCreated: (post: Post) => void;
	} = $props();

	// Seeded once from the prop: after that the picker owns it, and a parent re-render must not
	// undo the reader's own "change".
	let chosenTag = $state(untrack(() => tag));

	let body = $state('');
	let audience = $state<Audience | ''>('');
	let language = $state(getLocale());
	let showPreview = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);

	let missing = $derived(!body.trim() ? 'body' : !chosenTag ? 'tag' : !audience ? 'audience' : '');

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy || missing || !audience) return;
		busy = true;
		error = null;
		try {
			const post = await createPost({ body, audience, language, tagSlug: chosenTag });
			body = '';
			onCreated(post);
		} catch (e) {
			// 429 is the per-account posting throttle; anything else is most likely the tag having
			// been removed by a moderator between loading the picker and pressing the button.
			error =
				e instanceof ApiError && e.status === 429
					? m.ask_errorThrottled() // "That is a lot of questions for one hour. Try again a little later."
					: m.ask_errorGeneric(); // "Could not publish the question. Check the tag and try again."
		} finally {
			busy = false;
		}
	}
</script>

<form class="ask" onsubmit={submit} aria-label={m.ask_formLabel()}>
	<!-- "Your question" -->
	<label class="ask__label" for="ask-body">{m.ask_bodyLabel()}</label>
	<!-- "Your question" -->
	<RichEditor id="ask-body" bind:value={body} placeholder={m.ask_bodyPlaceholder()} rows={5} />
	<!-- "What are you stuck on? Write it the way you would ask a friend — maths goes between \( and \)." -->

	<TagPicker bind:value={chosenTag} id="ask-tag" />

	<div class="ask__row">
		<AudienceSelect bind:value={audience} />
		<label class="ask__field">
			<span>{m.contentLocales_fieldLanguage()}</span>
			<!-- "Language" -->
			<ContentLocaleSelect bind:value={language} />
		</label>
	</div>

	<p class="ask__note">{m.ask_publicNote()}</p>
	<!-- "Your question is public at once, under the tag, with your name. Anyone signed in can answer underneath." -->

	<div class="ask__actions">
		<button type="submit" class="primary" disabled={busy || !!missing}
			>{busy ? m.common_loading() : m.ask_publish()}</button
		>
		<!-- "Ask" -->
		<button type="button" class="secondary" onclick={() => (showPreview = !showPreview)}
			>{showPreview ? m.entry_hidePreview() : m.entry_showPreview()}</button
		>
	</div>
	{#if missing && (body.trim() || chosenTag)}
		<p class="ask__hint">
			{missing === 'body'
				? m.ask_missingBody() // "Write the question first."
				: missing === 'tag'
					? m.ask_missingTag() // "Pick a tag, so the right people see it."
					: m.ask_missingAudience()}
			<!-- "Say who it is for." -->
		</p>
	{/if}
	{#if showPreview && body.trim()}
		<div class="ask__preview"><MathContent source={body} /></div>
	{/if}
	{#if error}
		<p class="ask__error" role="alert">{error}</p>
	{/if}
</form>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.ask {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
		min-width: 0;
	}
	.ask__label {
		font-size: var(--font-size-sm);
		font-weight: 600;
	}
	.ask__row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		:global(select) {
			font: inherit;
			padding: var(--space-1);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
			max-width: 100%;
		}
		:global(.field) {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--space-2);
			font-size: var(--font-size-xs);
			font-weight: 600;
			color: var(--text-secondary);
		}
	}
	.ask__field {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--text-secondary);
	}
	.ask__note,
	.ask__hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.ask__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.primary {
		@include mix.button-primary;
	}
	.secondary {
		@include mix.button-secondary;
	}
	.ask__preview {
		border: 1px dashed var(--border-color);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
	}
	.ask__error {
		font-size: var(--font-size-sm);
		color: var(--status-danger);
	}
</style>
