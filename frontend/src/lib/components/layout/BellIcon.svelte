<!-- One outline bell, drawn once (2026-10-07 colour pass). NotificationBell in the bar and the
     drawer's "Notifications" link both render it, so the path lives here and nowhere else. It
     inherits currentColor like every other icon in the chrome and carries no colour of its own —
     the count badge beside it is what says something is waiting, not the bell. -->
<svg
	class="bell-icon"
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2H4.5z" />
	<path d="M10 20.5a2 2 0 0 0 4 0" />
	<path d="M12 3v2" />
</svg>

<style lang="scss">
	.bell-icon {
		display: block;
		width: 18px;
		height: 18px;
		flex: none;
	}
</style>
