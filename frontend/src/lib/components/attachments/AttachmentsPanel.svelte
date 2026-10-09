<script lang="ts">
	/** Everything attached to one thing — a course, an event, a material, an organisation, a task, a
	 * plan, a need, a goal or a comment (backend `attachments/`).
	 *
	 * One panel for nine target kinds, because the kind is a word the API speaks
	 * (`/api/<kind>/<id>/attachments/`) rather than a route each surface adds. Mounted once in
	 * `ManagementPanels` and usable anywhere else with two props.
	 *
	 * **The two warnings before a download are the owner's own ask** (2026-10-08: *"make two popups
	 * with warning before downloading a file"*), and they say two different things on purpose. The
	 * first is about PROVENANCE — who put this here, and that EdMat did not make it and cannot see
	 * inside it. The second is about THIS FILE — its name, its type, its size, and the one sentence
	 * that actually changes behaviour: open it only if you trust the person. Two dialogs with the
	 * same words would be a click to dismiss twice; two that say different things are a reader
	 * finding out something they did not know at the second step.
	 *
	 * The bytes never come from a `/media/` URL. `getAttachmentFile` fetches a Blob from the
	 * tier-checked endpoint through `client.ts`, which is what carries the token — a static path
	 * would make every tier decision in `attachments/access.py` decorative.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import FoldSection from '$lib/components/shared/FoldSection.svelte';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { downloadBlob } from '$lib/utils/download';
	import { ATTACHMENT_TIER_LABELS } from '$lib/utils/labels';
	import {
		acknowledgeAttachment,
		createAttachment,
		getAttachmentFile,
		getAttachments,
		withdrawAttachment
	} from '$lib/services/attachments';
	import type {
		Attachment,
		AttachmentKind,
		AttachmentTargetKind,
		AttachmentTier
	} from '$lib/types/attachment';

	let {
		targetKind,
		targetId,
		/** Whether this reader may add one. The server decides for real; this only draws the form. */
		canAttach = false,
		/** Whether this reader may make a reading mandatory, take one down and read the receipts. */
		canManage = false,
		/** `public` on a comment, where the tiers do not apply — the API refuses the rest. */
		tiers = ['public', 'members', 'staff', 'managers'] as AttachmentTier[],
		level = 2
	}: {
		targetKind: AttachmentTargetKind;
		targetId: string;
		canAttach?: boolean;
		canManage?: boolean;
		tiers?: AttachmentTier[];
		level?: 2 | 3;
	} = $props();

	const enabled = $derived(featureFlagsStore.isEnabled('attachments') || authStore.isModerator);

	let rows = $state<Attachment[]>([]);
	let loaded = $state(false);
	let busy = $state(false);
	let error = $state('');
	let adding = $state(false);

	// Keyed on the target AND on who is asking, with the id-changed guard frontend/CLAUDE.md trap 2
	// requires: the tiers a reader has change the moment a session resolves.
	let loadedFor = $state('');
	$effect(() => {
		const key = `${targetKind}:${targetId}:${authStore.user?.id ?? 'anon'}:${enabled}`;
		if (!targetId || key === loadedFor) return;
		loadedFor = key;
		if (!enabled) {
			rows = [];
			loaded = true;
			return;
		}
		getAttachments(targetKind, targetId).then(
			(found) => {
				if (loadedFor === key) {
					rows = found;
					loaded = true;
				}
			},
			() => {
				// A 404 here means "not for you", which the caller's own gate should already have
				// caught. Draw nothing rather than an error on somebody else's page.
				if (loadedFor === key) {
					rows = [];
					loaded = true;
				}
			}
		);
	});

	// ---- the form -------------------------------------------------------------------------------
	let kind = $state<AttachmentKind>('file');
	let title = $state('');
	let description = $state('');
	let body = $state('');
	let url = $state('');
	let visibility = $state<AttachmentTier>('members'); // replaced by `defaultTier` on first reset
	let mandatory = $state(false);
	let file = $state<File | null>(null);

	/** `members` where the target has that tier at all, and the lowest one otherwise (a comment has
	 *  only `public`). NOT `tiers[0]`, which is `public` — defaulting an attachment to "everybody"
	 *  is the wrong way for a default to be wrong, and the form resets after every save, so getting
	 *  it wrong here would quietly widen the second upload. */
	const defaultTier = $derived<AttachmentTier>(
		tiers.includes('members') ? 'members' : (tiers[0] ?? 'public')
	);

	function resetForm() {
		kind = 'file';
		title = '';
		description = '';
		body = '';
		url = '';
		visibility = defaultTier;
		mandatory = false;
		file = null;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!title.trim()) return;
		busy = true;
		error = '';
		try {
			const created = await createAttachment(targetKind, targetId, {
				kind,
				title: title.trim(),
				description,
				visibility,
				requiresAcknowledgement: mandatory,
				file: kind === 'file' ? file : null,
				body: kind === 'text' ? body : undefined,
				url: kind === 'link' ? url : undefined
			});
			rows = [...rows, created];
			adding = false;
			resetForm();
		} catch {
			error = m.attachments_error();
		} finally {
			busy = false;
		}
	}

	async function markRead(row: Attachment) {
		busy = true;
		try {
			const updated = await acknowledgeAttachment(row.id);
			rows = rows.map((candidate) => (candidate.id === row.id ? updated : candidate));
		} catch {
			error = m.attachments_error();
		} finally {
			busy = false;
		}
	}

	async function takeDown(row: Attachment) {
		busy = true;
		try {
			await withdrawAttachment(row.id);
			rows = rows.filter((candidate) => candidate.id !== row.id);
		} catch {
			error = m.attachments_error();
		} finally {
			busy = false;
		}
	}

	// ---- the two warnings -----------------------------------------------------------------------
	let warning = $state<{ row: Attachment; step: 1 | 2 } | null>(null);

	function humanSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	async function reallyDownload(row: Attachment) {
		warning = null;
		busy = true;
		try {
			const blob = await getAttachmentFile(row.id);
			downloadBlob(row.originalName || row.title, blob);
		} catch {
			error = m.attachments_error();
		} finally {
			busy = false;
		}
	}
</script>

{#if enabled && loaded && (rows.length > 0 || canAttach)}
	<FoldSection key="attachments" title={m.attachments_heading()} count={rows.length} {level}>
		<!-- "Attachments" -->
		{#snippet actions()}
			{#if canAttach}
				<button type="button" class="link" onclick={() => (adding = !adding)}>
					{m.attachments_add()}
					<!-- "Attach something" -->
				</button>
			{/if}
		{/snippet}

		<div class="attachments">
			{#if adding}
				<form class="form" onsubmit={submit}>
					<label class="field">
						<span>{m.attachments_kindLabel()}</span>
						<select bind:value={kind} disabled={busy}>
							<option value="file">{m.attachments_kind_file()}</option>
							<option value="text">{m.attachments_kind_text()}</option>
							<option value="link">{m.attachments_kind_link()}</option>
						</select>
					</label>
					<label class="field">
						<span>{m.attachments_titleLabel()}</span>
						<input type="text" bind:value={title} maxlength="200" disabled={busy} required />
					</label>
					{#if kind === 'file'}
						<label class="field">
							<span>{m.attachments_fileLabel()}</span>
							<input
								type="file"
								disabled={busy}
								onchange={(event) =>
									(file = (event.currentTarget as HTMLInputElement).files?.[0] ?? null)}
							/>
						</label>
						<p class="hint">{m.attachments_fileHint()}</p>
						<!-- "A PDF, a picture, a .docx/.xlsx/.pptx/.odt, or a .md/.txt…" -->
					{:else if kind === 'text'}
						<label class="field">
							<span>{m.attachments_bodyLabel()}</span>
							<textarea rows="6" bind:value={body} disabled={busy}></textarea>
						</label>
					{:else}
						<label class="field">
							<span>{m.attachments_urlLabel()}</span>
							<input type="url" bind:value={url} maxlength="500" disabled={busy} />
						</label>
					{/if}
					<label class="field">
						<span>{m.attachments_descriptionLabel()}</span>
						<input type="text" bind:value={description} maxlength="300" disabled={busy} />
					</label>
					{#if tiers.length > 1}
						<label class="field">
							<span>{m.attachments_visibilityLabel()}</span>
							<select bind:value={visibility} disabled={busy}>
								{#each tiers as tier (tier)}
									<option value={tier}>{ATTACHMENT_TIER_LABELS[tier]()}</option>
								{/each}
							</select>
						</label>
					{/if}
					{#if canManage}
						<label class="check">
							<input type="checkbox" bind:checked={mandatory} disabled={busy} />
							<span>{m.attachments_mandatoryLabel()}</span>
							<!-- "Everybody on the team must confirm they have read it" -->
						</label>
					{/if}
					<div class="form__actions">
						<button type="submit" class="primary" disabled={busy || !title.trim()}>
							{m.attachments_save()}
						</button>
						<button type="button" class="link" onclick={() => (adding = false)} disabled={busy}>
							{m.attachments_cancel()}
						</button>
					</div>
				</form>
			{/if}

			{#if rows.length === 0}
				<p class="hint">{m.attachments_empty()}</p>
				<!-- "Nothing attached yet." -->
			{:else}
				<ul class="list">
					{#each rows as row (row.id)}
						<li class="row" data-attachment-kind={row.kind}>
							<div class="row__head">
								<strong>{row.title}</strong>
								<span class="pill">{ATTACHMENT_TIER_LABELS[row.visibility]()}</span>
								{#if row.requiresAcknowledgement}
									<span class="pill pill--warn">{m.attachments_mustRead()}</span>
									<!-- "Must be read" -->
								{/if}
							</div>
							{#if row.description}<p class="hint">{row.description}</p>{/if}

							{#if row.kind === 'text'}
								<!-- Rendered, never downloaded: a `.md` became characters at upload time, so it
								     goes through the same pipeline as every other body on this site. -->
								<MathContent source={row.body} />
							{:else if row.kind === 'link'}
								<p>
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an address somebody attached, deliberately external -->
									<a href={row.url} rel="nofollow noopener external">{m.attachments_open()}</a>
								</p>
							{:else if row.kind === 'sketch' || row.kind === 'chem'}
								{#if row.sketchImageUrl || row.chemImageUrl}
									<img
										class="row__picture"
										src={row.sketchImageUrl ?? row.chemImageUrl}
										alt={row.title}
									/>
								{/if}
							{:else}
								<p class="row__file">
									<button
										type="button"
										class="link"
										disabled={busy}
										onclick={() => (warning = { row, step: 1 })}
									>
										{m.attachments_download()}
										<!-- "Download" -->
									</button>
									<span class="hint">{row.mediaType} · {humanSize(row.byteSize)}</span>
									<span class="hint">
										{row.scanned ? m.attachments_scanned() : m.attachments_notScanned()}
										<!-- "Virus-scanned when it was uploaded." / "Not virus-scanned — no scanner is running on this server." -->
									</span>
								</p>
							{/if}

							<p class="row__meta">
								{#if row.uploadedBy}
									<span>{m.attachments_uploadedBy({ name: row.uploadedBy.displayName })}</span>
								{/if}
								{#if row.requiresAcknowledgement}
									{#if row.acknowledged}
										<span class="read">{m.attachments_acknowledged()}</span>
									{:else if authStore.isAuthenticated}
										<button
											type="button"
											class="link"
											disabled={busy}
											onclick={() => markRead(row)}
										>
											{m.attachments_acknowledge()}
										</button>
									{/if}
									{#if canManage}
										<span class="hint"
											>{m.attachments_readCount({ count: row.acknowledgementCount })}</span
										>
									{/if}
								{/if}
								{#if canManage}
									<button
										type="button"
										class="link danger"
										disabled={busy}
										onclick={() => takeDown(row)}
									>
										{m.attachments_withdraw()}
										<!-- "Take it down" -->
									</button>
								{/if}
							</p>
						</li>
					{/each}
				</ul>
			{/if}

			{#if error}<p class="error" role="alert">{error}</p>{/if}
		</div>
	</FoldSection>
{/if}

{#if warning}
	{#if warning.step === 1}
		<ModalShell title={m.attachments_warn1Title()} onClose={() => (warning = null)}>
			<!-- "Before you download" — the PROVENANCE warning: who put it here. -->
			<p>
				{m.attachments_warn1Body({
					name: warning.row.uploadedBy?.displayName ?? '—'
				})}
			</p>
			<p class="hint">
				{warning.row.scanned ? m.attachments_scanned() : m.attachments_notScanned()}
			</p>
			<div class="form__actions">
				<button
					type="button"
					class="primary"
					onclick={() => (warning = warning && { row: warning.row, step: 2 })}
				>
					{m.attachments_warn1Continue()}
				</button>
				<button type="button" class="link" onclick={() => (warning = null)}>
					{m.attachments_cancel()}
				</button>
			</div>
		</ModalShell>
	{:else}
		<ModalShell title={m.attachments_warn2Title()} onClose={() => (warning = null)}>
			<!-- "One more check" — the THIS-FILE warning: what you are about to save, and the one
			     sentence that changes behaviour. -->
			<p>
				{m.attachments_warn2Body({
					title: warning.row.originalName || warning.row.title,
					type: warning.row.mediaType,
					size: humanSize(warning.row.byteSize)
				})}
			</p>
			<div class="form__actions">
				<button
					type="button"
					class="primary"
					onclick={() => warning && reallyDownload(warning.row)}
				>
					{m.attachments_warn2Confirm()}
				</button>
				<button type="button" class="link" onclick={() => (warning = null)}>
					{m.attachments_cancel()}
				</button>
			</div>
		</ModalShell>
	{/if}
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.attachments {
		display: grid;
		gap: var(--space-3);
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-3);
	}
	.row {
		@include mix.card-surface;
		padding: var(--space-3);
		display: grid;
		gap: var(--space-1);
	}
	.row__head {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.row__file,
	.row__meta {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
	}
	.row__picture {
		max-width: 100%;
		border-radius: var(--radius-sm);
	}
	// A text attachment is a NOTE inside a card, so its own headings must not outshout the card's
	// title — a `#` in an attached `.md` was rendering bigger than the panel's heading.
	.row :global(h1),
	.row :global(h2),
	.row :global(h3) {
		font-size: var(--font-size-base);
		margin: var(--space-2) 0 0;
	}
	.pill {
		@include mix.neutral-pill;
	}
	.pill--warn {
		@include mix.status-pill(var(--status-warning), var(--status-warning-bg));
	}
	.hint {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.read {
		font-size: var(--font-size-sm);
		color: var(--status-success);
	}
	.error {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--status-danger);
	}
	.form {
		display: grid;
		gap: var(--space-2);
	}
	.field {
		display: grid;
		gap: 2px;
		font-size: var(--font-size-sm);

		input[type='text'],
		input[type='url'],
		select,
		textarea {
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.check {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
	}
	.form__actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
	.primary {
		@include mix.button-primary;
	}
	.danger {
		color: var(--status-danger);
	}
</style>
