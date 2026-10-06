<script lang="ts">
	/**
	 * The discussion under one section of a standing page — `/about`, a showcase page, a manual
	 * chapter. Collapsed to a single quiet line until a reader clicks it, and the thread is not
	 * fetched until then (`services/discussions.ts` argues the two-request split).
	 *
	 * **Not `DiscussionThread.svelte`**, although it renders the same `CommentNode`s. That
	 * component is used by eleven pages and hardcodes two things this surface cannot accept: a
	 * composer only for `authStore.isAuthenticated` (a location set to `anyone` must offer one to a
	 * visitor) and one "sign in to comment" line for every refusal (there are five words here, and
	 * each is a different sentence — house rule 6). Widening it would have put regression risk on
	 * eleven threads nobody asked me to touch; three strikes before extracting a shared one
	 * (house rule 13), and this is the first.
	 *
	 * The parent page owns the policy. It asks for every section in one request and hands each
	 * section its own — so this component never fetches a policy and a page never fires one request
	 * per section.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { authStore } from '$lib/state/auth.svelte';
	import { buildCommentTree } from '$lib/utils/commentTree';
	import { discussionRefusalMessage } from '$lib/utils/labels';
	import { postAt, threadAt } from '$lib/services/discussions';
	import type { DiscussionPolicy } from '$lib/types/discussion';
	import type { Comment } from '$lib/types';
	import CommentForm from './CommentForm.svelte';
	import CommentNode from './CommentNode.svelte';

	let {
		policy,
		/** The heading this thread sits under, for the collapsed line's accessible name — "Comments
		 *  on Enrolling" rather than twelve buttons all called "Comments". */
		sectionTitle
	}: {
		policy: DiscussionPolicy;
		sectionTitle: string;
	} = $props();

	let open = $state(false);
	let loading = $state(false);
	let error = $state('');
	let comments = $state<Comment[]>([]);
	// What the collapsed line shows. `null` until the thread has actually been loaded, and then
	// whatever it contained — so posting updates the count without another round trip.
	//
	// A `$state(policy.commentCount)` would have captured the prop at init, which `svelte-check`
	// rightly warns about: the policy arrives asynchronously (the page fetches every section's in
	// one request), so at init it is whatever the first render had and the count would never
	// correct itself.
	let loadedCount = $state<number | null>(null);
	/** What the collapsed line's number means, in one place.
	 *
	 * Not `comments.length`: the thread deliberately carries tombstones (so a thread whose middle
	 * was removed keeps its shape, house rule 12) and, for staff and for their own author, rows
	 * that are still held — so the raw length could read "(3)" for one real comment, one
	 * placeholder and one thing waiting for a moderator. The two server-side counts
	 * (`DiscussionPolicyView`, `DiscussionLocationSerializer`) have always counted public comments
	 * only, and this is the third place that number is printed; it has to agree with them or the
	 * line changes its mind the moment a reader opens it. `discussions.py`, "What \"N comments\"
	 * counts", argues it from the server's side. */
	const publicCount = (list: Comment[]) =>
		list.filter((c) => !c.isRemoved && !c.isAutoHidden).length;
	let anonName = $state('');
	let justHeld = $state(false);

	let tree = $derived(buildCommentTree(comments));
	let count = $derived(loadedCount ?? policy.commentCount);
	let refusal = $derived(policy.canPost ? '' : discussionRefusalMessage(policy.postBlockReason));
	// A visitor with no account, writing where the location allows it. The one case that needs a
	// name field: a signed-in comment is bylined by its account.
	let wantsName = $derived(policy.canPost && !authStore.isAuthenticated);

	async function toggle() {
		if (open) {
			open = false;
			return;
		}
		open = true;
		if (comments.length > 0 || loading) return;
		loading = true;
		error = '';
		try {
			const thread = await threadAt(policy.page, policy.section);
			comments = thread.comments;
			loadedCount = publicCount(thread.comments);
		} catch {
			error = m.discussions_loadFailed(); // "This discussion could not be loaded."
		} finally {
			loading = false;
		}
	}

	async function submit(body: string, parentId?: string) {
		error = '';
		justHeld = false;
		try {
			const created = await postAt(policy.page, policy.section, body, {
				parentId,
				anonName: anonName.trim()
			});
			if (created.isHeld) {
				// Held comments are not public, so it must NOT be spliced into the thread as if it
				// were — the writer is told instead (house rule 10). A signed-in writer will see it
				// on the next load, because the server shows an author their own held comment; a
				// visitor will not, and the sentence says so.
				justHeld = true;
				return;
			}
			comments = [...comments, created];
			loadedCount = publicCount(comments);
			anonName = '';
		} catch {
			error = m.discussions_postFailed(); // "This could not be posted."
		}
	}
</script>

<!-- Nothing at all when the location is off: a kill switch takes the links away, not just the
     pages (house rule 3). The page's prose is unaffected. -->
{#if policy.isEnabled}
	<div class="section-discussion">
		<button type="button" class="section-discussion__toggle" aria-expanded={open} onclick={toggle}>
			<span class="section-discussion__chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
			{#if count > 0}
				{m.discussions_toggleWithCount({ title: sectionTitle, count })}
				<!-- "Comments on {title} ({count})" -->
			{:else}
				{m.discussions_toggleEmpty({ title: sectionTitle })}
				<!-- "Comment on {title}" -->
			{/if}
		</button>

		{#if open}
			<div class="section-discussion__body">
				{#if loading}
					<p class="section-discussion__muted">{m.common_loading()}</p>
				{:else}
					{#if error}<p class="section-discussion__error" role="alert">{error}</p>{/if}

					{#if tree.length === 0}
						<p class="section-discussion__muted">{m.discussion_noComments()}</p>
						<!-- "No comments yet." -->
					{:else}
						<ul class="section-discussion__roots">
							{#each tree as node (node.comment.id)}
								<CommentNode
									{node}
									usersById={{}}
									onReply={(parentId, body) => submit(body, parentId)}
								/>
							{/each}
						</ul>
					{/if}

					{#if justHeld}
						<p class="section-discussion__held" role="status">
							{m.discussions_heldNotice()}
							<!-- "Thank you — a moderator will look at this before it appears." -->
						</p>
					{/if}

					{#if policy.canPost}
						{#if policy.heldForYou && !justHeld}
							<p class="section-discussion__muted">
								{m.discussions_willBeHeld()}
								<!-- "Comments here are read by a moderator before they appear." -->
							</p>
						{/if}
						{#if wantsName}
							<label class="section-discussion__name">
								{m.discussions_yourName()}
								<!-- "Your name (optional)" -->
								<input type="text" maxlength="40" bind:value={anonName} />
							</label>
						{/if}
						<CommentForm
							placeholder={m.discussion_composerPlaceholder()}
							submitLabel={m.discussion_post()}
							onSubmit={(body) => submit(body)}
						/>
					{:else if policy.postBlockReason === 'anonymous'}
						<p class="section-discussion__muted">
							<a href={resolve('/login')}>{m.discussion_loginToComment()}</a>
						</p>
					{:else}
						<p class="section-discussion__muted">{refusal}</p>
					{/if}
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style lang="scss">
	// Subtle is the requirement, so the collapsed state is one line of secondary text with no
	// border, no background and no button chrome — it reads as part of the prose until somebody
	// looks for it. Everything that makes it look like a control appears on hover and on focus.
	.section-discussion {
		margin-top: var(--space-2);
	}
	.section-discussion__toggle {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-1);
		background: none;
		border: 0;
		padding: 0;
		font: inherit;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		cursor: pointer;
		&:hover,
		&:focus-visible {
			color: var(--accent);
			text-decoration: underline;
		}
	}
	.section-discussion__chevron {
		font-size: 0.8em;
	}
	.section-discussion__body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-top: var(--space-3);
		// The one piece of structure: a rule down the left, so an open thread is visibly a
		// digression from the section above it rather than more of the same page.
		padding-left: var(--space-3);
		border-left: 2px solid var(--border-color);
	}
	.section-discussion__roots {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		margin: 0;
		padding: 0;
	}
	.section-discussion__muted {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		a {
			color: var(--accent);
			font-weight: 600;
		}
	}
	.section-discussion__error {
		color: var(--danger, #b00020);
		font-size: var(--font-size-sm);
	}
	.section-discussion__held {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		font-style: italic;
	}
	.section-discussion__name {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		input {
			max-width: 18rem;
			padding: var(--space-1) var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--surface);
			color: var(--text-primary);
			font: inherit;
		}
	}
</style>
