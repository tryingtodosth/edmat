<script lang="ts">
	// The "⋯" on a piece of content, in one place, so that a statement, a hint, a solution, a
	// comment and a review all offer the same things in the same order (owner, 2026-10-08:
	// *"make sure each has a meatballs menu … reply higher than AI-assisted, also some quick mod
	// actions"*).
	//
	// **The order is the instruction**, and it is fixed here rather than left to five call sites:
	//
	//   1. Reply — the thing a reader most often wants, so it is never below a judgement about who
	//      wrote the text.
	//   2. Mark as AI-assisted — the author's own answer, or a reader's confidence (0–100%).
	//   3. Whatever this particular surface adds (edit, delete, save, pin, copy a link…).
	//   4. Report.
	//   5. A moderator's quick remove / restore — last, because it is the only one that takes
	//      something away from everybody.
	//
	// A surface passes what it has; every item is optional, and the menu does not render at all
	// when nothing is left (an anonymous visitor on a removed comment). `MeatballsMenu` owns the
	// opening, closing and keyboard behaviour, and this owns what is in it.
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { resolveReport } from '$lib/services/moderation';
	import type { ReportKind } from '$lib/types/report';
	import type { AssistanceTargetKind } from '$lib/types/provenance';
	import MeatballsMenu from './MeatballsMenu.svelte';
	import ModalShell from './ModalShell.svelte';
	import ReportModal from './ReportModal.svelte';
	import AiAssistModal from '$lib/components/provenance/AiAssistModal.svelte';
	import { useAiAssistance } from '$lib/components/provenance/aiAssistance.svelte';

	// MeatballsMenu declares this shape in its own instance script, which cannot be imported as a
	// type — so it is restated here, the way `CommentNode` already restates it.
	type MenuItem = { label: string; onselect: () => void; danger?: boolean; disabled?: boolean };

	let {
		kind,
		id,
		label,
		onReply,
		items = [],
		reportable = true,
		hidden = false,
		onModerated
	}: {
		/** The one string that is BOTH an `AssistanceTargetKind` and a `ReportKind` — the four kinds
		 *  this menu serves are in both registries under the same name, which is why one prop does
		 *  for both and why adding a fifth means checking both. */
		kind: AssistanceTargetKind;
		id: string;
		/** The trigger's accessible name — "Actions for this solution", not a bare "More". */
		label: string;
		onReply?: () => void;
		/** This surface's own items, in position 3. */
		items?: MenuItem[];
		/** False on your own content: reporting yourself is not a thing anybody means to do, so it
		 *  is left out rather than offered and then refused (the `CommentNode` precedent). */
		reportable?: boolean;
		/** Already removed or auto-hidden, so the moderator's item reads "restore" instead. */
		hidden?: boolean;
		/** Called after a remove/restore lands, so the surface can refetch — this component does not
		 *  know how the page holds its own rows. */
		onModerated?: () => void;
	} = $props();

	let marking = $state(false);
	let reporting = $state(false);
	let confirmingRemove = $state(false);
	let moderationNote = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	// The page-level holder that batches every chip's reading. `undefined` on a page that has not
	// called `provideAiAssistance()` — and that is a real case: `CommentNode` renders on eight
	// routes and only the exercise page provides one today. Without this check the menu would offer
	// "mark as AI-assisted" on, say, a material's comment and the dialog would sit on "loading"
	// forever, because nothing would ever register the target or hold the answer. Offering nothing
	// is the honest version of not having built it there yet.
	const assistance = useAiAssistance();
	const aiEnabled = $derived(!!assistance && featureFlagsStore.isEnabled('ai_assisted'));
	// A node governor counts: `resolveReport` is scoped server-side to what they actually govern,
	// so offering it to them is honest — the refusal, if any, is the server's and comes with a
	// reason. `authStore.canModerate` is the store's own "global moderator OR scoped governor".
	const canModerate = $derived(authStore.canModerate);

	const menuItems = $derived.by<MenuItem[]>(() => {
		const out: MenuItem[] = [];
		if (onReply) out.push({ label: m.discussion_reply(), onselect: onReply }); // "Reply"
		if (aiEnabled && authStore.isAuthenticated) {
			out.push({ label: m.aiAssist_menuItem(), onselect: () => (marking = true) });
			// "Mark as AI-assisted…"
		}
		out.push(...items);
		if (reportable && authStore.isAuthenticated) {
			out.push({ label: m.report_action(), onselect: () => (reporting = true) }); // "Report"
		}
		if (canModerate) {
			out.push({
				label: hidden ? m.moderation_quickRestore() : m.moderation_quickRemove(),
				// "Restore this (moderator)" / "Remove this (moderator)"
				danger: !hidden,
				// Two steps, never one: MeatballsMenu deliberately confirms nothing itself, and a
				// remove takes the content away from everybody. The same dialog collects the note
				// the decision is recorded with — house rule 6 reaches the author as the
				// `content_removed` notification's statement of reasons.
				onselect: () => (confirmingRemove = true)
			});
		}
		return out;
	});

	async function decide(decision: 'remove' | 'restore') {
		busy = true;
		error = null;
		try {
			await resolveReport(kind as ReportKind, id, decision, moderationNote);
			confirmingRemove = false;
			moderationNote = '';
			onModerated?.();
		} catch {
			error = m.common_error_generic();
		} finally {
			busy = false;
		}
	}
</script>

{#if menuItems.length > 0}
	<MeatballsMenu items={menuItems} {label} />
{/if}

{#if marking}
	<AiAssistModal {kind} {id} onClose={() => (marking = false)} />
{/if}

{#if reporting}
	<ReportModal kind={kind as ReportKind} objectId={id} onClose={() => (reporting = false)} />
{/if}

{#if confirmingRemove}
	<ModalShell
		title={hidden ? m.moderation_quickRestore() : m.moderation_quickRemove()}
		onClose={() => (confirmingRemove = false)}
	>
		<p class="warn">
			{hidden ? m.moderation_quickRestoreWarning() : m.moderation_quickRemoveWarning()}
			<!-- "This puts it back where everybody can read it, and resolves every report against it." /
			     "This takes it away from everybody and resolves every report against it. The author is told, with your reason." -->
		</p>
		<label class="field">
			<span>{m.moderation_quickNoteLabel()}</span>
			<!-- "Your reason (sent to the author)" -->
			<textarea rows="2" bind:value={moderationNote} disabled={busy}></textarea>
		</label>
		{#if error}<p class="error">{error}</p>{/if}
		<div class="actions">
			<button type="button" class="secondary" onclick={() => (confirmingRemove = false)}>
				{m.common_cancel()}
			</button>
			<button
				type="button"
				class="primary"
				onclick={() => decide(hidden ? 'restore' : 'remove')}
				disabled={busy}
			>
				{hidden ? m.moderation_quickRestore() : m.moderation_quickRemove()}
			</button>
		</div>
	</ModalShell>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.warn {
		margin: 0 0 var(--space-2);
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
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
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
	.primary {
		@include mix.button-primary;
	}
	.secondary {
		@include mix.button-secondary;
	}
	.error {
		@include mix.status-message(danger);
		align-self: flex-start;
		margin-top: var(--space-2);
	}
</style>
