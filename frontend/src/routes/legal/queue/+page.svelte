<script lang="ts">
	// Staff-only queue for deciding DSA legal notices — see backend/legal/views.py's `resolve`
	// action. Deliberately its own small page rather than a new tab on `/moderation` (that page
	// already covers a lot of ground; this is a separate, unrelated legal obligation with its own,
	// much smaller review flow).
	import { m } from '$lib/paraglide/messages.js';
	import { formatDate } from '$lib/utils/format';
	import { getLocale } from '$lib/paraglide/runtime';
	import { authStore } from '$lib/state/auth.svelte';
	import { pageTitle } from '$lib/utils/pageTitle';
	import {
		getLegalNotices,
		previewLegalNoticeContent,
		resolveLegalNotice
	} from '$lib/services/legalNotices';
	import type {
		LegalNotice,
		LegalNoticeContentPreview,
		LegalNoticeStatus
	} from '$lib/types/legalNotice';

	const CONTENT_KINDS = [
		'exercise',
		'comment',
		'review',
		'solution_entry',
		'post',
		'event',
		'contribution',
		'service',
		'tag',
		'material',
		'requirement',
		'service_review'
	];

	let notices = $state<LegalNotice[]>([]);
	let loading = $state(true);
	let loadedOnce = $state(false);
	let drafts = $state<
		Record<
			string,
			{ status: Exclude<LegalNoticeStatus, 'open'>; note: string; kind: string; id: string }
		>
	>({});
	let busyId = $state('');
	let errorId = $state('');
	// Who posted the content a notice is about — looked up on demand (a "Look up" button, not an
	// auto-fetch on every keystroke: this is a staff tool, and the id field is free text until
	// submitted, so fetching on every digit typed would spam the endpoint for no benefit). `null`
	// means "not looked up yet"; `'error'` means the lookup itself failed (bad kind, or an id that
	// doesn't exist) — kept distinct from a real, honest "no author on record" result.
	let lookups = $state<Record<string, LegalNoticeContentPreview | 'loading' | 'error' | null>>({});

	async function lookupContent(notice: LegalNotice) {
		const draft = drafts[notice.id];
		if (!draft.kind || !draft.id) return;
		lookups[notice.id] = 'loading';
		try {
			lookups[notice.id] = await previewLegalNoticeContent(notice.id, draft.kind, Number(draft.id));
		} catch {
			lookups[notice.id] = 'error';
		}
	}

	async function load() {
		loading = true;
		try {
			notices = await getLegalNotices();
		} catch {
			notices = [];
		}
		// Seeded up front, one per notice, rather than lazily on first read — `bind:group`/
		// `bind:value` in the template need a plain assignable expression (`drafts[notice.id].status`),
		// which a function call like the old `draftFor(notice)` cannot be bound to at all
		// (Svelte's own "Can only bind to an Identifier or MemberExpression" error).
		for (const notice of notices) {
			if (!drafts[notice.id]) {
				drafts[notice.id] = { status: 'rejected', note: '', kind: '', id: '' };
			}
		}
		loading = false;
	}

	// Same `$effect` + `loadedOnce` shape `routes/moderation/+page.svelte`/`routes/messages/
	// +page.svelte` already use for an auth-gated initial load — `authStore.isModerator` may not
	// have resolved yet at mount on a hard reload (frontend/CLAUDE.md trap #3).
	$effect(() => {
		if (authStore.isModerator && !loadedOnce) {
			loadedOnce = true;
			load();
		}
	});

	async function decide(notice: LegalNotice) {
		const draft = drafts[notice.id];
		busyId = notice.id;
		errorId = '';
		try {
			const updated = await resolveLegalNotice(notice.id, {
				status: draft.status,
				resolveNote: draft.note.trim(),
				contentKind: draft.kind || undefined,
				contentObjectId: draft.id ? Number(draft.id) : undefined
			});
			notices = notices.map((n) => (n.id === notice.id ? updated : n));
		} catch {
			errorId = notice.id;
		} finally {
			busyId = '';
		}
	}
</script>

<svelte:head>
	<title>{pageTitle(m.legalQueue_metaTitle())}</title>
</svelte:head>

<div class="page">
	<h1>{m.legalQueue_heading()}</h1>

	{#if !authStore.isModerator}
		<p class="denied">{m.legalQueue_accessDenied()}</p>
	{:else if loading}
		<p>{m.common_loading()}</p>
	{:else if notices.length === 0}
		<p class="empty">{m.legalQueue_empty()}</p>
	{:else}
		<ul class="notices">
			{#each notices as notice (notice.id)}
				<li class="notice">
					<div class="notice__top">
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a notifier-supplied external/content URL, deliberately not an internal route -->
						<a href={notice.contentUrl} target="_blank" rel="noopener noreferrer">
							{notice.contentUrl}
						</a>
						<span class="status status--{notice.status}">
							{notice.status === 'open'
								? m.legalQueue_statusOpen()
								: notice.status === 'acted'
									? m.legalQueue_statusActed()
									: m.legalQueue_statusRejected()}
						</span>
					</div>
					<p class="explanation">{notice.explanation}</p>
					<p class="meta">
						{notice.notifierName || notice.contactEmail}
						· {formatDate(notice.createdAt, getLocale())}
					</p>

					{#if notice.status === 'open' && drafts[notice.id]}
						<div class="decide">
							<label class="radio">
								<input type="radio" bind:group={drafts[notice.id].status} value="rejected" />
								{m.legalQueue_decisionRejected()}
							</label>
							<label class="radio">
								<input type="radio" bind:group={drafts[notice.id].status} value="acted" />
								{m.legalQueue_decisionActed()}
							</label>

							<label>
								<span>{m.legalQueue_fieldNote()}</span>
								<textarea bind:value={drafts[notice.id].note} rows="3"></textarea>
							</label>

							{#if drafts[notice.id].status === 'acted'}
								<label>
									<span>{m.legalQueue_fieldContentKind()}</span>
									<select
										bind:value={drafts[notice.id].kind}
										onchange={() => (lookups[notice.id] = null)}
									>
										<option value="">—</option>
										{#each CONTENT_KINDS as kind (kind)}
											<option value={kind}>{kind}</option>
										{/each}
									</select>
								</label>
								<label>
									<span>{m.legalQueue_fieldContentId()}</span>
									<input
										type="text"
										inputmode="numeric"
										bind:value={drafts[notice.id].id}
										oninput={() => (lookups[notice.id] = null)}
									/>
								</label>

								<button
									type="button"
									class="button-secondary"
									disabled={!drafts[notice.id].kind || !drafts[notice.id].id}
									onclick={() => lookupContent(notice)}
								>
									{m.legalQueue_lookup()}
								</button>

								{#if lookups[notice.id] === 'loading'}
									<p class="lookup muted">{m.common_loading()}</p>
								{:else if lookups[notice.id] === 'error'}
									<p class="lookup error">{m.legalQueue_lookupError()}</p>
								{:else if lookups[notice.id]}
									{@const preview = lookups[notice.id]}
									{#if preview && preview !== 'loading' && preview !== 'error'}
										<p class="lookup">
											{preview.authorDisplayName
												? m.legalQueue_postedBy({ name: preview.authorDisplayName })
												: m.legalQueue_noAuthorOnRecord()}
										</p>
										<p class="lookup lookup--preview">&ldquo;{preview.preview}&rdquo;</p>
									{/if}
								{/if}
							{/if}

							{#if errorId === notice.id}
								<p class="error" role="alert">{m.legalQueue_resolveError()}</p>
							{/if}

							<button
								type="button"
								class="button-primary"
								disabled={busyId === notice.id || !drafts[notice.id].note.trim()}
								onclick={() => decide(notice)}
							>
								{m.legalQueue_resolve()}
							</button>
						</div>
					{:else}
						<p class="resolved-note">&ldquo;{notice.resolveNote}&rdquo;</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 46rem;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4) var(--space-6);
	}
	.denied,
	.empty {
		color: var(--text-secondary);
	}
	.notices {
		list-style: none;
		margin: var(--space-4) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.notice {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		padding: var(--space-3);
	}
	.notice__top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.status {
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		color: var(--text-secondary);
	}
	.status--acted {
		color: var(--status-danger);
	}
	.explanation {
		margin: var(--space-2) 0;
	}
	.meta {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.decide {
		margin-top: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px solid var(--border-color);
	}
	.radio {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
	}
	label {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
	}
	textarea,
	select,
	input[type='text'] {
		font: inherit;
		color: var(--text-primary);
		background: var(--bg-primary);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		padding: var(--space-1) var(--space-2);
	}
	.resolved-note {
		margin-top: var(--space-2);
		color: var(--text-secondary);
		font-style: italic;
	}
	.error {
		color: var(--status-danger);
	}
	.lookup {
		margin: 0;
		font-size: var(--font-size-sm);
	}
	.lookup--preview {
		color: var(--text-secondary);
		font-style: italic;
	}
	.muted {
		color: var(--text-secondary);
	}
	.button-primary {
		@include mix.button-primary;
		align-self: flex-start;
	}
	.button-secondary {
		@include mix.button-secondary;
		align-self: flex-start;
	}
</style>
