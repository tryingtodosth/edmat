<script lang="ts">
	// The avatar, behind the same door as everything else on the editor.
	//
	// A thin wrapper on purpose: `AvatarEditor` already owns the picker, the real crop step, the 512px
	// WebP encode and the remove button, and it already saves through its own endpoint — so this only
	// gives it a title and a way out, exactly as `EducationModal` does for the education panel. Copying
	// any of that logic to make it "fit a modal" would duplicate the one flow in this app whose client
	// side has to agree with a server-side re-encode.
	import { m } from '$lib/paraglide/messages.js';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import AvatarEditor from '$lib/components/settings/AvatarEditor.svelte';

	let { onClose }: { onClose: () => void } = $props();
</script>

<ModalShell title={m.settings_avatarHeading()} {onClose}>
	<AvatarEditor />
</ModalShell>
