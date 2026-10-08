<script lang="ts">
	// The "⋯" on a management row — a task, a plan, a need, a poll, a poll option — and the one
	// place "Edit in both languages" opens `TranslateFields`.
	//
	// Why it exists at all (owner, 2026-10-08): *"cant edit task etc from aboutsubpage from frontend
	// (has to be done using django admin - add meatball menu here as well)"*. Checked before
	// building: `updateNeed`, `updatePoll` and `deletePoll` were all present in the services with NO
	// call site anywhere in the app, so a need's words and a poll's question really were only
	// editable through Django admin. A plan and a task already had edit forms; they get this too,
	// because the EDIT and the TRANSLATION are one submission now and that is the form that does
	// both.
	//
	// Each caller passes the items that are its own (cancel a need, delete a draft poll). The menu
	// itself only ever owns the text.
	import { m } from '$lib/paraglide/messages.js';
	import MeatballsMenu from '$lib/components/shared/MeatballsMenu.svelte';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import TranslateFields from './TranslateFields.svelte';
	import type { TextVersion, TranslatableKind } from '$lib/types/translation';
	import type { WrittenText } from '$lib/services/textVersions';

	// MeatballsMenu declares this shape in its own instance script, which cannot be imported as a
	// type — restated here, as `CommentNode` and `ContentActionsMenu` already do.
	type MenuItem = { label: string; onselect: () => void; danger?: boolean; disabled?: boolean };

	let {
		kind,
		id,
		versions,
		fallbackHeading = '',
		fallbackBody = '',
		withBody = true,
		withHeading = true,
		headingLabel,
		bodyLabel,
		label,
		canEdit = true,
		items = [],
		onSaved
	}: {
		kind: TranslatableKind;
		id: string;
		versions: TextVersion[];
		fallbackHeading?: string;
		fallbackBody?: string;
		withBody?: boolean;
		/** False for an organisation — see `TranslateFields`. */
		withHeading?: boolean;
		headingLabel: string;
		bodyLabel?: string;
		/** The trigger's accessible name — "Actions for this need", not a bare "More". */
		label: string;
		/** Server-computed, never guessed client-side (house rule 4 and the `canEdit`/`canManage`
		 *  fields every management serializer already sends). */
		canEdit?: boolean;
		items?: MenuItem[];
		onSaved: (written: WrittenText) => void;
	} = $props();

	let editing = $state(false);

	const menuItems = $derived.by<MenuItem[]>(() => {
		const out: MenuItem[] = [];
		if (canEdit) {
			out.push({ label: m.translate_editBothLanguages(), onselect: () => (editing = true) });
			// "Edit in both languages…"
		}
		out.push(...items);
		return out;
	});
</script>

{#if menuItems.length > 0}
	<MeatballsMenu items={menuItems} {label} />
{/if}

{#if editing}
	<ModalShell title={m.translate_modalTitle()} onClose={() => (editing = false)} size="wide">
		<!-- "Text and translation" — `wide` because this dialog IS an editor, and two columns of
		     prose do not fit the default 560px form column. -->
		<TranslateFields
			{kind}
			{id}
			{versions}
			{fallbackHeading}
			{fallbackBody}
			{withBody}
			{withHeading}
			{headingLabel}
			{bodyLabel}
			onCancel={() => (editing = false)}
			onSaved={(written) => {
				editing = false;
				onSaved(written);
			}}
		/>
	</ModalShell>
{/if}
