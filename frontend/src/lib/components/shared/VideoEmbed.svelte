<script lang="ts">
	// One YouTube/Vimeo video as a click-to-play box, for a place that holds a bare address rather
	// than content — a link-only material whose link is a video. Inside content the same box comes
	// out of `renderContent.ts` as HTML; this draws the identical markup (the styles are global, in
	// `global.scss`) so the two can never look different. Nothing loads from the provider until the
	// click — `lib/utils/videoEmbed.ts` says why.
	import { m } from '$lib/paraglide/messages.js';
	import {
		PLAYER_ALLOW,
		PLAYER_HOSTS,
		PLAYER_REFERRER_POLICY,
		PROVIDER_NAMES,
		playerSrc,
		watchUrl,
		type VideoRef
	} from '$lib/utils/videoEmbed';

	let { video }: { video: VideoRef } = $props();
	let playing = $state(false);
	let provider = $derived(PROVIDER_NAMES[video.provider]);
	let src = $derived(playerSrc(video));
</script>

{#if src}
	<div class="video-embed" class:video-embed--playing={playing}>
		<div class="video-embed__frame">
			{#if playing}
				<iframe
					{src}
					title={m.video_frameTitle({ provider })}
					allow={PLAYER_ALLOW}
					allowfullscreen
					referrerpolicy={PLAYER_REFERRER_POLICY}
				></iframe>
			{:else}
				<button type="button" class="video-embed__play" onclick={() => (playing = true)}>
					{m.video_play({ provider })}
					<!-- "Play the {provider} video" -->
				</button>
			{/if}
		</div>
		<p class="video-embed__note">
			{m.video_note({ provider, host: PLAYER_HOSTS[video.provider] })}
			<!-- "Playing it loads {provider}'s player from {host}, which then sees your IP address." -->
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the provider's own page, not an app route -->
			<a href={watchUrl(video)} target="_blank" rel="noopener noreferrer nofollow">
				{m.video_open({ provider })}
				<!-- "Open on {provider}" -->
			</a>
		</p>
	</div>
{/if}
