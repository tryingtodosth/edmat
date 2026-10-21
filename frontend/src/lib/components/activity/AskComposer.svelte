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
     (AUDIENCE-BRIEF.md §1); the language defaults to the interface language, as everywhere.

     2026-10-21 — the course board (owner: "post pdfs, imgs, notes, comments, links … and link and
     be linked to specific courses/subcourses"): the form may be opened ABOUT a course
     (`/ask?course=`, the course page's "Post about this course"), which sets the post's
     `ref_course` so the course's Board tab lists it; and it takes files and an outside link,
     which become attachments on the post (`attachments/`, the `post` target kind) once the post
     exists — the same rows the post's own page draws and lets the author add to later. -->
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
	import { createAttachment } from '$lib/services/attachments';
	import CoursePicker from '$lib/components/shared/CoursePicker.svelte';
	import { ApiError } from '$lib/api/client';
	import { tagRefusalMessage } from '$lib/utils/labels';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import { untrack } from 'svelte';

	let {
		tag = '',
		course = null,
		onCreated
	}: {
		/** A tag to start from (the tag page, or `/ask?tag=`). Still changeable. */
		tag?: string;
		/** The course this post is ABOUT (`/ask?course=`): its id and title. The post references it
		 *  and the course's board lists it. */
		course?: { id: string; title: string } | null;
		onCreated: (post: Post) => void;
	} = $props();

	// Seeded once from the prop: after that the picker owns it, and a parent re-render must not
	// undo the reader's own "change".
	let chosenTag = $state(untrack(() => tag));
	// A NEW tag's name, when the reader chose "Create tag …" in the picker (WP16). The server makes
	// it with the question, or reuses the tag it folds to (`exercises/tags.py`).
	let newTagName = $state('');

	// When no course was preset (`/ask` opened from the hero), the reader may still pick one — the
	// post then shows on that course's board (2026-10-21, "give user a list instead").
	let pickedCourse = $state<string | null>(null);
	let body = $state('');
	let audience = $state<Audience | ''>('');
	let language = $state(getLocale());
	let showPreview = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);

	// --- what rides along: files and a link, as attachments on the post ------------------------
	// Offered only while `attachments` is on (house rule 3): the rows would be refused otherwise.
	const attachmentsOn = $derived(
		featureFlagsStore.isEnabled('attachments') || authStore.isModerator
	);
	let files = $state<File[]>([]);
	let fileInput = $state<HTMLInputElement | null>(null);
	let linkUrl = $state('');
	let linkTitle = $state('');
	/** How many of the attachments could not be added — said in the notice, never swallowed: the
	 *  post is published either way, and "your PDF did not go up" is worth a sentence. */
	let attachFailures = $state(0);
	let linkBad = $derived(Boolean(linkUrl.trim()) && !/^https?:\/\//i.test(linkUrl.trim()));

	function onFiles(event: Event) {
		files = Array.from((event.currentTarget as HTMLInputElement).files ?? []);
	}

	async function attachAll(post: Post) {
		attachFailures = 0;
		for (const file of files) {
			try {
				await createAttachment('post', post.id, {
					kind: 'file',
					title: file.name,
					visibility: 'public',
					file
				});
			} catch {
				attachFailures += 1;
			}
		}
		const url = linkUrl.trim();
		if (url && !linkBad) {
			try {
				await createAttachment('post', post.id, {
					kind: 'link',
					title: linkTitle.trim() || url,
					visibility: 'public',
					url
				});
			} catch {
				attachFailures += 1;
			}
		}
	}

	let missing = $derived(
		!body.trim() ? 'body' : !chosenTag && !newTagName ? 'tag' : !audience ? 'audience' : ''
	);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy || missing || !audience) return;
		busy = true;
		error = null;
		try {
			const post = await createPost({
				body,
				audience,
				language,
				refCourseId: course?.id ?? pickedCourse ?? undefined,
				...(newTagName ? { tagName: newTagName } : { tagSlug: chosenTag })
			});
			if (attachmentsOn && (files.length > 0 || linkUrl.trim())) await attachAll(post);
			body = '';
			files = [];
			if (fileInput) fileInput.value = '';
			linkUrl = '';
			linkTitle = '';
			onCreated({ ...post, attachmentCount: post.attachmentCount + files.length });
		} catch (e) {
			// A new tag's refusal carries its own word (house rule 6) — including its own 429, the
			// hourly bound on NEW tags. Otherwise 429 is the per-account posting throttle, and
			// anything else is most likely the tag having been removed by a moderator between
			// loading the picker and pressing the button.
			error =
				tagRefusalMessage(e) ??
				(e instanceof ApiError && e.status === 429
					? m.ask_errorThrottled() // "That is a lot of questions for one hour. Try again a little later."
					: m.ask_errorGeneric()); // "Could not publish the question. Check the tag and try again."
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

	{#if course}
		<p class="ask__about" data-ask-about>
			{m.ask_aboutCourse({ title: course.title })}
			<!-- "About the course “{title}” — it will show on that course's board." -->
		</p>
	{:else}
		<CoursePicker bind:value={pickedCourse} id="ask-course" label={m.ask_aboutCoursePick()} />
		<!-- "About a course (optional) — the post then shows on its board" -->
	{/if}

	<TagPicker bind:value={chosenTag} bind:newName={newTagName} id="ask-tag" />

	{#if attachmentsOn}
		<div class="ask__attach">
			<label class="ask__field ask__field--block">
				<span>{m.ask_filesLabel()}</span>
				<!-- "Attach files (optional)" -->
				<input type="file" multiple bind:this={fileInput} onchange={onFiles} />
				<span class="ask__hint">{m.ask_filesHint()}</span>
				<!-- "A PDF, a picture, a .docx, or a .md/.txt note — which is shown as text. Added to the post once it is published." -->
			</label>
			<label class="ask__field ask__field--block">
				<span>{m.ask_linkLabel()}</span>
				<!-- "A link (optional)" -->
				<input type="text" inputmode="url" bind:value={linkUrl} placeholder="https://…" />
			</label>
			{#if linkUrl.trim()}
				<label class="ask__field ask__field--block">
					<span>{m.ask_linkTitleLabel()}</span>
					<!-- "What the link is" -->
					<input type="text" bind:value={linkTitle} maxlength="200" />
				</label>
			{/if}
			{#if linkBad}
				<p class="ask__hint ask__hint--warn">{m.ask_linkBad()}</p>
				<!-- "A link starts with http:// or https://." -->
			{/if}
		</div>
	{/if}

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
	{#if missing && (body.trim() || chosenTag || newTagName)}
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
	{#if attachFailures > 0}
		<p class="ask__error" role="alert">{m.ask_attachFailed({ count: attachFailures })}</p>
		<!-- "{count} attachment(s) could not be added — you can add them again from the post's page." -->
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
	.ask__hint,
	.ask__about {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.ask__about {
		font-size: var(--font-size-sm);
	}
	.ask__hint--warn {
		@include mix.status-message(warning);
	}
	.ask__attach {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-2);
		border: 1px dashed var(--border-color);
		border-radius: var(--radius-sm);
	}
	.ask__field--block {
		flex-direction: column;
		align-items: stretch;
		input[type='text'] {
			font: inherit;
			padding: var(--space-1);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
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
