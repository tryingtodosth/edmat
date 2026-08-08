<script lang="ts">
	// Institution, USOS connection, transferred diploma and transcript, and the three consents.
	//
	// **It renders `EducationPanel` rather than reimplementing it.** That component already owns every
	// hard part — the school picker with its "not listed" answer, the two separately-authorized connect
	// buttons, the transfers, the per-year transcript, and three consents that each save on their own —
	// and a second copy for the modal would be roughly two hundred lines duplicating the most
	// privacy-sensitive logic in this app. It gained one `embedded` prop instead, which drops its own
	// heading because this shell already supplies one.
	//
	// It is also why this modal has no Save button of its own: nothing in there batches. Each control
	// commits when it is used, which is the whole point of separating importing from publishing, and a
	// Save button over the top would imply the opposite.
	import { m } from '$lib/paraglide/messages.js';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import EducationPanel from '$lib/components/settings/EducationPanel.svelte';

	let { onClose }: { onClose: () => void } = $props();
</script>

<ModalShell title={m.education_heading()} {onClose}>
	<!-- "Education" -->
	<p class="lead">{m.education_lead()}</p>
	<EducationPanel embedded />
</ModalShell>

<style lang="scss">
	.lead {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
</style>
