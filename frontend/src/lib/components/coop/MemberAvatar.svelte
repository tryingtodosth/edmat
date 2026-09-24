<script lang="ts">
	// An initials circle with a hue that is a function of the account id — so the same person is
	// the same colour on every row, stack and tile without anybody uploading a picture. Ported from
	// 2donet's poster square (`/projects/layouts`), where the deterministic hue is what made a
	// grid of otherwise identical cards scannable. Decorative: the name is always beside it or in
	// its `title`, and a screen reader is given the name, not the letters.
	let {
		userId,
		displayName,
		size = 32
	}: { userId: string; displayName: string; size?: number } = $props();

	let hue = $derived.by(() => {
		let h = 0;
		for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) % 360;
		return h;
	});
	let initials = $derived(
		displayName
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? '')
			.join('') || '?'
	);
</script>

<span
	class="avatar"
	role="img"
	aria-label={displayName}
	title={displayName}
	style="--h: {hue}; --size: {size}px"
>
	<span aria-hidden="true">{initials}</span>
</span>

<style lang="scss">
	.avatar {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--size);
		height: var(--size);
		border-radius: 50%;
		background: hsl(var(--h) 45% 38%);
		color: #fff;
		font-size: calc(var(--size) * 0.38);
		font-weight: 600;
		letter-spacing: 0.02em;
		user-select: none;
	}
</style>
