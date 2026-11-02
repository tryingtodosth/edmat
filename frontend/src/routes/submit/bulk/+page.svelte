<script lang="ts">
	// A whole problem sheet at once (backend `exercises/bulk.py`, 2026-10-22): one Markdown file per
	// exercise, in the format the operator's `import_exercises` reads. Two steps, both on the server:
	// "Check the files" (a preview — nothing is written) and then publish / send for review, which
	// the server re-checks from scratch. A verified contributor's files publish at once; everybody
	// else's wait in the moderation queue — the same split `/submit` has.
	//
	// Behind TWO switches: `exercise_submissions` (no submissions, no bulk) and its own
	// `exercise_bulk_upload`. The links to this page (on `/submit`, in the Add… menu) ask both.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import type { Branch, Discipline } from '$lib/types';
	import type { Licence } from '$lib/types/licence';
	import type { BulkUploadReport } from '$lib/types/bulkUpload';
	import { getBranchesForDiscipline, getDisciplines } from '$lib/services/taxonomy';
	import { commitBulkUpload, previewBulkUpload } from '$lib/services/bulkUpload';
	import { ApiError } from '$lib/api/client';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { bulkUploadMessage } from '$lib/utils/labels';
	import { BULK_UPLOAD_EXAMPLE } from '$lib/content/bulkUploadExample';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import LicencePicker from '$lib/components/shared/LicencePicker.svelte';
	import { pageTitle } from '$lib/utils/pageTitle';

	let disciplines = $state<Discipline[]>([]);
	let branches = $state<Branch[]>([]);
	let disciplineId = $state('');
	let branchId = $state('');
	let files = $state<File[]>([]);
	let licence = $state<Licence>('edmat-only');
	let aiAssisted = $state(false);
	let report = $state<BulkUploadReport | null>(null);
	// The preview is for THESE inputs; touching any of them makes it stale, and a stale preview must
	// not offer the send button (the server would re-check anyway — this keeps the page honest).
	let previewedKey = $state('');
	let busy = $state<'' | 'checking' | 'sending'>('');
	let failure = $state('');
	let done = $state<BulkUploadReport | null>(null);
	let dragging = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);

	const inputKey = $derived(
		[
			branchId,
			licence,
			aiAssisted,
			...files.map((f) => `${f.name}:${f.size}:${f.lastModified}`)
		].join('|')
	);
	const branch = $derived(branches.find((b) => b.id === branchId));
	const canSend = $derived(Boolean(report?.ok) && previewedKey === inputKey && !busy);
	// The AI-assisted mark is the `ai_assisted` feature's (provenance/); with it off the box goes.
	const aiMarkAvailable = $derived(
		featureFlagsStore.isEnabled('ai_assisted') || authStore.isModerator
	);
	const willPublish = $derived(
		Boolean(authStore.user?.isVerifiedContributor) || authStore.isModerator
	);

	let disciplinesLoadedFor: string | null = null;
	$effect(() => {
		const userId = authStore.user?.id ?? null;
		if (!userId || userId === disciplinesLoadedFor) return;
		disciplinesLoadedFor = userId;
		getDisciplines()
			.then((d) => (disciplines = d))
			.catch(() => (failure = m.bulkUpload_failed())); // "The upload failed. Try again."
	});

	async function pickDiscipline(id: string) {
		disciplineId = id;
		branchId = '';
		branches = [];
		if (!id) return;
		try {
			branches = await getBranchesForDiscipline(id);
		} catch {
			failure = m.bulkUpload_failed(); // "The upload failed. Try again."
		}
	}

	function addFiles(list: FileList | null | undefined) {
		if (!list) return;
		// A file chosen twice under one name replaces the first (the later choice is the one meant).
		const incoming = Array.from(list);
		const names = new Set(incoming.map((f) => f.name));
		files = [...files.filter((f) => !names.has(f.name)), ...incoming];
	}

	function removeFile(name: string) {
		files = files.filter((f) => f.name !== name);
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		addFiles(event.dataTransfer?.files);
	}

	function request() {
		return { branchId, files, licence, aiAssisted: aiMarkAvailable && aiAssisted };
	}

	function explain(err: unknown): string {
		if (err instanceof ApiError && err.status === 429) return m.bulkUpload_throttled(); // "You have sent too many uploads in the last hour. Try again later."
		if (err instanceof ApiError && err.status === 413) return m.bulkUpload_tooLarge(); // "The upload is too large altogether. Send fewer or smaller files."
		return m.bulkUpload_failed(); // "The upload failed. Try again."
	}

	async function check() {
		failure = '';
		busy = 'checking';
		const key = inputKey;
		try {
			report = await previewBulkUpload(request());
			previewedKey = key;
		} catch (err) {
			failure = explain(err);
		} finally {
			busy = '';
		}
	}

	async function send() {
		failure = '';
		busy = 'sending';
		try {
			const result = await commitBulkUpload(request());
			if (result.ok && result.created.length) {
				done = result;
				report = null;
				files = [];
			} else {
				// The server re-checked and something moved since the preview: show its report.
				report = result;
				previewedKey = inputKey;
			}
		} catch (err) {
			failure = explain(err);
		} finally {
			busy = '';
		}
	}

	function again() {
		done = null;
		report = null;
		previewedKey = '';
	}

	function downloadExample() {
		const url = URL.createObjectURL(new Blob([BULK_UPLOAD_EXAMPLE], { type: 'text/markdown' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = 'przyklad-zadania.md';
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	}
</script>

<svelte:head>
	<title>{pageTitle(m.bulkUpload_title())}</title>
</svelte:head>

<FeatureGate feature="exercise_submissions">
	<FeatureGate feature="exercise_bulk_upload">
		<div class="page">
			<h1>{m.bulkUpload_title()}<!-- "Upload exercises in bulk" --></h1>
			<p class="muted">{m.bulkUpload_intro()}</p>
			<!-- "Send a whole problem sheet at once: one Markdown file per exercise, …" -->

			{#if authStore.restoring}
				<p class="muted">{m.common_loading()}</p>
			{:else if !authStore.isAuthenticated}
				<p data-session-hidden>
					<a href={resolve('/login')}>{m.bulkUpload_loginRequired()}</a>
					<!-- "Sign in to upload exercises." -->
				</p>
			{:else if done}
				<div class="done" role="status" data-testid="bulk-done">
					<p>
						{done.mode === 'publish'
							? m.bulkUpload_donePublish({ count: done.created.length })
							: m.bulkUpload_doneQueue({ count: done.created.length })}
						<!-- "Published {count} exercise(s)." / "Sent {count} exercise(s) to the moderation queue. …" -->
					</p>
					<ul class="list">
						{#each done.created as row (row.submissionId)}
							<li class="row">
								<span class="row__name">{row.name}</span>
								{#if row.exerciseId}
									<a href={resolve('/exercises/[id]', { id: row.exerciseId })}
										>{m.bulkUpload_open()}<!-- "Open" --></a
									>
								{:else}
									<span class="pill">{m.bulkUpload_pending()}<!-- "Waiting for review" --></span>
								{/if}
							</li>
						{/each}
					</ul>
					<p class="actions">
						<a href={resolve('/submit/mine')}>{m.bulkUpload_seeMine()}</a>
						<!-- "See everything you have sent →" -->
						<button type="button" class="secondary" onclick={again}
							>{m.bulkUpload_again()}<!-- "Upload more" --></button
						>
					</p>
				</div>
			{:else}
				<p class="mode" data-testid="bulk-mode">
					{willPublish ? m.bulkUpload_modePublish() : m.bulkUpload_modeQueue()}
					<!-- "You are a verified contributor: …" / "Your exercises wait in the moderation queue …" -->
				</p>

				<form class="form" onsubmit={(e) => (e.preventDefault(), check())}>
					<div class="pickers">
						<label>
							<span>{m.bulkUpload_discipline()}<!-- "Discipline" --></span>
							<select
								value={disciplineId}
								onchange={(e) => pickDiscipline(e.currentTarget.value)}
								data-testid="bulk-discipline"
							>
								<option value="">{m.bulkUpload_pick()}<!-- "Choose…" --></option>
								{#each disciplines as d (d.id)}
									<option value={d.id}>{d.name}</option>
								{/each}
							</select>
						</label>
						<label>
							<span>{m.bulkUpload_branch()}<!-- "Branch" --></span>
							<select bind:value={branchId} disabled={!branches.length} data-testid="bulk-branch">
								<option value="">{m.bulkUpload_pick()}<!-- "Choose…" --></option>
								{#each branches as b (b.id)}
									<option value={b.id}>{b.name}</option>
								{/each}
							</select>
						</label>
					</div>
					{#if branch}
						<p class="small muted" data-testid="bulk-topics">
							{branch.topics.length
								? m.bulkUpload_topicsAvailable({
										topics: branch.topics.map((t) => t.slug).join(', ')
									})
								: m.bulkUpload_topicsNone()}
							<!-- "Topics this subject has (use these slugs in topics:): {topics}" -->
						</p>
					{/if}

					<div
						class="drop"
						class:drop--active={dragging}
						role="group"
						aria-label={m.bulkUpload_files()}
						ondragover={(e) => (e.preventDefault(), (dragging = true))}
						ondragleave={() => (dragging = false)}
						ondrop={onDrop}
					>
						<label class="drop__label">
							<span class="drop__title">{m.bulkUpload_files()}<!-- "Files" --></span>
							<input
								bind:this={fileInput}
								type="file"
								multiple
								accept=".md,.yaml,.yml,text/markdown"
								data-testid="bulk-files"
								onchange={(e) => {
									addFiles(e.currentTarget.files);
									e.currentTarget.value = '';
								}}
							/>
						</label>
						<p class="small muted">
							{m.bulkUpload_filesHint({
								files: report?.limits.files ?? 50,
								kb: Math.round((report?.limits.fileBytes ?? 262144) / 1024)
							})}
							<!-- "Up to {files} .md files of at most {kb} KB each, and optionally one batch.yaml." -->
						</p>
						{#if files.length}
							<p class="small">
								{m.bulkUpload_chosen({ count: files.length })}<!-- "{count} file(s) chosen" -->
							</p>
							<ul class="chips">
								{#each files as f (f.name)}
									<li class="chip">
										<span>{f.name}</span>
										<button
											type="button"
											aria-label={`× ${f.name}`}
											onclick={() => removeFile(f.name)}>×</button
										>
									</li>
								{/each}
							</ul>
						{/if}
					</div>

					<fieldset class="licence">
						<legend
							>{m.bulkUpload_licence()}<!-- "Licence for the files that do not name one" --></legend
						>
						<LicencePicker bind:value={licence} name="bulk-licence" compact />
					</fieldset>

					{#if aiMarkAvailable}
						<label class="check">
							<input type="checkbox" bind:checked={aiAssisted} data-testid="bulk-ai" />
							<span>{m.bulkUpload_aiAssisted()}</span>
							<!-- "These exercises were written with the help of AI — …" -->
						</label>
					{/if}

					<div class="actions">
						<button
							type="submit"
							class="secondary"
							disabled={!branchId || !files.length || Boolean(busy)}
							data-testid="bulk-check"
						>
							{busy === 'checking' ? m.bulkUpload_checking() : m.bulkUpload_preview()}
							<!-- "Checking…" / "Check the files" -->
						</button>
						<button
							type="button"
							class="primary"
							disabled={!canSend}
							onclick={send}
							data-testid="bulk-send"
						>
							{#if busy === 'sending'}
								{m.bulkUpload_sending()}<!-- "Sending…" -->
							{:else if willPublish}
								{m.bulkUpload_commitPublish({ count: report?.files.length ?? files.length })}
								<!-- "Publish {count} exercise(s)" -->
							{:else}
								{m.bulkUpload_commitQueue({ count: report?.files.length ?? files.length })}
								<!-- "Send {count} exercise(s) for review" -->
							{/if}
						</button>
					</div>
				</form>

				{#if failure}
					<p class="error" role="alert">{failure}</p>
				{/if}

				{#if report}
					<section class="report" data-testid="bulk-report" aria-live="polite">
						{#if report.errors.length}
							<ul class="issues">
								{#each report.errors as e, i (i)}
									<li class="error">{bulkUploadMessage(e)}</li>
								{/each}
							</ul>
						{/if}
						<p class={report.ok ? 'ok' : 'warn'}>
							{report.ok ? m.bulkUpload_allReady() : m.bulkUpload_fixFirst()}
							<!-- "Every file is ready." / "Fix the files marked below and check again — …" -->
						</p>
						{#if report.newTags.length}
							<p class="small muted">{m.bulkUpload_newTags({ tags: report.newTags.join(', ') })}</p>
							<!-- "New tags this upload will create: {tags}" -->
						{/if}
						<div class="table-wrap">
							<table>
								<thead>
									<tr>
										<th>{m.bulkUpload_colFile()}<!-- "File" --></th>
										<th>{m.bulkUpload_colTitle()}<!-- "Title" --></th>
										<th>{m.bulkUpload_colParts()}<!-- "Parts" --></th>
										<th>{m.bulkUpload_colResult()}<!-- "Result" --></th>
									</tr>
								</thead>
								<tbody>
									{#each report.files as f, i (i)}
										<tr class:bad={!f.ok} data-testid="bulk-row">
											<td class="name">{f.name}</td>
											<td>{f.title}</td>
											<td>{f.parts || '—'}</td>
											<td>
												{#if f.ok}
													<span class="ok">{m.bulkUpload_fileOk()}<!-- "Ready" --></span>
												{/if}
												<ul class="issues">
													{#each f.errors as e, j (j)}
														<li class="error" data-code={e.code}>{bulkUploadMessage(e)}</li>
													{/each}
													{#each f.warnings as w, j (j)}
														<li class="warn" data-code={w.code}>{bulkUploadMessage(w)}</li>
													{/each}
												</ul>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</section>
				{/if}
			{/if}

			<details class="format">
				<summary>{m.bulkUpload_format_title()}<!-- "The file format" --></summary>
				<p>{m.bulkUpload_format_frontMatter()}</p>
				<!-- "Each file starts with a front matter between two --- lines: …" -->
				<p>{m.bulkUpload_format_sections()}</p>
				<!-- "Then the sections: ## Treść (the statement, required), …" -->
				<p>{m.bulkUpload_format_parts()}</p>
				<!-- "A set of items is written as parts after the shared statement: …" -->
				<p>{m.bulkUpload_format_maths()}</p>
				<!-- "Maths is written \( … \) inline and \[ … \] on its own line; …" -->
				<p>{m.bulkUpload_format_differences()}</p>
				<!-- "Unlike an operator's import, an upload never changes an existing exercise …" -->
				<pre class="example">{BULK_UPLOAD_EXAMPLE}</pre>
				<button type="button" class="secondary" onclick={downloadExample}
					>{m.bulkUpload_format_template()}<!-- "Download an example file" --></button
				>
			</details>
		</div>
	</FeatureGate>
</FeatureGate>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 860px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	a {
		color: var(--accent);
		font-weight: 600;
	}
	.muted {
		color: var(--text-secondary);
	}
	.small {
		font-size: var(--font-size-sm);
	}
	.mode {
		@include mix.status-message(info);
	}
	.form {
		@include mix.card-surface;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.pickers {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: var(--space-2);
		label {
			display: flex;
			flex-direction: column;
			gap: var(--space-1);
			font-weight: 600;
			font-size: var(--font-size-sm);
		}
		select {
			min-width: 0;
		}
	}
	.drop {
		border: 2px dashed var(--border-color);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.drop--active {
		border-color: var(--accent);
		background: var(--bg-elevated);
	}
	.drop__label {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		input {
			max-width: 100%;
		}
	}
	.drop__title {
		font-weight: 600;
	}
	.chips {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.chip {
		@include mix.neutral-pill;
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		max-width: 100%;
		span {
			overflow-wrap: anywhere;
		}
		button {
			border: none;
			background: none;
			color: inherit;
			cursor: pointer;
			font-size: var(--font-size-sm);
			padding: 0 2px;
		}
	}
	.licence {
		border: none;
		padding: 0;
		margin: 0;
		legend {
			font-weight: 600;
			font-size: var(--font-size-sm);
			margin-bottom: var(--space-1);
		}
	}
	.check {
		display: flex;
		gap: var(--space-2);
		align-items: flex-start;
		font-size: var(--font-size-sm);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}
	.primary {
		@include mix.button-primary;
	}
	.secondary {
		@include mix.button-secondary;
	}
	.error {
		@include mix.status-message(danger);
	}
	.warn {
		@include mix.status-message(warning);
	}
	.ok {
		@include mix.status-message(success);
	}
	.report {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.table-wrap {
		overflow-x: auto;
		max-width: 100%;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--font-size-sm);
	}
	th,
	td {
		text-align: left;
		vertical-align: top;
		padding: var(--space-1) var(--space-2);
		border-bottom: 1px solid var(--border-color);
	}
	td.name {
		min-width: 8rem;
		overflow-wrap: break-word;
		font-family: var(--font-mono);
	}
	tr.bad td.name {
		color: var(--status-danger);
	}
	.issues {
		list-style: none;
		padding: 0;
		margin: var(--space-1) 0 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.done {
		@include mix.card-surface;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.row {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.row__name {
		overflow-wrap: anywhere;
	}
	.pill {
		@include mix.pending-pill;
	}
	.format {
		@include mix.card-surface;
		padding: var(--space-3);
		font-size: var(--font-size-sm);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		summary {
			font-weight: 600;
			cursor: pointer;
		}
		p {
			margin: var(--space-2) 0;
		}
	}
	.example {
		overflow-x: auto;
		max-width: 100%;
		padding: var(--space-2);
		background: var(--bg-page);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-xs);
		white-space: pre;
	}
</style>
