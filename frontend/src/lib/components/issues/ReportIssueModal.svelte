<script lang="ts">
	// The one "Report issue / Zgłoś błąd" dialog, mounted once in the root layout and opened from
	// three places through `issueReportStore`. It opens already knowing where the person was — the
	// path and the page title the store captured — and pre-picks a type from that: on an exercise,
	// material or course page the likeliest complaint is about the content; anywhere else, a bug.
	// Both are editable, because a guess shown as a fact is how wrong reports get filed.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { issueReportStore } from '$lib/state/issueReport.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import { reportIssue } from '$lib/services/issues';
	import type { Issue, IssueKind } from '$lib/types/issue';
	import { ISSUE_KIND_LABELS } from '$lib/utils/issueLabels';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';

	const KINDS: IssueKind[] = ['bug', 'content', 'idea', 'other'];

	let kind = $state<IssueKind>('bug');
	let title = $state('');
	let body = $state('');
	let path = $state('');
	let pageTitle = $state('');
	let anonymous = $state(false);
	let contactEmail = $state('');
	let isPublic = $state(false);
	let submitting = $state(false);
	let error = $state('');
	let filed = $state<Issue | undefined>(undefined);

	const isGuest = $derived(!authStore.isAuthenticated);
	const environment = $derived.by(() => {
		if (typeof window === 'undefined') return { locale: '', viewport: '', userAgent: '' };
		return {
			locale: getLocale(),
			viewport: `${window.innerWidth}×${window.innerHeight}`,
			userAgent: navigator.userAgent
		};
	});

	// Reset on every open rather than on close, so a half-written report survives an accidental
	// Escape but a fresh open on another page starts from that page's own context.
	$effect(() => {
		if (!issueReportStore.isOpen) return;
		path = issueReportStore.path;
		pageTitle = issueReportStore.pageTitle;
		kind = /^\/(exercises|materials|courses)\/[^/]+/.test(path) ? 'content' : 'bug';
		title = '';
		body = '';
		anonymous = false;
		contactEmail = '';
		isPublic = false;
		error = '';
		filed = undefined;
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!title.trim() || submitting) return;
		submitting = true;
		error = '';
		try {
			filed = await reportIssue({
				kind,
				title: title.trim(),
				body: body.trim(),
				context: { path, pageTitle, ...environment },
				anonymous,
				contactEmail: anonymous ? '' : contactEmail.trim(),
				isPublic
			});
		} catch {
			error = m.issue_submitError(); // "Could not send the report. Please try again."
		} finally {
			submitting = false;
		}
	}
</script>

{#if issueReportStore.isOpen}
	<ModalShell title={m.issue_modalTitle()} onClose={() => issueReportStore.close()}>
		<!-- "Report an issue" -->
		{#if filed}
			<div class="filed">
				<p>{m.issue_filedThanks()}</p>
				<!-- "Thank you — your report is filed." -->
				{#if filed.isPublic}
					<p>
						<a
							href={resolve('/issues/[id]', { id: filed.id })}
							onclick={() => issueReportStore.close()}
						>
							{m.issue_filedViewPublic()}
							<!-- "See it on the issues page" -->
						</a>
					</p>
				{:else}
					<p class="muted">{m.issue_filedPrivateNote()}</p>
					<!-- "It is visible to the site's moderators only." -->
				{/if}
				<button type="button" class="button-primary" onclick={() => issueReportStore.close()}>
					{m.common_close()}
				</button>
			</div>
		{:else}
			<form class="issue-form" onsubmit={submit}>
				<label>
					<span>{m.issue_fieldKind()}</span>
					<!-- "What kind of report is this?" -->
					<select bind:value={kind}>
						{#each KINDS as option (option)}
							<option value={option}>{ISSUE_KIND_LABELS[option]()}</option>
						{/each}
					</select>
				</label>

				<label>
					<span>{m.issue_fieldTitle()}</span>
					<!-- "In one line" -->
					<input type="text" bind:value={title} maxlength="200" required />
				</label>

				<label>
					<span>{m.issue_fieldBody()}</span>
					<!-- "What happened, and what did you expect? (optional)" -->
					<textarea bind:value={body} rows="4"></textarea>
				</label>

				<fieldset class="context">
					<legend>{m.issue_contextHeading()}</legend>
					<!-- "Where you were" -->
					<p class="muted">{m.issue_contextHint()}</p>
					<!-- "Filled in for you from the page you were on — change it if the problem is elsewhere." -->
					<label>
						<span>{m.issue_contextPath()}</span>
						<!-- "Page address" -->
						<input type="text" bind:value={path} />
					</label>
					<label>
						<span>{m.issue_contextPageTitle()}</span>
						<!-- "Page title" -->
						<input type="text" bind:value={pageTitle} />
					</label>
					<p class="muted small">
						{m.issue_contextAlsoSent({
							locale: environment.locale,
							viewport: environment.viewport
						})}
						<!-- "Also sent: interface language {locale}, window {viewport}, and your browser's name." -->
					</p>
				</fieldset>

				<label class="check">
					<input type="checkbox" bind:checked={anonymous} />
					<span>
						{m.issue_anonymousLabel()}
						<!-- "Report anonymously" -->
						<small class="muted">{m.issue_anonymousHint()}</small>
						<!-- "Nothing identifying you is stored — which also means nobody can reply to you." -->
					</span>
				</label>

				{#if isGuest && !anonymous}
					<label>
						<span>{m.issue_fieldEmail()}</span>
						<!-- "Your email, if you would like a reply (optional)" -->
						<input type="email" bind:value={contactEmail} />
					</label>
				{/if}

				<label class="check">
					<input type="checkbox" bind:checked={isPublic} />
					<span>
						{m.issue_publicLabel()}
						<!-- "This report may be shown on the public issues page" -->
						<small class="muted">{m.issue_publicHint()}</small>
						<!-- "Other people can then see and discuss it. Leave this off if it contains anything private." -->
					</span>
				</label>

				{#if error}
					<p class="error" role="alert">{error}</p>
				{/if}

				<div class="actions">
					<button type="button" class="button-secondary" onclick={() => issueReportStore.close()}>
						{m.common_cancel()}
					</button>
					<button type="submit" class="button-primary" disabled={submitting || !title.trim()}>
						{submitting ? m.issue_sending() : m.issue_submit()}
						<!-- "Send report" -->
					</button>
				</div>
			</form>
		{/if}
	</ModalShell>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.issue-form,
	.filed {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	label {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
	}
	input[type='text'],
	input[type='email'],
	select,
	textarea {
		font: inherit;
		color: var(--text-primary);
		background: var(--bg-primary);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		padding: var(--space-1) var(--space-2);
	}
	.check {
		flex-direction: row;
		align-items: flex-start;
		gap: var(--space-2);
		input {
			margin-top: 3px;
		}
		span {
			display: flex;
			flex-direction: column;
		}
	}
	.context {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3) var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		legend {
			font-size: var(--font-size-sm);
			font-weight: 600;
			padding: 0 var(--space-1);
		}
	}
	.muted {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.small {
		font-size: var(--font-size-xs);
	}
	.error {
		color: var(--status-danger);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}
	.button-primary {
		@include mix.button-primary;
	}
	.button-secondary {
		@include mix.button-secondary;
	}
</style>
