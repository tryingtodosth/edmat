<script lang="ts">
	/** Browser errors: what broke in visitors' browsers, grouped by bug (`backend/analytics/
	 *  client_errors.py`). Each report carries no person — no account, address or identifier — so
	 *  nothing here is k-suppressed. Every string in a report is untrusted (it came from a browser)
	 *  and is only ever drawn as text, never as HTML. */
	import { m } from '$lib/paraglide/messages.js';
	import { getClientErrors } from '$lib/services/analytics';
	import type { AnalyticsDays, ClientErrorFacet } from '$lib/types/analytics';
	import { formatDateTime } from '$lib/utils/datetime';
	import { formatCount } from './format';
	import { browserLabel, deviceLabel, errorKindLabel, osLabel } from './labels';
	import Section from './Section.svelte';
	import Sparkline from './Sparkline.svelte';

	let { days, reloadKey }: { days: AnalyticsDays; reloadKey: number } = $props();

	/** V8 repeats the message as a stack's first line; Firefox and Safari do not. Show it once. */
	const sampleText = (s: { message: string; stack: string }) =>
		!s.stack ? s.message : s.stack.startsWith(s.message) ? s.stack : `${s.message}\n${s.stack}`;

	const facetText = (items: ClientErrorFacet[], label: (key: string) => string = (k) => k) =>
		items.map((f) => `${label(f.name) || '—'} (${formatCount(f.count)})`).join(', ');
</script>

<Section
	id="client-errors"
	title={m.analytics_errors_title()}
	intro={m.analytics_errors_intro()}
	deps={`${days}:${reloadKey}`}
	load={() => getClientErrors(days)}
>
	<!-- "Browser errors" / "What broke in visitors' browsers, grouped by bug. A report holds the error message, where in our code it happened, the page type, the app version and the browser family — no account, no address, no identifier. Browsers sending Global Privacy Control or Do Not Track send nothing." -->
	{#snippet children(e)}
		<p class="note">
			{m.analytics_errors_total({
				count: formatCount(e.total)
			})}<!-- "Reports in this period: {count}." -->
			{m.analytics_errors_retention({
				reports: e.reportsKeptDays,
				counts: e.countsKeptDays
			})}<!-- "Sample reports are kept {reports} days, counts {counts} days." -->
		</p>
		{#if e.period.days > e.countsKeptDays}
			<p class="note">{m.analytics_errors_olderNote({ counts: e.countsKeptDays })}</p>
			<!-- "Nothing older than {counts} days is kept, so the start of this period is empty." -->
		{/if}
		{#if e.groups.length === 0}
			<p class="note">{m.analytics_errors_none()}</p>
			<!-- "No browser errors were reported in this period." -->
		{:else}
			<ul class="groups">
				{#each e.groups as g (g.id)}
					<li class="group">
						<div class="head">
							<div class="what">
								<span class="kind">{errorKindLabel(g.kind)}</span>
								<code class="message">{g.message}</code>
							</div>
							<div class="count">
								<Sparkline values={g.daily} />
								<span class="num"
									>{m.analytics_errors_reports({ count: formatCount(g.count) })}</span
								><!-- "Reports: {count}" -->
							</div>
						</div>
						<dl class="facts">
							<div>
								<dt>{m.analytics_errors_routes()}</dt>
								<!-- "Page types" -->
								<dd class="mono">{facetText(g.routes)}</dd>
							</div>
							<div>
								<dt>{m.analytics_errors_browsers()}</dt>
								<!-- "Browsers" -->
								<dd>{facetText(g.browsers, browserLabel)}</dd>
							</div>
							<div>
								<dt>{m.analytics_errors_builds()}</dt>
								<!-- "Builds" -->
								<dd class="mono">{facetText(g.builds)}</dd>
							</div>
							<div>
								<dt>{m.analytics_errors_seen()}</dt>
								<!-- "Seen" -->
								<dd>
									{m.analytics_errors_seenRange({
										first: formatDateTime(g.firstSeen),
										last: formatDateTime(g.lastSeen)
									})}<!-- "first {first}, last {last}" -->
								</dd>
							</div>
							{#if g.topFrame}
								<div>
									<dt>{m.analytics_errors_where()}</dt>
									<!-- "Where" -->
									<dd class="mono">{g.topFrame}</dd>
								</div>
							{/if}
						</dl>
						{#if g.samples.length === 0}
							<p class="note">{m.analytics_errors_noSamples({ reports: e.reportsKeptDays })}</p>
							<!-- "No sample report left — samples are deleted after {reports} days." -->
						{:else}
							<details>
								<summary>{m.analytics_errors_samples({ count: g.samples.length })}</summary
								><!-- "Sample reports ({count})" -->
								{#each g.samples as s, i (i)}
									<div class="sample">
										<p class="meta">
											{formatDateTime(s.receivedAt)} · <span class="mono">{s.route}</span> ·
											{browserLabel(s.browser)} / {osLabel(s.os)} / {deviceLabel(s.device)} ·
											{m.analytics_errors_build({ build: s.build || '—' })}<!-- "build {build}" -->
											{#if s.locale}· {s.locale}{/if}
										</p>
										<pre class="stack">{sampleText(s)}</pre>
									</div>
								{/each}
							</details>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{/snippet}
</Section>

<style lang="scss">
	.groups {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-3);
	}
	.group {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: var(--space-3);
		min-width: 0;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--space-2) var(--space-4);
	}
	.what {
		min-width: 0;
		flex: 1 1 20rem;
	}
	.kind {
		display: block;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.message {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		overflow-wrap: anywhere;
		color: var(--text-primary);
	}
	.count {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		white-space: nowrap;
	}
	.num {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
		gap: var(--space-1) var(--space-4);
		margin: var(--space-2) 0;
		font-size: var(--font-size-sm);
	}
	.facts div {
		min-width: 0;
	}
	.facts dt {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
	}
	.facts dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	summary {
		cursor: pointer;
		font-size: var(--font-size-sm);
		color: var(--accent);
	}
	.sample {
		margin-top: var(--space-2);
	}
	.meta {
		margin: 0 0 var(--space-1);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}
	.stack {
		margin: 0;
		padding: var(--space-2);
		background: var(--bg-surface-alt);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 20rem;
		overflow: auto;
	}
</style>
