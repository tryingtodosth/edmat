<script lang="ts">
	/**
	 * One concept, read.
	 *
	 * The page a reader gets is RESOLVED, not requested: their band and language are tried first,
	 * then `all`, then the nearest band, then any language (`backend/concepts/resolve.py`). A
	 * concept page never 404s while any article is published, because a shared link has to resolve
	 * — and `PageSwitcher` says in words when what is on screen is not the reader's own page.
	 *
	 * `?audience=`, `?lang=` and `?article=` are explicit picks that beat the stored preference,
	 * which is what makes "here, read the primary-school one" a link somebody can send.
	 *
	 * The thread is a real `Comment` thread on a `conceptArticle` target, so reporting, tombstones,
	 * votes and the tree builder all come for free (the polymorphic-target shape, root CLAUDE.md).
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { formatDate } from '$lib/utils/datetime';
	import { authStore } from '$lib/state/auth.svelte';
	import DiscussionThread from '$lib/components/discussion/DiscussionThread.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import ReportButton from '$lib/components/shared/ReportButton.svelte';
	import TagChip from '$lib/components/shared/TagChip.svelte';
	import ArticlePool from '$lib/components/concept/ArticlePool.svelte';
	import BlockRenderer from '$lib/components/concept/BlockRenderer.svelte';
	import ConceptLinks from '$lib/components/concept/ConceptLinks.svelte';
	import PageSwitcher from '$lib/components/concept/PageSwitcher.svelte';
	import {
		CONCEPTS_FLAG,
		messageForError,
		REVISION_STATUS_LABELS
	} from '$lib/components/concept/labels';
	import { getConcept, setArticlePinned } from '$lib/services/concepts';
	import { getCommentsForTarget, submitComment } from '$lib/services/comments';
	import { getUserById } from '$lib/services/users';
	import type { Comment, CommentTargetType, ReportKind, TaggableKind, User } from '$lib/types';
	import type { Concept, ConceptArticleSummary, ConceptLink } from '$lib/types/concept';

	// The three platform-wide unions this page is a member of, named once rather than spelled at
	// each call site — `community/targets.py`, `moderation/services.py`'s REPORT_KIND_MODELS and
	// `exercises/views.py`'s TagViewSet.apply are the backend halves.
	const COMMENT_TARGET: CommentTargetType = 'conceptArticle';
	const REPORT_KIND: ReportKind = 'concept_article';
	const TAGGABLE_KIND: TaggableKind = 'concept';

	let concept = $state<Concept | null>(null);
	let links = $state<ConceptLink[]>([]);
	let comments = $state<Comment[]>([]);
	let usersById = $state<Record<string, User>>({});
	let loading = $state(true);
	let notFound = $state(false);
	let error = $state('');

	const article = $derived(concept?.page?.article ?? null);
	const head = $derived(article?.head ?? null);
	const branchId = $derived(concept?.branchIds[0] ?? '');
	const branchName = $derived(concept?.branchNames[0] ?? '');

	async function resolveUsers(ids: string[]) {
		const unique = [...new Set(ids)].filter((id) => !usersById[id]);
		if (unique.length === 0) return;
		const found = await Promise.all(unique.map((id) => getUserById(id)));
		const next = { ...usersById };
		for (const user of found) if (user) next[user.id] = user;
		usersById = next;
	}

	async function load(slug: string, search: string) {
		loading = true;
		notFound = false;
		error = '';
		comments = [];
		const params = new URLSearchParams(search);
		const found = await getConcept(slug, {
			audience: params.get('audience') ?? undefined,
			locale: params.get('lang') ?? undefined,
			articleId: params.get('article') ?? undefined
		});
		if (!found) {
			notFound = true;
			concept = null;
			loading = false;
			return;
		}
		concept = found;
		links = found.links;
		loading = false;

		const current = found.page?.article;
		if (current) {
			comments = await getCommentsForTarget(COMMENT_TARGET, current.id).catch(() => []);
			await resolveUsers(comments.map((c) => c.authorId));
		}
	}

	// The id-changed guard, keyed on the slug, the query string AND the session (traps 2 and 3
	// together): `$effect` re-fires with no navigation at all, and a hard reload resolves the
	// session only after the first paint.
	let loadedFor = $state<string | null>(null);
	$effect(() => {
		const slug = page.params.slug!;
		const key = `${slug}|${page.url.search}|${authStore.user?.id ?? 'anon'}`;
		if (key === loadedFor) return;
		loadedFor = key;
		void load(slug, page.url.search);
	});

	async function pin(target: ConceptArticleSummary, pinned: boolean) {
		error = '';
		try {
			await setArticlePinned(target.id, pinned);
			// Re-read rather than patch: pinning reorders the pool, and the order is the server's.
			loadedFor = null;
		} catch (e) {
			error = messageForError(e);
		}
	}

	async function postComment(body: string, parentId?: string): Promise<Comment | void> {
		const current = article;
		if (!current || !authStore.user) return;
		const comment = await submitComment(
			COMMENT_TARGET,
			current.id,
			authStore.user.id,
			body,
			parentId
		);
		comments = [...comments, comment];
		await resolveUsers([comment.authorId]);
		return comment;
	}
</script>

<!-- The resolved article's title, falling back to "Concepts"; the description is the article's own
     summary where it has one, else "A community-written page about this idea." -->
<PageHead
	title={head?.title || concept?.slug || m.concept_hub_heading()}
	description={head?.summary || m.concept_seo_detail()}
/>

<FeatureGate feature={CONCEPTS_FLAG}>
	<div class="page">
		{#if loading}
			<p class="hint">{m.common_loading()}</p>
			<!-- "Loading…" -->
		{:else if notFound || !concept}
			<p class="hint">{m.concept_detail_notFound()}</p>
			<!-- "There is no such concept." -->
		{:else}
			<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
				<a href={resolve('/concepts')}>{m.concept_hub_heading()}</a>
				<!-- "Concepts" -->
				{#if branchId}
					›
					<a href={resolve('/branches/[branch]', { branch: branchId })}>{branchName}</a>
				{/if}
			</nav>

			<PageSwitcher slug={concept.slug} pages={concept.pages} current={concept.page} />

			{#if error}<p class="error">{error}</p>{/if}

			{#if !article || !head}
				<h1>{concept.slug}</h1>
				<p class="hint">{m.concept_detail_nothingYet()}</p>
				<!-- "Nobody has written this one yet." -->
				{#if authStore.isAuthenticated}
					<a class="action" href={resolve('/concepts/[slug]/write', { slug: concept.slug })}>
						{m.concept_detail_writeFirst()}
						<!-- "Write the first article" -->
					</a>
				{/if}
			{:else}
				<article class="article">
					<header>
						<h1><MathTitle text={head.title} /></h1>
						<p class="meta">
							{#if article.createdByDisplayName}
								<span>{m.concept_by({ name: article.createdByDisplayName })}</span>
								<!-- "by {name}" -->
							{/if}
							<span>{m.concept_revisions_number({ number: head.number })}</span>
							<!-- "Revision {number}" -->
							{#if head.publishedAt}
								<span>{formatDate(head.publishedAt)}</span>
							{/if}
						</p>
						{#if head.summary}
							<p class="summary">{head.summary}</p>
						{/if}
					</header>

					<BlockRenderer blocks={head.blocks} />

					<div class="actions">
						{#if authStore.isAuthenticated}
							<a
								class="action"
								href={resolve('/concepts/[slug]/articles/[id]/edit', {
									slug: concept.slug,
									id: article.id
								})}
							>
								{m.concept_detail_edit()}
								<!-- "Improve this article" -->
							</a>
						{/if}
						<a
							class="action"
							href={resolve('/concepts/[slug]/articles/[id]/history', {
								slug: concept.slug,
								id: article.id
							})}
						>
							{m.concept_detail_history()}
							<!-- "History" -->
						</a>
						<ReportButton kind={REPORT_KIND} objectId={article.id} />
					</div>
				</article>

				<ArticlePool
					slug={concept.slug}
					articles={concept.page?.articles ?? []}
					currentId={article.id}
					audience={concept.page?.audience ?? ''}
					locale={concept.page?.locale ?? ''}
					canPin={concept.canPin}
					canWrite={authStore.isAuthenticated}
					onpin={pin}
				/>
			{/if}

			{#if concept.myOpen.length > 0}
				<section class="mine">
					<h2>{m.concept_detail_yourOpen()}</h2>
					<!-- "Your unfinished work here" -->
					<ul>
						{#each concept.myOpen as open (open.revisionId)}
							<li>
								<a
									href={resolve('/concepts/[slug]/articles/[id]/edit', {
										slug: concept.slug,
										id: open.articleId
									})}
								>
									{m.concept_detail_openRevision({
										status: REVISION_STATUS_LABELS[open.status]()
									})}
									<!-- "A revision: {status}" — the status is the LABEL, never the raw wire
									     value, which is English either way. -->
								</a>
								<span class="when">{formatDate(open.updatedAt)}</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if concept.tags.length > 0}
				<p class="tags">
					{#each concept.tags as tag (tag)}
						<TagChip
							{tag}
							appliedTo={{
								kind: TAGGABLE_KIND,
								objectId: concept.id,
								onRemoved: () => (loadedFor = null)
							}}
						/>
					{/each}
				</p>
			{/if}

			<ConceptLinks
				slug={concept.slug}
				bind:links
				backlinks={concept.backlinks}
				blockReason={concept.linkBlockReason}
			/>

			{#if article}
				<section class="discussion">
					<h2>{m.discussion_heading()}</h2>
					<!-- "Discussion" -->
					<DiscussionThread
						{comments}
						{usersById}
						onSubmit={postComment}
						canPost={authStore.isAuthenticated}
					/>
				</section>
			{/if}
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 820px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.breadcrumb {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);

		a {
			color: var(--accent);
		}
	}
	.article {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);

		h1 {
			margin: 0;
		}
	}
	.meta {
		margin: 0;
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.summary {
		margin: 0;
		color: var(--text-secondary);
	}
	.actions {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		align-items: center;
	}
	.action {
		font-size: var(--font-size-sm);
		color: var(--accent);
	}
	.mine {
		@include mix.card-surface;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);

		h2 {
			margin: 0;
			font-size: var(--font-size-sm);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--text-secondary);
		}
		ul {
			list-style: none;
			margin: 0;
			padding: 0;
			display: flex;
			flex-direction: column;
			gap: var(--space-1);
		}
		li {
			display: flex;
			gap: var(--space-2);
			align-items: baseline;
			font-size: var(--font-size-sm);
		}
		a {
			color: var(--accent);
		}
	}
	.discussion {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);

		h2 {
			margin: 0;
			font-size: var(--font-size-sm);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--text-secondary);
		}
	}
	.tags {
		margin: 0;
		display: flex;
		gap: var(--space-1);
		flex-wrap: wrap;
	}
	.when,
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.hint {
		margin: 0;
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		margin: 0;
		align-self: flex-start;
		white-space: normal;
	}
</style>
