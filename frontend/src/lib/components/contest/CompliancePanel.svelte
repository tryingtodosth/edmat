<script lang="ts">
	/** The organiser's own obligations, evaluated against this contest's rows — and every citation
	 * drawn with the marker that says how sure the research behind it is.
	 *
	 * Three things about this panel are not negotiable:
	 *
	 * 1. **It says it is not legal advice, and it refuses to draw without that field.** The server
	 *    sends `not_legal_advice: true` as data rather than leaving the sentence to the copy,
	 *    because the copy is the one thing a second surface can forget (CONTESTS-LAW.md §14).
	 * 2. **Every citation shows its marker** — `verified`, `secondary`, `unverified`, `disputed`.
	 *    An article number from memory must never be drawn the same way as one whose text was
	 *    opened.
	 * 3. **Three states, not two.** `missing` is a refusal the organiser can act on; `warning` is
	 *    something no database can check (has the prize actually been handed over? is the contest
	 *    on the minister's list?) and says so rather than showing a green tick it has not earned.
	 *
	 * Staff only — it is a list of obligations, several of them unmet, and publishing it beside a
	 * contest people are entering would be reporting the organiser to their own participants.
	 */
	import { getLocale } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
	import { complianceHint, complianceStateLabel, lawMarkerLabel } from '$lib/utils/labels';
	import type { CompliancePayload, LawCitation, PresetChecklistItem } from '$lib/types/contest';

	interface Props {
		report: CompliancePayload;
		law: Record<string, LawCitation>;
		/** The preset's own checklist, which is where each item's TITLE comes from — bilingual in
		 *  `contests/presets.py` already, so the twenty-four sentences are not duplicated into the
		 *  message catalogue where they would drift from the law they restate. */
		checklist?: PresetChecklistItem[];
		compact?: boolean;
	}

	let { report, law, checklist = [], compact = false }: Props = $props();

	const locale = $derived(getLocale());
	const titles = $derived(new Map(checklist.map((item) => [item.key, item])));

	/** The item's own sentence, plus whatever the server's `detail` key adds to it. */
	function line(key: string, detail: string): string {
		const item = titles.get(key);
		const title = item ? (locale === 'en' ? item.titleEn : item.titlePl) : key;
		const hint = complianceHint(detail, key);
		return hint ? `${title} — ${hint}` : title;
	}

	const counts = $derived.by(() => {
		const out = { ok: 0, missing: 0, warning: 0 };
		for (const item of report.items) out[item.state] += 1;
		return out;
	});
	const shown = $derived(
		compact ? report.items.filter((item) => item.state !== 'ok') : report.items
	);
</script>

{#if report.notLegalAdvice}
	<section class="panel" aria-labelledby="compliance-heading">
		<h3 id="compliance-heading">{m.contests_complianceHeading()}</h3>
		<!-- "What the law asks of the organiser" -->
		<p class="disclaimer">{m.contests_notLegalAdvice()}</p>
		<!-- "Nothing here is legal advice. EdMat hosts this contest and is not its organiser; the obligations below are the organiser's own, and a lawyer is the only person who can tell them whether they have met them." -->
		<p class="counts">
			{m.contests_complianceCounts({
				ok: counts.ok,
				missing: counts.missing,
				warning: counts.warning
			})}
			<!-- "{ok} done, {missing} still missing, {warning} that only a person can check" -->
		</p>

		{#if report.tax.applies}
			<div class="tax">
				<h4>{m.contests_taxHeading()}</h4>
				<!-- "Tax on the prize" -->
				<p>
					{m.contests_taxScienceLimb({
						threshold: report.tax.thresholdPln ?? 2000
					})}
					<!-- "A prize in a contest “w dziedzinie nauki” is exempt up to {threshold} zł; above that, 10% is withheld. EdMat deliberately does not offer the “mass media” limb of the same exemption — it is disputed for an announcement on the internet." -->
				</p>
				{#if report.tax.valuePln}
					<p>
						{report.tax.aboveThreshold
							? m.contests_taxAbove({
									value: report.tax.valuePln,
									threshold: report.tax.thresholdPln ?? 2000
								})
							: m.contests_taxBelow({
									value: report.tax.valuePln,
									threshold: report.tax.thresholdPln ?? 2000
								})}
						<!-- "The prize is {value} zł, above the {threshold} zł line." / "The prize is {value} zł, within the {threshold} zł exemption." -->
					</p>
					{#if report.tax.grossUpPln}
						<p>
							{m.contests_taxGrossUp({ gross: report.tax.grossUpPln })}
							<!-- "An in-kind prize is usually declared grossed up — {gross} zł — so the 10% is withheld from a cash part and the winner pays nothing out of pocket. That is practice, not statute." -->
						</p>
					{/if}
				{/if}
				{#if report.tax.law?.length}
					<ul class="law">
						{#each report.tax.law as key (key)}
							{#if law[key]}
								<li>
									<span class="marker marker--{law[key].marker}">
										{lawMarkerLabel(law[key].marker)()}
									</span>
									<span>{law[key].citation}</span>
								</li>
							{/if}
						{/each}
					</ul>
				{/if}
			</div>
		{/if}

		{#if shown.length === 0}
			<p class="all-done">{m.contests_complianceAllDone()}</p>
			<!-- "Everything this site can check is in place." -->
		{:else}
			<ul class="items">
				{#each shown as item (item.key)}
					<li class="item item--{item.state}">
						<p class="item__head">
							<span class="state">{complianceStateLabel(item.state)()}</span>
							<span class="title">{line(item.key, item.detail)}</span>
						</p>
						{#if item.law.length}
							<ul class="law">
								{#each item.law as key (key)}
									{#if law[key]}
										<li>
											<span class="marker marker--{law[key].marker}">
												{lawMarkerLabel(law[key].marker)()}
											</span>
											<span>{law[key].citation}</span>
										</li>
									{/if}
								{/each}
							</ul>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<style lang="scss">
	.panel {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface-alt);
		padding: var(--space-4);
	}
	h3 {
		margin: 0 0 0.3rem;
		font-size: var(--font-size-lg);
	}
	h4 {
		margin: 0 0 0.3rem;
		font-size: var(--font-size-md);
	}
	.disclaimer {
		margin: 0 0 0.5rem;
		font-size: var(--font-size-sm);
		color: var(--text-primary);
		border-left: 3px solid var(--status-warning);
		padding-left: 0.6rem;
	}
	.counts,
	.all-done {
		margin: 0 0 0.6rem;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.tax {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		padding: 0.6rem 0.8rem;
		margin-bottom: 0.7rem;
	}
	.tax p {
		margin: 0 0 0.4rem;
		font-size: var(--font-size-sm);
	}
	.items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.item {
		border: 1px solid var(--border-color);
		border-left: 3px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		padding: 0.45rem 0.65rem;
	}
	.item--ok {
		border-left-color: var(--status-success);
	}
	.item--missing {
		border-left-color: var(--status-danger);
	}
	.item--warning {
		border-left-color: var(--status-warning);
	}
	.item__head {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		align-items: baseline;
		font-size: var(--font-size-sm);
	}
	.state {
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--text-secondary);
	}
	.law {
		list-style: none;
		margin: 0.3rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.law li {
		display: flex;
		gap: 0.4rem;
		align-items: baseline;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.marker {
		flex: 0 0 auto;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: 0 0.3rem;
		font-size: var(--font-size-xs);
	}
	.marker--verified {
		border-color: var(--status-success);
		color: var(--status-success);
	}
	.marker--secondary {
		border-color: var(--status-info);
		color: var(--status-info);
	}
	.marker--unverified {
		border-color: var(--status-warning);
		color: var(--status-warning);
	}
	.marker--disputed {
		border-color: var(--status-danger);
		color: var(--status-danger);
	}
</style>
