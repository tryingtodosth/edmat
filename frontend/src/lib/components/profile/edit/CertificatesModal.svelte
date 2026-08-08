<script lang="ts">
	// Add, edit and remove certificates.
	//
	// **There is no file field**, and that is a decision rather than a missing feature. An uploaded scan
	// is not evidence — anybody can upload any image, so a reader who trusts the PDF is trusting exactly
	// what they were already trusting — while a link to the issuer's own verification page is checkable
	// in one click and worthless to fake. The form says as much, so its absence reads as deliberate.
	import { m } from '$lib/paraglide/messages.js';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import {
		createCertificate,
		deleteCertificate,
		updateCertificate
	} from '$lib/services/profileExtras';
	import type { Certificate } from '$lib/types/profileExtras';

	let {
		certificates,
		onChanged,
		onClose
	}: {
		certificates: Certificate[];
		onChanged: () => Promise<void>;
		onClose: () => void;
	} = $props();

	let editing = $state<string | null>(null);
	let draft = $state({
		title: '',
		issuer: '',
		issuedOn: '',
		expiresOn: '',
		credentialId: '',
		url: ''
	});
	let busy = $state(false);
	let error = $state('');

	function start(entry: Certificate | null) {
		editing = entry?.id ?? '';
		draft = {
			title: entry?.title ?? '',
			issuer: entry?.issuer ?? '',
			issuedOn: entry?.issuedOn ?? '',
			expiresOn: entry?.expiresOn ?? '',
			credentialId: entry?.credentialId ?? '',
			url: entry?.url ?? ''
		};
		error = '';
	}

	async function run(fn: () => Promise<unknown>) {
		busy = true;
		error = '';
		try {
			await fn();
			await onChanged();
			editing = null;
		} catch (e) {
			// A duplicate (title, issuer) is a real 400 with a real message; reporting it as "something
			// went wrong" would send somebody looking for a network fault instead of at their own list.
			const body = (e as { body?: { title?: string[]; url?: string[] } }).body;
			error = body?.title?.[0] ?? body?.url?.[0] ?? m.common_error_generic();
		} finally {
			busy = false;
		}
	}

	function save(event: SubmitEvent) {
		event.preventDefault();
		const url = draft.url.trim();
		const payload = {
			title: draft.title.trim(),
			issuer: draft.issuer.trim(),
			issuedOn: draft.issuedOn || null,
			expiresOn: draft.expiresOn || null,
			credentialId: draft.credentialId.trim(),
			// A scheme is added rather than the whole save being bounced: somebody typing
			// `coursera.org/verify/X` has given a perfectly usable link, and refusing it over a missing
			// `https://` is the kind of validation that only ever punishes a real answer. Same handling
			// the material submission form already gives its own source URL.
			url: url && !/^https?:\/\//i.test(url) ? `https://${url}` : url
		};
		if (!payload.title) return;
		const id = editing;
		run(() =>
			id
				? updateCertificate(id, payload)
				: createCertificate({ ...payload, order: certificates.length })
		);
	}

	function remove(entry: Certificate) {
		if (!window.confirm(m.profile_edit_confirmRemove({ label: entry.title }))) return;
		run(() => deleteCertificate(entry.id));
	}
</script>

<ModalShell title={m.profile_certificatesHeading()} {onClose}>
	<!-- "Certificates" -->
	{#if certificates.length > 0}
		<ul class="rows">
			{#each certificates as certificate (certificate.id)}
				<li class="row">
					<div class="row__text">
						<span class="row__title">{certificate.title}</span>
						<span class="row__meta">
							{certificate.issuer}
							{#if certificate.isExpired}
								· {m.profile_certificateExpired()}
								<!-- "Expired" -->
							{/if}
						</span>
					</div>
					<div class="row__actions">
						<button type="button" disabled={busy} onclick={() => start(certificate)}>
							{m.profile_edit_edit()}
						</button>
						<button
							type="button"
							class="danger"
							disabled={busy}
							onclick={() => remove(certificate)}
						>
							{m.profile_edit_remove()}
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	{#if editing === null}
		<button type="button" class="primary" onclick={() => start(null)}>
			{m.profile_edit_addCertificate()}
			<!-- "Add a certificate" -->
		</button>
	{:else}
		<form class="edit-form" onsubmit={save}>
			<label>
				{m.profile_edit_title()}
				<!-- "Title" -->
				<input type="text" bind:value={draft.title} required />
			</label>
			<label>
				{m.profile_edit_issuer()}
				<!-- "Issued by" -->
				<input type="text" bind:value={draft.issuer} />
			</label>
			<div class="pair">
				<label>
					{m.profile_edit_issuedOn()}
					<!-- "Issued on" -->
					<input type="date" bind:value={draft.issuedOn} />
				</label>
				<label>
					{m.profile_edit_expiresOn()}
					<!-- "Valid until" -->
					<input type="date" bind:value={draft.expiresOn} />
					<span class="hint">{m.profile_edit_expiresOnHint()}</span>
					<!-- "Leave empty if it does not expire." -->
				</label>
			</div>
			<label>
				{m.profile_edit_credentialId()}
				<!-- "Certificate number" -->
				<input type="text" bind:value={draft.credentialId} />
			</label>
			<label>
				{m.profile_edit_certificateUrl()}
				<!-- "Where it can be checked" -->
				<!-- `type="text"` with `inputmode="url"`, not `type="url"`: native validation rejects an
				     address typed without a scheme, which the save handler adds instead. It also keeps the
				     binding a genuine string, the coercion bug this project has now hit three times. -->
				<input type="text" inputmode="url" bind:value={draft.url} />
				<span class="hint">{m.profile_edit_certificateUrlHint()}</span>
				<!-- "A link to the issuer's own verification page, if there is one. EdMat cannot verify a
				     certificate itself, and an uploaded scan would not prove anything either — so a
				     checkable link is worth more than a picture." -->
			</label>
			<div class="actions">
				<button type="submit" class="primary" disabled={busy}>{m.common_save()}</button>
				<button type="button" disabled={busy} onclick={() => (editing = null)}>
					{m.common_cancel()}
				</button>
			</div>
		</form>
	{/if}

	{#if error}
		<p class="error">{error}</p>
	{/if}
</ModalShell>

<style lang="scss">
	// Local rather than a shared mixin — see ExperienceModal's own note on why.
	@use '../../../styles/mixins' as mix;

	.rows {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--border-color);
		&:last-child {
			border-bottom: none;
			padding-bottom: 0;
		}
	}
	.row__text {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 8rem;
	}
	.row__title {
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.row__meta {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.row__actions {
		display: flex;
		gap: var(--space-1);
		button {
			@include mix.focus-ring;
			background: var(--bg-page);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			color: var(--text-secondary);
			font-size: var(--font-size-xs);
			min-height: 32px;
			padding: 0 var(--space-2);
			cursor: pointer;
			&:disabled {
				opacity: 0.4;
				cursor: default;
			}
		}
		.danger {
			color: var(--status-danger);
			border-color: var(--status-danger);
		}
	}
	.edit-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.pair {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		label {
			flex: 1;
			min-width: 9rem;
		}
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--font-size-sm);
	}
	input {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		color: var(--text-primary);
		font: inherit;
	}
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.primary {
		@include mix.button-primary;
		align-self: flex-start;
	}
	.actions button:not(.primary) {
		@include mix.button-secondary;
	}
	.error {
		font-size: var(--font-size-sm);
		color: var(--status-danger);
	}
</style>
