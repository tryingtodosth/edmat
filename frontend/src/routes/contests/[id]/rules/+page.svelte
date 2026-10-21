<script lang="ts">
	/**
	 * The regulamin (CONTESTS-BRIEF.md §3.A item 4) — a reader's page and, for the organiser, the
	 * editor on the same address.
	 *
	 * A regulamin is not itself required by the civil code; an announcement and a prize are all
	 * art. 919 needs. But a missing or defective one does not void the contest, it voids the
	 * ORGANISER's protections — no claim deadline makes a "best work" promise ineffective outright,
	 * no jury clause means the organiser decides alone, no IP reservation means nothing transfers —
	 * and a court reads an ambiguous unilateral promise against its author. So this page is
	 * twelve paragraphs with the guidance for each, not a text box.
	 *
	 * It prints. `@media print` plus the global `_print.scss`, which reveals `.print-area` and
	 * hides `body *` — the "downloadable, storable" form art. 384 asks for, made by the browser.
	 * **`print-area` is load-bearing**: without it this sheet prints a blank page, which is exactly
	 * the bug `/courses/[id]/certificate` shipped with and which no assertion caught.
	 */
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getLocale } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import RulesSectionEditor from '$lib/components/contest/RulesSectionEditor.svelte';
	import {
		getContest,
		getContestPresets,
		getContestRules,
		getRulesVersions,
		publishContestRules,
		refusalWord,
		saveContestRules
	} from '$lib/services/contests';
	import { contestRefusalMessage } from '$lib/utils/labels';
	import { formatDate } from '$lib/utils/datetime';
	import type { Contest, LawCitation, RulesPayload, RulesVersionRow } from '$lib/types/contest';

	let contest = $state<Contest | null>(null);
	let rules = $state<RulesPayload | null>(null);
	let versions = $state<RulesVersionRow[]>([]);
	let law = $state<Record<string, LawCitation>>({});
	let loading = $state(true);
	let notFound = $state(false);
	let busy = $state(false);
	let error = $state('');
	let message = $state('');
	let editing = $state(false);
	let loadedFor = $state('');

	const locale = $derived(getLocale());

	$effect(() => {
		const id = page.params.id;
		const key = `${id}:${authStore.user?.id ?? 'anon'}`;
		if (!id || key === loadedFor) return;
		loadedFor = key;
		void load(id);
	});

	async function load(id: string) {
		loading = true;
		notFound = false;
		try {
			contest = await getContest(id);
			rules = await getContestRules(id);
			versions = await getRulesVersions(id);
			law = (await getContestPresets()).law;
		} catch {
			notFound = true;
		} finally {
			loading = false;
		}
	}

	async function save(sections: { key: string; order: number; body: string }[]) {
		if (!contest) return;
		busy = true;
		error = '';
		message = '';
		try {
			rules = await saveContestRules(contest.id, sections);
			message = m.contests_rulesSaved(); // "Saved. It is not published until you say so."
		} catch (thrown) {
			const word = refusalWord(thrown);
			error = word ? contestRefusalMessage(word) : m.common_error();
		} finally {
			busy = false;
		}
	}

	async function publish() {
		if (!contest) return;
		busy = true;
		error = '';
		message = '';
		try {
			const version = await publishContestRules(contest.id);
			message = m.contests_rulesPublished({ version: version.number }); // "Published as version {version}."
			loadedFor = '';
		} catch (thrown) {
			const word = refusalWord(thrown);
			error = word ? contestRefusalMessage(word) : m.common_error();
		} finally {
			busy = false;
		}
	}

	function heading(section: { key: string; heading: { en: string; pl: string } }): string {
		return locale === 'en' ? section.heading.en : section.heading.pl;
	}

	const written = $derived((rules?.sections ?? []).filter((s) => s.body.trim().length > 0));
</script>

<PageHead
	title={m.contests_rulesPageTitle({ title: contest?.title ?? '' })}
	description={m.contests_rulesPageDescription()}
/>
<!-- "Rules — {title}" / "The contest's regulamin: who organises it, how it is judged, what happens to personal data, and how to complain." -->

<FeatureGate feature="contests">
	<div class="page">
		{#if loading}
			<p class="muted">{m.common_loading()}</p>
		{:else if notFound || !contest || !rules}
			<p class="muted">{m.contests_notFound()}</p>
		{:else}
			<nav class="crumbs">
				<a href={resolve('/contests/[id]', { id: contest.id })}>{m.contests_backToContest()}</a>
				<!-- "Back to the contest" -->
			</nav>

			<div class="controls">
				<button type="button" onclick={() => window.print()}>{m.contests_print()}</button>
				<!-- "Print" -->
				{#if contest.canManage}
					<button type="button" onclick={() => (editing = !editing)}>
						{editing ? m.contests_rulesStopEditing() : m.contests_rulesEdit()}
						<!-- "Stop editing" / "Edit the rules" -->
					</button>
				{/if}
			</div>

			{#if message}
				<p class="ok" role="status">{message}</p>
			{/if}
			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}

			{#if editing && contest.canManage}
				<RulesSectionEditor
					sections={rules.sections}
					{law}
					version={rules.version}
					{busy}
					onsave={save}
					onpublish={publish}
				/>
			{:else}
				<!-- `print-area` is what `_print.scss` reveals; without it this prints blank. -->
				<article class="sheet print-area">
					<h1>{m.contests_rulesSheetHeading({ title: contest.title })}</h1>
					<!-- "Regulamin: {title}" -->
					<p class="version">
						{rules.version > 0
							? m.contests_rulesVersionLine({
									version: rules.version,
									date: formatDate(versions[0]?.publishedAt ?? '')
								})
							: m.contests_rulesDraftLine()}
						<!-- "Version {version}, published {date}" / "Draft — not published yet" -->
					</p>
					<p class="who">
						{m.contests_organisedBy({ name: contest.organiser?.displayName ?? '—' })}
						{#if contest.dataControllerName}
							· {contest.dataControllerName}
						{/if}
					</p>

					{#if written.length === 0}
						<p class="muted">{m.contests_rulesEmpty()}</p>
						<!-- "Nothing has been written yet." -->
					{:else}
						{#each written as section (section.id)}
							<section class="paragraph">
								<h2>{heading(section)}</h2>
								<MathContent source={section.body} />
							</section>
						{/each}
					{/if}

					<p class="footer">{m.contests_rulesFooter()}</p>
					<!-- "EdMat hosts this contest and is the processor of the entrants' data on the organiser's behalf. It is not the organiser, does not judge, and promises no prize." -->
				</article>

				{#if versions.length > 1}
					<section class="history">
						<h2>{m.contests_rulesHistory()}</h2>
						<!-- "Earlier versions" -->
						<ul>
							{#each versions as version (version.id)}
								<li>
									{m.contests_rulesVersionLine({
										version: version.number,
										date: formatDate(version.publishedAt)
									})}
									{#if version.publishedBy}
										· {version.publishedBy.displayName}
									{/if}
								</li>
							{/each}
						</ul>
						<p class="muted">{m.contests_rulesHistoryNote()}</p>
						<!-- "Every entry stores the version of the rules it accepted, so a later change never becomes the rules somebody already agreed to." -->
					</section>
				{/if}
			{/if}
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 820px;
		margin: var(--space-6) auto;
		padding: 0 1rem;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.crumbs,
	.controls {
		display: flex;
		gap: 0.6rem;
		font-size: var(--font-size-sm);
	}
	.sheet {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
		padding: var(--space-4);
	}
	h1 {
		margin: 0;
		font-size: var(--font-size-lg);
	}
	h2 {
		margin: 1rem 0 0.3rem;
		font-size: var(--font-size-md);
	}
	.version,
	.who,
	.footer,
	.muted {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.version,
	.who {
		margin: 0.2rem 0 0;
	}
	.footer {
		margin-top: 1.2rem;
		border-top: 1px solid var(--border-color);
		padding-top: 0.5rem;
	}
	.paragraph {
		margin-top: 0.6rem;
	}
	.history {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: 0.6rem 0.9rem;
		background: var(--bg-surface-alt);
	}
	.history ul {
		margin: 0 0 0.4rem;
		padding-left: 1.2rem;
		font-size: var(--font-size-sm);
	}
	button {
		padding: 0.35rem 0.75rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface-alt);
		color: var(--text-primary);
		cursor: pointer;
	}
	.ok {
		color: var(--status-success);
		margin: 0;
	}
	.error {
		color: var(--status-danger);
		margin: 0;
	}

	@media print {
		.sheet {
			border: 0;
			padding: 0;
		}
	}
</style>
