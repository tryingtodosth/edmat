<script lang="ts">
	/**
	 * The `/about` reel (owner, 2026-11-02: "have these animations on about"): the edmat.net promo
	 * video, drawn LIVE in the page rather than shipped as a 22 MB WebM. Every frame shows real
	 * EdMat. Two or three phones play phone-sized captures of the real app, each scrolling through
	 * its page, with the caption drawn ON TOP of them and edmat.net in the top-left corner.
	 *
	 * It is the same scene list and the same arithmetic as the local promo kit (`promo/promo.html`,
	 * gitignored; `promo/capture.mjs` takes the captures and `promo/web-assets.py` turns them into
	 * `static/promo/<lang>/<shot>.webp`, 585 px wide, cropped to the deepest scroll the reel
	 * reaches). There it renders one frame per `t` for ffmpeg. Here `t` comes from
	 * requestAnimationFrame.
	 *
	 * - **The captions are message keys** (house rule 1), and the captures follow the interface
	 *   language. A Polish reader watches the Polish site and an English one the English site.
	 * - **A killed feature is not advertised** (house rule 3): the flashcards and tutoring scenes go
	 *   with their switches, and a concept page leaves any scene it was in. The timeline is rebuilt
	 *   from whatever scenes remain. `|| isModerator` matches the feature grid on the same page.
	 * - **Motion obeys the reader.** It never autoplays under `prefers-reduced-motion`. It always
	 *   has a pause button (WCAG 2.2.2, for moving content that lasts more than five seconds). It
	 *   stops whenever it is scrolled out of view or the tab is hidden.
	 * - **Nothing is downloaded before it is near the screen** (house rule 11's spirit), and then
	 *   only the current scene and the next one, about 200 KB at a time.
	 *
	 * The stage is a fixed canvas, 1920×1080 or 1000×1250 on a narrow column, scaled to the
	 * column's width, so the layout is the video's own at every size. The narrow canvas holds
	 * two phones, so a three-phone scene shows its first two.
	 */
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import type { FeatureFlagKey } from '$lib/types';

	type Shot =
		| 'home'
		| 'ex-q'
		| 'ex-a'
		| 'concept'
		| 'concepts'
		| 'branch'
		| 'search'
		| 'fc-q'
		| 'fc-a'
		| 'tutoring'
		| 'listing';

	/** Page height of each capture as cropped, in CSS px (the same in both languages). */
	const SHOT_H: Record<Shot, number> = {
		home: 1744,
		'ex-q': 1024,
		concept: 1144,
		'ex-a': 2144,
		branch: 1544,
		search: 1444,
		concepts: 1264,
		'fc-q': 844,
		'fc-a': 964,
		tutoring: 1224,
		listing: 1174
	};
	/** The app's own sticky header at 390 px, kept still over the scrolling page. */
	const HDR = 43;
	/** The captures that ARE a concept page, which leave the reel with the `concepts` switch. */
	const SHOT_FLAG: Partial<Record<Shot, FeatureFlagKey>> = {
		concept: 'concepts',
		concepts: 'concepts'
	};

	interface Phone {
		shot: Shot;
		/** The path after `edmat.net/` in the drawn address bar. */
		url: string;
		/** The page scroll, CSS px, at the start and the end of the scene. */
		pan: [number, number];
	}
	interface Caption {
		kicker?: string;
		head: string;
		body?: string;
		pillars?: string[];
	}
	interface Scene {
		len: number;
		flag?: FeatureFlagKey;
		phones: Phone[];
		caption: Caption;
	}

	const lang = $derived(getLocale() === 'en' ? 'en' : 'pl');
	const tut = $derived(lang === 'pl' ? 'korki' : 'tutoring');

	const ALL: Scene[] = $derived([
		{
			len: 5.6,
			phones: [
				{ shot: 'home', url: '', pan: [0, 420] },
				{ shot: 'ex-q', url: 'exercises/50', pan: [0, 180] },
				{ shot: 'concept', url: 'concepts/calka', pan: [0, 260] }
			],
			caption: { head: m.promo_s1_head(), body: m.promo_s1_body() }
			// "Learn, practise, and ask — at any age." / "An open bank of exercises and materials, built by a community."
		},
		{
			len: 6,
			phones: [
				{ shot: 'ex-q', url: 'exercises/50', pan: [0, 120] },
				{ shot: 'ex-a', url: 'exercises/50', pan: [240, 1300] }
			],
			caption: { kicker: m.promo_s2_kicker(), head: m.promo_s2_head(), body: m.promo_s2_body() }
			// "Exercises" / "Hundreds of exercises, solved step by step" / "Statement, hint, answer, solution — with properly typeset maths."
		},
		{
			len: 5.6,
			phones: [
				{ shot: 'branch', url: 'branches/analiza-matematyczna', pan: [0, 700] },
				{ shot: 'search', url: 'search?q=całka', pan: [0, 600] },
				{ shot: 'concepts', url: 'concepts', pan: [0, 420] }
			],
			caption: { kicker: m.promo_s3_kicker(), head: m.promo_s3_head(), body: m.promo_s3_body() }
			// "Search" / "By subject, by keyword, by concept" / "Browse topics, search for formulas and terms, learn from concepts."
		},
		{
			len: 5.4,
			flag: 'flashcards',
			phones: [
				{ shot: 'fc-q', url: 'flashcards/2/review', pan: [0, 0] },
				{ shot: 'fc-a', url: 'flashcards/2/review', pan: [0, 120] }
			],
			caption: { kicker: m.promo_s4_kicker(), head: m.promo_s4_head(), body: m.promo_s4_body() }
			// "Flashcards" / "Turn exercises into flashcards" / "Spaced repetition tells you what to review today."
		},
		{
			len: 5.6,
			flag: 'tutoring',
			phones: [
				{ shot: 'tutoring', url: tut, pan: [0, 380] },
				{ shot: 'listing', url: `${tut}/7`, pan: [0, 330] }
			],
			caption: { kicker: m.promo_s5_kicker(), head: m.promo_s5_head(), body: m.promo_s5_body() }
			// "Tutoring" / "Find a tutor — or become one" / "Online or in person, with real booking."
		},
		{
			len: 7.8,
			phones: [
				{ shot: 'concept', url: 'concepts/calka', pan: [0, 300] },
				{ shot: 'home', url: '', pan: [380, 900] },
				{ shot: 'ex-a', url: 'exercises/50', pan: [500, 1100] }
			],
			caption: {
				head: m.promo_s6_head(),
				pillars: [m.promo_pillar_free(), m.promo_pillar_open(), m.promo_pillar_community()]
			}
			// "EdMat — free, open, built by a community" / "Free to use" / "Open to everyone" / "Built by a community"
		}
	]);

	function on(flag: FeatureFlagKey | undefined): boolean {
		return !flag || featureFlagsStore.isEnabled(flag) || authStore.isModerator;
	}

	let width = $state(1100);
	const narrow = $derived(width < 640);
	const STAGE = $derived(narrow ? { w: 1000, h: 1250 } : { w: 1920, h: 1080 });
	const scale = $derived(width / STAGE.w);

	/** The scenes this reader is shown, with each one's start on the loop. */
	const scenes = $derived.by(() => {
		let at = 0;
		const out: (Scene & { at: number })[] = [];
		for (const sc of ALL) {
			if (!on(sc.flag)) continue;
			const phones = sc.phones.filter((p) => on(SHOT_FLAG[p.shot])).slice(0, narrow ? 2 : 3);
			if (phones.length === 0) continue;
			out.push({ ...sc, phones, at });
			at += sc.len;
		}
		return out;
	});
	const total = $derived(scenes.reduce((s, sc) => s + sc.len, 0));

	const FADE = 0.7;
	const PHONE_W = 414;
	const GAP: Record<number, number> = { 1: 0, 2: 120, 3: 76 };
	const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
	const ease = (x: number) => {
		x = clamp(x);
		return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
	};
	const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x), 3);

	/** Seconds since the reel first started; it loops, so the scene is `t mod total`. */
	let t = $state(1.3);
	/** The reader pressed pause (as against the reel being off screen or the tab hidden). */
	let userPaused = $state(false);
	let visible = $state(false);
	let near = $state(false);
	// Before the flag list arrives every switch reads as on, so a capture of a killed feature would
	// be fetched and shown for a moment. Wait for the list, or three seconds if the API is down
	// (the reel then shows everything, as the rest of the page fails open too).
	let flagsTimedOut = $state(false);
	const fetchable = $derived(near && (featureFlagsStore.isLoaded || flagsTimedOut));
	let reduced = $state(false);
	const playing = $derived(visible && !userPaused && !reduced);

	const index = $derived.by(() => {
		const lt = ((t % total) + total) % total;
		let k = 0;
		for (let i = 0; i < scenes.length; i++) if (scenes[i].at <= lt) k = i;
		return k;
	});
	const local = $derived((((t % total) + total) % total) - (scenes[index]?.at ?? 0));
	/** The scene sliding out while this one slides in; none on the very first play. */
	const leaving = $derived(
		local < FADE && t >= FADE && scenes.length > 1
			? (index - 1 + scenes.length) % scenes.length
			: null
	);

	interface Drawn {
		i: number;
		x: number;
		lt: number;
		first: boolean;
	}
	const drawn = $derived.by((): Drawn[] => {
		if (!scenes.length) return [];
		const push = ease(local / FADE);
		const list: Drawn[] = [];
		if (leaving !== null) {
			list.push({ i: leaving, x: -push * STAGE.w, lt: scenes[leaving].len + local, first: false });
			list.push({ i: index, x: (1 - push) * STAGE.w, lt: local, first: false });
		} else list.push({ i: index, x: 0, lt: local, first: t < scenes[0].len });
		return list;
	});

	function phoneLeft(n: number, j: number): number {
		const all = n * PHONE_W + (n - 1) * GAP[n];
		return (STAGE.w - all) / 2 + j * (PHONE_W + GAP[n]);
	}
	function scroll(sc: Scene, j: number, lt: number): number {
		const p = sc.phones[j];
		const max = Math.max(0, SHOT_H[p.shot] - 844);
		const k = ease((lt - 0.7 - j * 0.25) / (sc.len + FADE - 1.6));
		return Math.min(max, p.pan[0] + (p.pan[1] - p.pan[0]) * k);
	}
	function captionIn(lt: number, first: boolean): number {
		return easeOut((lt - (first ? 0.4 : FADE + 0.1)) / 0.6);
	}
	const src = (shot: Shot) => `/promo/${lang}/${shot}.webp`;

	// Fetch the next scene's captures while this one plays, so a push never reveals a blank phone.
	$effect(() => {
		if (!fetchable || scenes.length < 2) return;
		const next = scenes[(index + 1) % scenes.length];
		for (const p of next.phones) new Image().src = src(p.shot);
	});

	let host: HTMLElement | undefined = $state();
	onMount(() => {
		const motion = matchMedia('(prefers-reduced-motion: reduce)');
		reduced = motion.matches;
		userPaused = reduced;
		const onMotion = () => {
			reduced = motion.matches;
			if (reduced) userPaused = true;
		};
		motion.addEventListener('change', onMotion);

		// Two questions, two observers: is it close enough to start downloading, and is enough of
		// it on screen to be worth playing.
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) near = true;
			},
			{ rootMargin: '300px 0px' }
		);
		const seen = new IntersectionObserver(
			(entries) => {
				for (const e of entries) visible = e.isIntersecting;
			},
			{ threshold: 0.35 }
		);
		if (host) {
			io.observe(host);
			seen.observe(host);
		}

		const flagTimer = setTimeout(() => (flagsTimedOut = true), 3000);
		let raf = 0;
		let last = 0;
		const frame = (now: number) => {
			const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
			last = now;
			if (playing) t += dt;
			raf = requestAnimationFrame(frame);
		};
		raf = requestAnimationFrame(frame);
		const onHidden = () => (last = 0);
		document.addEventListener('visibilitychange', onHidden);
		return () => {
			cancelAnimationFrame(raf);
			clearTimeout(flagTimer);
			io.disconnect();
			seen.disconnect();
			motion.removeEventListener('change', onMotion);
			document.removeEventListener('visibilitychange', onHidden);
		};
	});

	// Autoplay starts from the top: the still drawn before the reel plays is scene 1 with its caption
	// up, so play rewinds to 0 the first time and the caption rises with the phones, as in the video.
	let started = false;
	$effect(() => {
		if (playing && !started) {
			started = true;
			t = 0;
		}
	});

	function toggle() {
		if (reduced && userPaused) reduced = false;
		userPaused = !userPaused;
	}
	function jump(k: number) {
		started = true;
		// A jump lands where the scene is fully in and its caption is up.
		t = Math.floor(t / total) * total + scenes[k].at + FADE + 0.8 + (k === 0 ? total : 0);
	}
</script>

<figure class="reel" bind:this={host} aria-label={m.promo_label()}>
	<!-- "EdMat in half a minute: real pages, played on phones" -->
	<div class="reel__frame" bind:clientWidth={width} style:aspect-ratio="{STAGE.w} / {STAGE.h}">
		<div
			class="reel__stage"
			class:reel__stage--narrow={narrow}
			style:width="{STAGE.w}px"
			style:height="{STAGE.h}px"
			style:transform="scale({scale})"
		>
			<div
				class="reel__bg"
				style:--gx="{28 + 18 * Math.sin(t / 6)}%"
				style:--gy="{38 + 10 * Math.cos(t / 5)}%"
				aria-hidden="true"
			></div>
			<div class="reel__brand" aria-hidden="true">
				<span class="reel__tile">∫</span><span class="reel__name">edmat.net</span>
			</div>

			{#each drawn as d (d.i)}
				{@const sc = scenes[d.i]}
				{@const cin = captionIn(d.lt, d.first)}
				<section class="reel__scene" style:transform="translateX({d.x}px)">
					{#each sc.phones as p, j (p.shot + j)}
						<div
							class="reel__phone"
							style:left="{phoneLeft(sc.phones.length, j)}px"
							aria-hidden="true"
						>
							<div class="reel__screen">
								<div class="reel__bar">
									<span class="reel__url"><span>edmat.net/{p.url}</span></span>
								</div>
								<div class="reel__vp">
									{#if fetchable}
										<img
											class="reel__page"
											src={src(p.shot)}
											alt=""
											style:transform="translateY({-scroll(sc, j, d.lt)}px)"
										/>
										<div class="reel__hdr" style:height="{HDR}px">
											<img src={src(p.shot)} alt="" />
										</div>
									{/if}
								</div>
							</div>
						</div>
					{/each}
					<div
						class="reel__cap"
						style:opacity={cin}
						style:transform="translateX(-50%) translateY({(1 - cin) * 30}px)"
					>
						{#if sc.caption.kicker}<p class="reel__kicker">{sc.caption.kicker}</p>{/if}
						<!-- The closing scene's head is only its name for the scene dots; the pillars say it. -->
						{#if !sc.caption.pillars}<p class="reel__head">{sc.caption.head}</p>{/if}
						{#if sc.caption.body}<p class="reel__body">{sc.caption.body}</p>{/if}
						{#if sc.caption.pillars}
							{@const pc = easeOut((d.lt - 1.4) / 0.7)}
							<p class="reel__pillars">
								{#each sc.caption.pillars as pillar (pillar)}<span>{pillar}</span>{/each}
							</p>
							<p
								class="reel__cta"
								style:opacity={pc}
								style:transform="scale({0.85 +
									0.15 * pc +
									0.01 * Math.sin(Math.max(0, d.lt - 2.2) * 3)})"
							>
								edmat.net
							</p>
						{/if}
					</div>
				</section>
			{/each}
		</div>
	</div>

	<div class="reel__controls">
		<button
			type="button"
			class="reel__play"
			onclick={toggle}
			aria-label={playing ? m.promo_pause() : m.promo_play()}
			title={playing ? m.promo_pause() : m.promo_play()}
		>
			<!-- "Pause" / "Play" -->
			{#if playing}
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2h3v12H4zM9 2h3v12H9z" /></svg>
			{:else}
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2l10 6-10 6z" /></svg>
			{/if}
		</button>
		{#each scenes as sc, k (sc.at)}
			<button
				type="button"
				class="reel__dot"
				class:reel__dot--on={k === index}
				onclick={() => jump(k)}
				aria-label={m.promo_goTo({ n: k + 1, title: sc.caption.kicker ?? sc.caption.head })}
				aria-current={k === index ? 'step' : undefined}
			></button>
			<!-- "Scene {n}: {title}" -->
		{/each}
	</div>
</figure>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.reel {
		margin: 0;
	}
	.reel__frame {
		position: relative;
		width: 100%;
		overflow: hidden;
		border-radius: var(--radius-lg, 16px);
		border: 1px solid var(--border-color);
		box-shadow: 0 18px 50px rgba(26, 28, 38, 0.12);
		background: #f3f4f8;
	}

	// The stage is the video's own canvas and its own palette. It stays light in the dark theme,
	// because it is a picture of the light site, the same as the screenshots in the manual.
	.reel__stage {
		position: absolute;
		left: 0;
		top: 0;
		transform-origin: 0 0;
		overflow: hidden;
		font-family: 'Noto Sans', 'DejaVu Sans', system-ui, sans-serif;
		color: #1a1c26;
		p {
			margin: 0;
		}
	}
	.reel__bg {
		position: absolute;
		inset: 0;
		background:
			radial-gradient(
				ellipse 1000px 700px at var(--gx, 30%) var(--gy, 40%),
				#d6ecec 0%,
				rgba(214, 236, 236, 0) 70%
			),
			radial-gradient(
				ellipse 800px 600px at calc(100% - var(--gx, 30%)) 85%,
				#e8e2f6 0%,
				rgba(232, 226, 246, 0) 70%
			),
			#f3f4f8;
	}
	.reel__brand {
		position: absolute;
		left: 52px;
		top: 40px;
		display: flex;
		align-items: center;
		gap: 16px;
		z-index: 50;
	}
	.reel__tile {
		width: 58px;
		height: 58px;
		border-radius: 14px;
		background: #2a6f6f;
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: Georgia, 'DejaVu Serif', serif;
		font-size: 40px;
		box-shadow: 0 8px 20px rgba(42, 111, 111, 0.25);
	}
	.reel__name {
		font-size: 38px;
		font-weight: 800;
		letter-spacing: -0.5px;
	}

	.reel__scene {
		position: absolute;
		inset: 0;
		will-change: transform;
	}
	.reel__phone {
		position: absolute;
		top: 124px;
		width: 414px;
		height: 928px;
		border-radius: 58px;
		background: #15171d;
		padding: 12px;
		box-shadow:
			0 36px 80px rgba(26, 28, 38, 0.28),
			inset 0 0 0 2px #2a2d36;
	}
	.reel__screen {
		position: relative;
		width: 390px;
		height: 904px;
		border-radius: 47px;
		overflow: hidden;
		background: #f7f7fb;
	}
	.reel__bar {
		position: absolute;
		inset: 0 0 auto;
		height: 60px;
		background: #fff;
		border-bottom: 1px solid #e3e5ec;
		z-index: 3;
		display: flex;
		align-items: flex-end;
		padding: 0 18px 9px;
	}
	.reel__url {
		flex: 1;
		height: 32px;
		border-radius: 16px;
		background: #eef0f4;
		font-size: 16px;
		color: #3d4152;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		span {
			max-width: 300px;
			overflow: hidden;
			white-space: nowrap;
			text-overflow: ellipsis;
		}
		&::before {
			content: '';
			width: 9px;
			height: 11px;
			border: 2px solid #6b7083;
			border-radius: 2px;
		}
	}
	.reel__vp {
		position: absolute;
		top: 60px;
		left: 0;
		width: 390px;
		height: 844px;
		overflow: hidden;
		img {
			display: block;
			width: 390px;
			max-width: none;
		}
	}
	.reel__page {
		position: absolute;
		left: 0;
		top: 0;
		will-change: transform;
	}
	.reel__hdr {
		position: absolute;
		left: 0;
		top: 0;
		width: 390px;
		overflow: hidden;
		z-index: 2;
	}

	// The caption, drawn over the phones.
	.reel__cap {
		position: absolute;
		left: 50%;
		bottom: 64px;
		width: 1460px;
		padding: 36px 60px 40px;
		border-radius: 30px;
		background: rgba(17, 50, 50, 0.9);
		color: #fff;
		z-index: 20;
		text-align: center;
		box-shadow: 0 30px 70px rgba(10, 30, 30, 0.35);
	}
	.reel__kicker {
		font-size: 24px;
		font-weight: 700;
		letter-spacing: 5px;
		text-transform: uppercase;
		color: #8fe3e3;
		margin-bottom: 12px !important;
	}
	.reel__head {
		font-size: 62px;
		font-weight: 800;
		line-height: 1.1;
		letter-spacing: -1px;
	}
	.reel__body {
		margin-top: 14px !important;
		font-size: 30px;
		line-height: 1.4;
		color: #d5e9e9;
	}
	.reel__pillars {
		display: flex;
		justify-content: center;
		gap: 56px;
		margin-top: 18px !important;
		font-size: 36px;
		font-weight: 700;
		color: #8fe3e3;
	}
	.reel__cta {
		display: inline-block;
		margin-top: 24px !important;
		font-size: 104px;
		font-weight: 800;
		letter-spacing: -1.5px;
		color: #15393a;
		background: #fff;
		padding: 6px 60px 14px;
		border-radius: 26px;
	}

	// The narrow canvas: two phones and a caption written larger, so that it is still readable
	// when the whole stage is scaled down to a phone's column.
	.reel__stage--narrow {
		.reel__brand {
			left: 44px;
			top: 34px;
		}
		.reel__cap {
			width: 920px;
			bottom: 40px;
			padding: 34px 40px 38px;
		}
		.reel__kicker {
			font-size: 34px;
		}
		.reel__head {
			font-size: 72px;
		}
		.reel__body {
			font-size: 44px;
		}
		.reel__pillars {
			flex-direction: column;
			gap: 6px;
			font-size: 50px;
		}
		.reel__cta {
			font-size: 110px;
		}
	}

	// Under the picture rather than on it: on the stage they covered the caption at every width.
	.reel__controls {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 2px;
		margin-top: var(--space-2);
	}
	.reel__play {
		@include mix.focus-ring;
		width: 32px;
		height: 32px;
		border: 0;
		border-radius: 50%;
		margin-right: var(--space-2);
		background: var(--accent);
		color: var(--accent-contrast);
		display: grid;
		place-items: center;
		cursor: pointer;
		svg {
			width: 14px;
			height: 14px;
			fill: currentColor;
		}
	}
	// A 24 px target round each 8 px dot (WCAG 2.5.8).
	.reel__dot {
		@include mix.focus-ring;
		width: 24px;
		height: 24px;
		border: 0;
		padding: 0;
		background: transparent;
		cursor: pointer;
		display: grid;
		place-items: center;
		&::after {
			content: '';
			width: 8px;
			height: 8px;
			border-radius: 50%;
			background: var(--border-color);
		}
		&--on::after {
			background: var(--accent);
			width: 10px;
			height: 10px;
		}
	}
</style>
