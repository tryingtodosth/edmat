<script lang="ts">
	// The sentence that replaces a create button the server would refuse (learning step F,
	// prompts/07-creation-gate.md). One component, eight call sites: the four hubs whose button is
	// now hidden, and the four `…/new` pages somebody can still reach by typing the address or
	// following an old link.
	//
	// **It renders nothing unless there is a real refusal to explain.** `creationStore` answers
	// `null` both when the account may go ahead and when nothing is known yet (its own module
	// comment says why those must not be collapsed), so a verified contributor and a reader whose
	// `GET /api/creation/` has not come back see no sentence at all — never a sentence about
	// themselves that is not true.
	//
	// House rule 3 is why this exists rather than just hiding the button: a feature whose controls
	// vanish with no explanation has not been hidden, it has been made into a puzzle. House rule 6
	// is why there are three sentences and not one — "you have to be 16" and "ask a moderator to
	// verify you" are the same refusal to a boolean and completely different to a person.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { creationStore } from '$lib/state/creation.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import type { CreationKind } from '$lib/types/creation';
	import { gateHubSentence, gateReasonLabel } from '$lib/utils/labels';

	let { kind }: { kind: CreationKind } = $props();

	let reason = $derived(creationStore.reasonFor(kind));
	// `verification_required` is the one refusal that is about the THING as much as the person, so
	// it gets the hub's own wording ("new courses are started by…"); the other two are facts about
	// the account and read identically wherever they appear.
	let sentence = $derived(
		reason === null
			? ''
			: reason === 'verification_required'
				? gateHubSentence(kind)
				: gateReasonLabel(reason)
	);
	// The "request verification" button this cycle deliberately did not build goes through `issues`
	// today (the brief's own "Left open"), so the sentence links there instead of promising a flow
	// that does not exist — and only while that switch is on, because a link to a killed feature is
	// exactly what house rule 3 forbids. `|| isModerator` mirrors `FeatureGate` and the backend.
	let canIssues = $derived(featureFlagsStore.isEnabled('issues') || authStore.isModerator);
</script>

{#if reason !== null}
	<p class="gate-note" data-creation-gate={kind} data-creation-gate-reason={reason}>
		<span>{sentence}</span>
		<span class="gate-note__links">
			<a href={resolve('/levels')}>{m.gate_whatIsVerified()}</a>
			<!-- "What a verified contributor is" -->
			{#if reason === 'verification_required' && canIssues}
				<a href={resolve('/issues')}>{m.gate_askAboutVerification()}</a>
				<!-- "Ask about verification" -->
			{/if}
		</span>
	</p>
{/if}

<style lang="scss">
	.gate-note {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		max-width: 46rem;
		margin: 0;
		padding: var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface-alt);
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		line-height: 1.5;
	}
	.gate-note__links {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.gate-note__links a {
		color: var(--accent);
		font-weight: 600;
	}
</style>
