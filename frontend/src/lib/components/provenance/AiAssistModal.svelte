<script lang="ts">
	// The dialog behind the chip and behind the content menu's "mark as AI-assisted": the whole
	// reading, and whichever of the three ways of writing to it this reader actually has.
	//
	// The three are deliberately separate panels and not one form, because they are three different
	// people speaking (see `backend/provenance/models.py`): the author discloses, a reader gives a
	// confidence, a moderator ends the argument. Nobody ever sees more than two of them, and most
	// readers see one.
	//
	// `type="range"` binds a real `number`, which is what `confidence` is — frontend/CLAUDE.md trap
	// 1 is about `type="number"` feeding string-assuming code, and nothing here trims it.
	import { m } from '$lib/paraglide/messages.js';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import type { AssistanceTargetKind } from '$lib/types/provenance';
	import {
		declare,
		lockScore,
		retractAuthorMark,
		retractVote,
		unlockScore,
		vote
	} from '$lib/services/provenance';
	import { useAiAssistance } from './aiAssistance.svelte';

	let { kind, id, onClose }: { kind: AssistanceTargetKind; id: string; onClose: () => void } =
		$props();

	const assistance = useAiAssistance();
	const reading = $derived(assistance?.reading(kind, id));

	// Starts at this reader's own vote if they have one, else at the midpoint — which reads as "I
	// genuinely do not know", the honest default for a question nobody has asked you yet.
	let confidence = $state(50);
	let seeded = $state(false);
	$effect(() => {
		if (seeded || !reading) return;
		seeded = true;
		if (reading.myConfidence !== null) confidence = reading.myConfidence;
	});

	let note = $state('');
	let lockValue = $state(0);
	let lockReason = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function run(action: () => Promise<void>) {
		busy = true;
		error = null;
		try {
			await action();
		} catch {
			error = m.common_error_generic();
		} finally {
			busy = false;
		}
	}

	const saveVote = () => run(async () => assistance?.apply(await vote(kind, id, confidence)));
	const dropVote = () => run(async () => assistance?.apply(await retractVote(kind, id)));
	const say = (assisted: boolean) =>
		run(async () => assistance?.apply(await declare(kind, id, assisted, note)));
	const unsay = () => run(async () => assistance?.apply(await retractAuthorMark(kind, id)));
	const lock = () =>
		run(async () => assistance?.apply(await lockScore(kind, id, lockValue, lockReason)));
	const unlock = () => run(async () => assistance?.apply(await unlockScore(kind, id)));
</script>

<ModalShell title={m.aiAssist_modalTitle()} {onClose}>
	<!-- "Was this written with AI?" -->
	{#if !reading}
		<p class="status">{m.common_loading()}</p>
	{:else}
		<p class="explain">{m.aiAssist_whatItMeans()}</p>
		<!-- "“AI-assisted” means a language model wrote or rewrote part of this text. Using one to check your own work, or to translate it, is not the same thing — and none of this makes the content wrong." -->

		<ul class="reading">
			<li class:lit={reading.authorMarked}>
				<span class="who">{m.aiAssist_authorRow()}</span>
				<!-- "The author" -->
				<span class="says">
					{#if reading.authorMarked}
						{m.aiAssist_authorSaysYes()}
						<!-- "says a machine helped write this" -->
					{:else if reading.authorAnswered}
						{m.aiAssist_authorSaysNo()}
						<!-- "says they wrote this themselves" -->
					{:else}
						{m.aiAssist_authorSaysNothing()}
						<!-- "has not answered" -->
					{/if}
				</span>
			</li>
			{#if reading.authorNote}
				<li class="note">{reading.authorNote}</li>
			{/if}
			<li class:lit={reading.communityMarked}>
				<span class="who">{m.aiAssist_readersRow()}</span>
				<!-- "Readers" -->
				<span class="says">
					{#if reading.votes === 0}
						{m.aiAssist_noVotes()}
						<!-- "nobody has given an opinion yet" -->
					{:else}
						{m.aiAssist_voteSummary({
							count: reading.votes,
							percent: reading.averageConfidence
						})}
						<!-- "{count} gave an opinion, {percent}% sure on average" -->
					{/if}
				</span>
			</li>
			{#if reading.votes > 0 && !reading.communityMarked && !reading.locked}
				<li class="note">{m.aiAssist_notEnoughYet()}</li>
				<!-- "Not enough people have looked for this to count as a reading by the community." -->
			{/if}
			{#if reading.locked}
				<li class="note locked">
					{m.aiAssist_lockedAt({ percent: reading.lockValue ?? 0 })}
					<!-- "A moderator has fixed this at {percent}%:" -->
					{reading.lockReason}
				</li>
			{/if}
		</ul>

		{#if reading.canVote}
			<section class="panel">
				<h3>{m.aiAssist_voteHeading()}</h3>
				<!-- "How sure are you that this was written with AI?" -->
				<label class="slider">
					<input
						type="range"
						min="0"
						max="100"
						step="5"
						bind:value={confidence}
						disabled={busy}
						aria-describedby="ai-assist-scale"
					/>
					<output>{confidence}%</output>
				</label>
				<p id="ai-assist-scale" class="scale">{m.aiAssist_scaleHint()}</p>
				<!-- "0% — certainly a person wrote it. 100% — certainly a machine helped." -->
				<div class="actions">
					{#if reading.myConfidence !== null}
						<button type="button" class="secondary" onclick={dropVote} disabled={busy}>
							{m.aiAssist_retractVote()}
							<!-- "Take my opinion back" -->
						</button>
					{/if}
					<button type="button" class="primary" onclick={saveVote} disabled={busy}>
						{reading.myConfidence === null ? m.aiAssist_saveVote() : m.aiAssist_changeVote()}
						<!-- "Give my opinion" / "Change my opinion" -->
					</button>
				</div>
			</section>
		{:else if !reading.canDeclare}
			<p class="status">{m.aiAssist_signInToVote()}</p>
			<!-- "Sign in to give your own opinion." -->
		{/if}

		{#if reading.canDeclare}
			<section class="panel">
				<h3>{m.aiAssist_declareHeading()}</h3>
				<!-- "Your own answer, as the author" -->
				<p class="scale">{m.aiAssist_declareHint()}</p>
				<!-- "Your answer is kept apart from the readers’ votes and is never overwritten by them." -->
				<label class="field">
					<span>{m.aiAssist_noteLabel()}</span>
					<!-- "Anything you want to add (optional)" -->
					<textarea rows="2" bind:value={note} disabled={busy}></textarea>
				</label>
				<div class="actions">
					{#if reading.authorAnswered}
						<button type="button" class="secondary" onclick={unsay} disabled={busy}>
							{m.aiAssist_withdrawMark()}
							<!-- "Withdraw my answer" -->
						</button>
					{/if}
					<button type="button" class="secondary" onclick={() => say(false)} disabled={busy}>
						{m.aiAssist_declareNo()}
						<!-- "I wrote this myself" -->
					</button>
					<button type="button" class="primary" onclick={() => say(true)} disabled={busy}>
						{m.aiAssist_declareYes()}
						<!-- "A machine helped me write this" -->
					</button>
				</div>
			</section>
		{/if}

		{#if reading.canLock}
			<section class="panel panel--mod">
				<h3>{m.aiAssist_lockHeading()}</h3>
				<!-- "Moderator: fix this reading" -->
				{#if reading.locked}
					<div class="actions">
						<button type="button" class="secondary" onclick={unlock} disabled={busy}>
							{m.aiAssist_unlock()}
							<!-- "Let the votes count again" -->
						</button>
					</div>
				{:else}
					<label class="slider">
						<input type="range" min="0" max="100" step="5" bind:value={lockValue} disabled={busy} />
						<output>{lockValue}%</output>
					</label>
					<label class="field">
						<span>{m.aiAssist_lockReasonLabel()}</span>
						<!-- "Why (shown to everyone, including the author)" -->
						<textarea rows="2" bind:value={lockReason} disabled={busy}></textarea>
					</label>
					<div class="actions">
						<button
							type="button"
							class="primary"
							onclick={lock}
							disabled={busy || !lockReason.trim()}
						>
							{m.aiAssist_lock()}
							<!-- "Fix it there" -->
						</button>
					</div>
				{/if}
			</section>
		{/if}

		{#if error}<p class="error">{error}</p>{/if}
	{/if}
</ModalShell>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.explain,
	.scale,
	.status {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		margin: 0 0 var(--space-2);
	}
	.reading {
		list-style: none;
		margin: 0 0 var(--space-3);
		padding: 0;
		display: grid;
		gap: 0.3rem;
		font-size: var(--font-size-sm);
	}
	.reading li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.who {
		font-weight: 600;
	}
	.says {
		color: var(--text-secondary);
	}
	.lit .says {
		color: var(--status-warning);
	}
	.note {
		color: var(--text-secondary);
		font-style: italic;
	}
	.note.locked {
		font-style: normal;
	}
	.panel {
		border-top: 1px solid var(--border-color);
		padding-top: var(--space-3);
		margin-top: var(--space-3);
	}
	.panel--mod {
		border-top-style: dashed;
	}
	h3 {
		margin: 0 0 var(--space-2);
		font-size: var(--font-size-sm);
	}
	.slider {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.slider input {
		@include mix.focus-ring;
		flex: 1;
	}
	.slider output {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		min-width: 3ch;
		text-align: right;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-top: var(--space-2);
		font-size: var(--font-size-sm);
	}
	textarea {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		font-family: inherit;
		resize: vertical;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
	.primary {
		@include mix.button-primary;
	}
	.secondary {
		@include mix.button-secondary;
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		align-self: flex-start;
	}
</style>
