<script lang="ts">
	/**
	 * The superuser's Mail tab (`backend/mail/`): what no-reply@edmat.net sent, and what arrived in
	 * its inbox.
	 *
	 * Its own component for the reason `DiscussionLocationsPanel` is: the moderation page is past a
	 * thousand lines and this tab is self-contained. Lists come without bodies; a row's body is
	 * fetched when it is opened, so the list of two hundred stays small.
	 *
	 * Every body is drawn as plain text inside a `<pre>`, never as HTML: an inbound message is text
	 * a stranger wrote, and the server already reduced any HTML in it to text (`mail/inbox.py`).
	 * A confirmation or reset message shows `[[link]]` where its link went — the server never
	 * stores a working one (`mail/models.py`).
	 */
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { formatDateTime } from '$lib/utils/datetime';
	import { authStore } from '$lib/state/auth.svelte';
	import {
		fetchInbox,
		getInbound,
		getMailStatus,
		getOutbound,
		listInbound,
		listOutbound,
		retryOutbound,
		sendTestMail,
		type InboundEmail,
		type MailStatus,
		type OutboundEmail,
		type OutboundKind,
		type OutboundStatus
	} from '$lib/services/mail';

	const STATUS_LABELS: Record<OutboundStatus, () => string> = {
		queued: m.mail_status_queued, // "Queued"
		sending: m.mail_status_sending, // "Sending"
		sent: m.mail_status_sent, // "Sent"
		failed: m.mail_status_failed, // "Failed"
		console: m.mail_status_console // "Not sent (no mail server)"
	};
	const KIND_LABELS: Record<OutboundKind, () => string> = {
		confirm_email: m.mail_kind_confirm, // "Email confirmation"
		password_reset: m.mail_kind_reset, // "Password reset"
		notification_digest: m.mail_kind_digest, // "Notification digest"
		test: m.mail_kind_test, // "Test message"
		direct: m.mail_kind_direct, // "Other"
		account_erasure: m.account_mailKind // "Account deletion notice"
	};
	const UNAVAILABLE: Record<string, () => string> = {
		not_configured: m.mail_fetch_notConfigured, // "No mailbox password on this server…"
		login_failed: m.mail_fetch_loginFailed, // "The mailbox refused the password."
		unreachable: m.mail_fetch_unreachable // "The mail server could not be reached."
	};

	let view = $state<'sent' | 'received'>('sent');
	let status = $state<MailStatus | null>(null);
	let sent = $state<OutboundEmail[]>([]);
	let received = $state<InboundEmail[]>([]);
	let query = $state('');
	let statusFilter = $state('');
	let loading = $state(true);
	let error = $state('');
	let notice = $state('');
	let fetching = $state(false);
	let testTo = $state(authStore.user?.email ?? '');
	let sendingTest = $state(false);
	let openId = $state<string | null>(null);
	let openSent = $state<OutboundEmail | null>(null);
	let openReceived = $state<InboundEmail | null>(null);

	function when(iso: string | null): string {
		return iso ? formatDateTime(iso) : '—';
	}

	async function load() {
		loading = true;
		error = '';
		try {
			const [s, out, inbound] = await Promise.all([
				getMailStatus(),
				listOutbound({ q: query, status: statusFilter }),
				listInbound(query)
			]);
			status = s;
			sent = out;
			received = inbound;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function toggleSent(row: OutboundEmail) {
		if (openId === `s${row.id}`) {
			openId = null;
			return;
		}
		openId = `s${row.id}`;
		openSent = null;
		openSent = await getOutbound(row.id);
	}

	async function toggleReceived(row: InboundEmail) {
		if (openId === `r${row.id}`) {
			openId = null;
			return;
		}
		openId = `r${row.id}`;
		openReceived = null;
		openReceived = await getInbound(row.id);
	}

	async function fetchNow() {
		fetching = true;
		notice = '';
		error = '';
		try {
			const count = await fetchInbox();
			notice = m.mail_fetch_done({ count }); // "{count} new message(s) fetched."
			view = 'received';
			await load();
		} catch (e) {
			const detail = e instanceof Error ? e.message : '';
			error = (UNAVAILABLE[detail] ?? (() => detail))();
		} finally {
			fetching = false;
		}
	}

	async function sendTest(event: SubmitEvent) {
		event.preventDefault();
		sendingTest = true;
		notice = '';
		error = '';
		try {
			await sendTestMail(testTo.trim());
			notice = m.mail_test_queued({ to: testTo.trim() }); // "Test message to {to} queued."
			view = 'sent';
			// The send happens in a thread after the request returns; give it a moment so the row
			// shows its real status rather than "Queued".
			setTimeout(load, 2500);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			sendingTest = false;
		}
	}

	async function retry(row: OutboundEmail) {
		try {
			await retryOutbound(row.id);
			setTimeout(load, 2500);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	function search(event: SubmitEvent) {
		event.preventDefault();
		load();
	}
</script>

<div class="mail-panel">
	{#if status}
		<p class="status-line">
			{#if status.transport === 'smtp'}
				<span class="pill ok">{m.mail_transport_smtp({ host: status.smtpHost })}</span>
				<!-- "Sending through {host}" -->
			{:else}
				<span class="pill warn">{m.mail_transport_console()}</span>
				<!-- "Not sending: no mail server configured" -->
			{/if}
			<span>{m.mail_from({ address: status.fromAddress })}</span>
			<!-- "From: {address}" -->
			<span>{m.mail_counts({ queued: status.queued, failed: status.failed })}</span>
			<!-- "{queued} queued, {failed} failed" -->
			<span>{m.mail_lastFetched({ when: when(status.lastFetchedAt) })}</span>
			<!-- "Inbox last read: {when}" -->
		</p>
	{/if}

	<div class="actions">
		<button type="button" class="secondary" onclick={fetchNow} disabled={fetching}>
			{fetching ? m.mail_fetch_running() : m.mail_fetch_button()}
			<!-- "Reading the inbox…" / "Fetch new mail now" -->
		</button>
		<form class="inline" onsubmit={sendTest}>
			<label>
				<span class="visually-hidden">{m.mail_test_label()}</span>
				<!-- "Send a test message to" -->
				<input type="email" bind:value={testTo} required placeholder={m.mail_test_label()} />
			</label>
			<button type="submit" class="secondary" disabled={sendingTest}>{m.mail_test_button()}</button>
			<!-- "Send test" -->
		</form>
	</div>

	{#if notice}<p class="notice" role="status">{notice}</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<div class="subtabs" role="tablist">
		<button
			type="button"
			role="tab"
			aria-selected={view === 'sent'}
			class:active={view === 'sent'}
			onclick={() => (view = 'sent')}
		>
			{m.mail_sentTab({ count: sent.length })}
			<!-- "Sent ({count})" -->
		</button>
		<button
			type="button"
			role="tab"
			aria-selected={view === 'received'}
			class:active={view === 'received'}
			onclick={() => (view = 'received')}
		>
			{m.mail_receivedTab({ count: received.length })}
			<!-- "Received ({count})" -->
		</button>
		<form class="inline search" onsubmit={search}>
			<input
				type="search"
				bind:value={query}
				placeholder={m.mail_search()}
				aria-label={m.mail_search()}
			/>
			<!-- "Search address or subject" -->
			{#if view === 'sent'}
				<select bind:value={statusFilter} onchange={load} aria-label={m.mail_statusFilter()}>
					<!-- "Status" -->
					<option value="">{m.mail_statusAll()}</option>
					<!-- "Every status" -->
					{#each Object.entries(STATUS_LABELS) as [value, label] (value)}
						<option {value}>{label()}</option>
					{/each}
				</select>
			{/if}
		</form>
	</div>

	{#if loading}
		<p class="muted">{m.mail_loading()}</p>
		<!-- "Loading…" -->
	{:else if view === 'sent'}
		{#if sent.length === 0}
			<p class="muted">{m.mail_noneSent()}</p>
			<!-- "Nothing has been sent yet." -->
		{:else}
			<ul class="rows">
				{#each sent as row (row.id)}
					<li class:open={openId === `s${row.id}`}>
						<button
							type="button"
							class="row"
							onclick={() => toggleSent(row)}
							aria-expanded={openId === `s${row.id}`}
						>
							<span class="date">{when(row.createdAt)}</span>
							<span class="who">{row.to}</span>
							<span class="subject">{row.subject}</span>
							<span class="kind">{KIND_LABELS[row.kind]?.() ?? row.kind}</span>
							<span
								class="pill"
								class:ok={row.status === 'sent'}
								class:bad={row.status === 'failed'}
								class:warn={row.status === 'console' ||
									row.status === 'queued' ||
									row.status === 'sending'}
							>
								{STATUS_LABELS[row.status]?.() ?? row.status}
							</span>
						</button>
						{#if openId === `s${row.id}`}
							<div class="detail">
								{#if openSent}
									<dl>
										<dt>{m.mail_detail_account()}</dt>
										<!-- "Account" -->
										<dd>{openSent.username ?? '—'}</dd>
										<dt>{m.mail_detail_attempts()}</dt>
										<!-- "Attempts" -->
										<dd>{openSent.attempts} · {openSent.transport}</dd>
										<dt>{m.mail_detail_sentAt()}</dt>
										<!-- "Delivered" -->
										<dd>{when(openSent.sentAt)}</dd>
									</dl>
									{#if openSent.error}<p class="error">{openSent.error}</p>{/if}
									<pre class="body">{openSent.body}</pre>
									{#if openSent.status === 'failed' && openSent.kind !== 'direct'}
										<button type="button" class="secondary" onclick={() => retry(row)}
											>{m.mail_retry()}</button
										>
										<!-- "Try again" -->
									{/if}
								{:else}
									<p class="muted">{m.mail_loading()}</p>
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{:else if received.length === 0}
		<p class="muted">{m.mail_noneReceived()}</p>
		<!-- "No mail fetched yet. “Fetch new mail now” reads the inbox." -->
	{:else}
		<ul class="rows">
			{#each received as row (row.id)}
				<li class:open={openId === `r${row.id}`}>
					<button
						type="button"
						class="row"
						onclick={() => toggleReceived(row)}
						aria-expanded={openId === `r${row.id}`}
					>
						<span class="date">{when(row.date)}</span>
						<span class="who">{row.fromAddress}</span>
						<span class="subject">{row.subject || m.mail_noSubject()}</span>
						<!-- "(no subject)" -->
						<span class="kind"
							>{row.attachments.length
								? m.mail_attachmentCount({ count: row.attachments.length })
								: ''}</span
						>
						<!-- "{count} attachment(s)" -->
					</button>
					{#if openId === `r${row.id}`}
						<div class="detail">
							{#if openReceived}
								<dl>
									<dt>{m.mail_detail_to()}</dt>
									<!-- "To" -->
									<dd>{openReceived.to}</dd>
									{#if openReceived.attachments.length}
										<dt>{m.mail_detail_attachments()}</dt>
										<!-- "Attachments (names only — not stored)" -->
										<dd>
											{openReceived.attachments
												.map((a) => `${a.filename} (${Math.ceil(a.size / 1024)} kB)`)
												.join(', ')}
										</dd>
									{/if}
								</dl>
								<pre class="body">{openReceived.body}</pre>
								{#if openReceived.bodyTruncated}
									<p class="muted">{m.mail_truncated()}</p>
									<!-- "The message was longer; only its beginning is kept." -->
								{/if}
							{:else}
								<p class="muted">{m.mail_loading()}</p>
							{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.mail-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.status-line {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-4);
		align-items: center;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.pill {
		@include mix.neutral-pill;
		white-space: nowrap;
		&.ok {
			@include mix.status-pill(var(--status-success), var(--status-success-bg));
		}
		&.warn {
			@include mix.status-pill(var(--status-warning), var(--status-warning-bg));
		}
		&.bad {
			@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		}
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
	}
	.inline {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}
	input,
	select {
		@include mix.focus-ring;
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		color: inherit;
		min-width: 0;
	}
	.secondary {
		@include mix.button-secondary;
	}
	.visually-hidden {
		@include mix.visually-hidden;
	}
	.subtabs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
		border-bottom: 1px solid var(--border-color);
		padding-bottom: var(--space-2);
		> button {
			@include mix.focus-ring;
			background: none;
			border: none;
			padding: var(--space-1) var(--space-2);
			border-radius: var(--radius-sm);
			cursor: pointer;
			color: var(--text-secondary);
			font: inherit;
			&.active {
				@include mix.selected-soft;
				color: var(--text-primary);
				font-weight: 600;
			}
		}
		.search {
			margin-left: auto;
		}
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	li {
		border-bottom: 1px solid var(--border-color);
		&.open {
			background: var(--bg-surface-alt);
		}
	}
	.row {
		@include mix.focus-ring;
		width: 100%;
		display: grid;
		grid-template-columns: 9.5rem minmax(0, 14rem) minmax(0, 1fr) auto auto;
		gap: var(--space-3);
		align-items: center;
		padding: var(--space-2);
		background: none;
		border: none;
		text-align: left;
		font: inherit;
		color: inherit;
		cursor: pointer;
		> span {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}
	.date,
	.kind {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.who {
		font-size: var(--font-size-sm);
	}
	.detail {
		padding: var(--space-2) var(--space-3) var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		align-items: flex-start;
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-1) var(--space-3);
		margin: 0;
		font-size: var(--font-size-sm);
	}
	dt {
		color: var(--text-secondary);
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.body {
		width: 100%;
		box-sizing: border-box;
		margin: 0;
		padding: var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-size: var(--font-size-sm);
		max-height: 32rem;
		overflow: auto;
	}
	.notice {
		color: var(--status-success);
		font-size: var(--font-size-sm);
	}
	.error {
		color: var(--status-danger);
		font-size: var(--font-size-sm);
		overflow-wrap: anywhere;
	}
	.muted {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	@media (max-width: 720px) {
		.row {
			grid-template-columns: 1fr auto;
			.date {
				grid-column: 1 / -1;
			}
			.subject {
				grid-column: 1 / -1;
			}
			.kind {
				display: none;
			}
		}
		.subtabs .search {
			margin-left: 0;
			width: 100%;
		}
	}
</style>
