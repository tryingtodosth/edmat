<script lang="ts">
	// The profile-picture upload CLAUDE.md Section 17B has listed as "no avatar upload UI anywhere"
	// since the Notifications feature — `Profile.avatar` has existed as a model field since Phase 2
	// with nothing anywhere in the app able to write to it.
	//
	// The crop step exists so the user picks WHICH square of their photo becomes the avatar, rather
	// than the server silently centre-cropping and cutting someone's head off. `svelte-easy-crop`
	// (v5, a real Svelte 5 component with `svelte: ^5.0.0` as its own peer dependency — not a Svelte
	// 3/4 package leaning on the compatibility layer) handles the drag/pinch/zoom interaction and
	// hands back the selected region in NATURAL image pixels, which is what `drawImage` below needs.
	//
	// **The client-side crop is a UX affordance, never a security boundary.** Everything this
	// component does — the type check, the size check, the crop, the WebP encode — is about giving
	// fast, local feedback and a smaller upload. The backend re-decodes and re-encodes whatever
	// actually arrives (accounts/avatar.py), so none of it is load-bearing for safety: a caller
	// POSTing straight to the endpoint with a 5 MB decompression bomb hits exactly the same
	// rejections. Duplicating the checks here is worth it anyway, because a rejection that happens
	// before a multi-megabyte upload is a far better experience than one that happens after it.
	import Cropper from 'svelte-easy-crop';
	import type { CropArea, Point } from 'svelte-easy-crop';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';

	// Kept deliberately in step with accounts/avatar.py's own MAX_AVATAR_UPLOAD_BYTES /
	// ALLOWED_AVATAR_TYPES / AVATAR_SIZE. A hand-maintained mirror of a small backend constant, the
	// same convention (and the same honestly-flagged drift risk) as DONATION_PLATFORMS and
	// NOTIFICATION_TYPE_CATEGORY in lib/utils/labels.ts — the alternative, an endpoint that exists
	// only to publish three numbers, is disproportionate.
	const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
	const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
	const OUTPUT_SIZE = 512;

	let fileInput = $state<HTMLInputElement | null>(null);
	// The object URL of the picked file. Non-null is exactly the condition for "the crop dialog is
	// open", so there's no separate `open` flag that could drift out of sync with it.
	let sourceUrl = $state<string | null>(null);
	let crop = $state<Point>({ x: 0, y: 0 });
	let zoom = $state(1);
	let croppedAreaPixels = $state<CropArea | null>(null);
	let busy = $state(false);
	let error = $state('');

	const avatarUrl = $derived(authStore.user?.avatarUrl);

	function closeEditor() {
		// Object URLs are held by the document until explicitly revoked — without this, picking
		// several photos in one sitting leaks the full decoded bytes of each one for the lifetime of
		// the page.
		if (sourceUrl) URL.revokeObjectURL(sourceUrl);
		sourceUrl = null;
		croppedAreaPixels = null;
		crop = { x: 0, y: 0 };
		zoom = 1;
	}

	async function handleFilePicked(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		// Reset the input straight away so picking the SAME file again after cancelling still fires
		// a change event — a file input compares against its own current value and stays silent
		// otherwise, which reads as the button being broken.
		input.value = '';
		if (!file) return;

		error = '';
		// `file.type` is the browser's own guess, derived almost entirely from the FILENAME — a
		// Windows executable renamed to `.png` is reported as `image/png` here, confirmed by a real
		// browser run against exactly that file. So this check catches an honest mistake (picking a
		// .zip) and nothing more; it is deliberately not the real one.
		if (!ACCEPTED_TYPES.includes(file.type)) {
			error = m.settings_avatarErrorType(); // "That file is not a PNG, JPEG, or WebP image."
			return;
		}
		if (file.size > MAX_UPLOAD_BYTES) {
			error = m.settings_avatarErrorSize(); // "That image is larger than 5 MB."
			return;
		}

		if (sourceUrl) URL.revokeObjectURL(sourceUrl);
		const candidate = URL.createObjectURL(file);

		// The real client-side check: actually decode it. The browser's own image decoder answers
		// "is this genuinely a PNG/JPEG/WebP?" from the bytes rather than the name, which is the same
		// question the backend's libmagic sniff asks and `file.type` above cannot. Without this, a
		// disguised binary sails past the checks above and opens an EMPTY cropper — the user then
		// drags an invisible selection around and only learns anything is wrong when Save fails.
		// Found by a real browser run, not reasoned about in advance.
		try {
			const probe = new Image();
			probe.src = candidate;
			await probe.decode();
		} catch {
			URL.revokeObjectURL(candidate);
			error = m.settings_avatarErrorType(); // "That file is not a PNG, JPEG, or WebP image."
			return;
		}

		sourceUrl = candidate;
	}

	/** Renders the user's chosen region onto a 512x512 canvas and hands back a WebP blob.
	 *
	 * `croppedAreaPixels` is already in the source image's own natural pixel coordinates, so this is
	 * a single `drawImage` with an explicit source rectangle — no manual zoom/pan arithmetic, which
	 * is precisely the part the cropper library is here to get right. */
	async function renderCrop(area: CropArea): Promise<Blob> {
		const image = new Image();
		image.src = sourceUrl!;
		await image.decode();

		const canvas = document.createElement('canvas');
		canvas.width = OUTPUT_SIZE;
		canvas.height = OUTPUT_SIZE;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('canvas-unavailable');
		// The source region can be smaller than 512 (a small photo, or a deep zoom), in which case
		// this upscales. That's the honest outcome of what the user selected — the alternative,
		// silently refusing to zoom past 1:1, would be a worse and more confusing constraint.
		ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

		return new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(blob) => (blob ? resolve(blob) : reject(new Error('encode-failed'))),
				'image/webp',
				0.92
			);
		});
	}

	async function handleSave() {
		if (!croppedAreaPixels || busy) return;
		busy = true;
		error = '';
		try {
			const blob = await renderCrop(croppedAreaPixels);
			const result = await authStore.uploadAvatar(blob);
			if (result.ok) {
				closeEditor();
			} else {
				error = m.settings_avatarErrorUpload(); // "Could not upload that image. Please try again."
			}
		} catch {
			error = m.settings_avatarErrorUpload(); // "Could not upload that image. Please try again."
		} finally {
			busy = false;
		}
	}

	async function handleRemove() {
		if (busy) return;
		busy = true;
		error = '';
		const result = await authStore.removeAvatar();
		if (!result.ok) error = m.settings_avatarErrorUpload(); // "Could not upload that image. Please try again."
		busy = false;
	}
</script>

<div class="avatar-editor">
	<div class="avatar-editor__current">
		{#if avatarUrl}
			<img class="avatar-preview" src={avatarUrl} alt={m.settings_avatarAlt()} />
		{:else}
			<!-- No avatar set: a plain neutral placeholder, not a generated identicon — this app has
			     never had one, and inventing a second visual identity for an account here would be a
			     bigger decision than this feature's own scope. -->
			<div class="avatar-preview avatar-preview--empty" aria-hidden="true">?</div>
		{/if}
		<div class="avatar-editor__actions">
			<p class="hint">{m.settings_avatarHint()}</p>
			<div class="button-row">
				<button type="button" class="secondary" onclick={() => fileInput?.click()}>
					{avatarUrl ? m.settings_avatarChange() : m.settings_avatarUpload()}
				</button>
				{#if avatarUrl}
					<button type="button" class="danger" onclick={handleRemove} disabled={busy}>
						{m.settings_avatarRemove()}
					</button>
				{/if}
			</div>
		</div>
	</div>

	<!-- `accept` is a file-picker convenience only — it filters the OS dialog, and is trivially
	     bypassed by choosing "All files". The real checks are in handleFilePicked and, definitively,
	     on the server. -->
	<input
		bind:this={fileInput}
		type="file"
		accept="image/png,image/jpeg,image/webp"
		class="visually-hidden-input"
		onchange={handleFilePicked}
	/>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	{#if sourceUrl}
		<div class="crop-panel">
			<h3 class="crop-panel__heading">{m.settings_avatarCropHeading()}</h3>
			<div class="crop-panel__stage">
				<Cropper
					image={sourceUrl}
					bind:crop
					bind:zoom
					aspect={1}
					cropShape="round"
					showGrid={false}
					oncropcomplete={(e) => (croppedAreaPixels = e.pixels)}
				/>
			</div>
			<label class="zoom-control">
				<span>{m.settings_avatarZoom()}</span>
				<input type="range" min="1" max="4" step="0.01" bind:value={zoom} />
			</label>
			<div class="button-row">
				<button type="button" class="primary" onclick={handleSave} disabled={busy}>
					{busy ? m.common_loading() : m.settings_avatarSave()}
				</button>
				<button type="button" class="secondary" onclick={closeEditor} disabled={busy}>
					{m.common_cancel()}
				</button>
			</div>
		</div>
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.avatar-editor {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.avatar-editor__current {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	.avatar-preview {
		width: 96px;
		height: 96px;
		border-radius: 50%;
		object-fit: cover;
		border: 1px solid var(--border-color);
		flex-shrink: 0;
		// A transparent avatar (the backend deliberately preserves alpha rather than flattening onto
		// white, so a logo-style PNG survives intact) needs a surface behind it that follows the
		// theme, not a hardcoded colour that would be wrong in one of the two.
		background: var(--bg-surface);
	}
	.avatar-preview--empty {
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: var(--font-size-xl);
		color: var(--text-secondary);
	}
	.avatar-editor__actions {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.hint {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		margin: 0;
	}
	.button-row {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	button {
		@include mix.focus-ring;
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-color);
		font-size: var(--font-size-sm);
		cursor: pointer;
		&:disabled {
			opacity: 0.6;
			cursor: not-allowed;
		}
	}
	.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-contrast);
	}
	.secondary {
		background: var(--bg-page);
		color: var(--text-primary);
	}
	.danger {
		background: var(--bg-page);
		color: var(--status-danger);
		border-color: var(--status-danger);
	}
	// Not `display: none` — a hidden-but-focusable input is what lets the styled button above stand
	// in for the browser's own unstyleable file control while keeping real keyboard access to it.
	.visually-hidden-input {
		@include mix.visually-hidden;
	}
	.error {
		color: var(--status-danger);
		font-size: var(--font-size-sm);
		margin: 0;
	}
	.crop-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
	}
	.crop-panel__heading {
		margin: 0;
		font-size: var(--font-size-base);
	}
	// The cropper positions itself absolutely inside its container, so it needs a real, explicit
	// height to occupy — it collapses to nothing otherwise.
	.crop-panel__stage {
		position: relative;
		width: 100%;
		height: 320px;
		background: var(--bg-page);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}
	.zoom-control {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		input {
			flex: 1;
			min-width: 0;
		}
	}
</style>
