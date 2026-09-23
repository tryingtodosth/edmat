<script lang="ts">
	/**
	 * Excalidraw (MIT — checked with `npm view @excalidraw/excalidraw license` before it was added,
	 * the same rule that kept tldraw out: its licence field says `SEE LICENSE IN LICENSE.md`)
	 * mounted inside this Svelte app. It ships as a React component, so React, ReactDOM and the
	 * editor itself are all imported lazily HERE, on mount — a reader never downloads any of them
	 * (the KaTeX / Leaflet / Ketcher discipline), and React exists in this app only inside this
	 * host and `chem/KetcherHost.svelte`.
	 *
	 * This is `KetcherHost.svelte` with a different editor in it, and the three things that host
	 * needed are the three things to know about here too:
	 *
	 * 1. **Node globals.** Ketcher reads `process.env` and `global` at module-evaluation time;
	 *    Excalidraw's prod bundle reads `process.env.NODE_ENV` in the same way. The same two-key
	 *    shims are set right before the lazy imports below, for the same reason, and are invisible
	 *    to the build — only a real browser run finds them.
	 * 2. **Fonts.** Excalidraw resolves its font files against `window.EXCALIDRAW_ASSET_PATH`, and
	 *    with that global unset falls back to `https://esm.sh/@excalidraw/excalidraw@…/fonts/…` — a
	 *    third-party request from the reader's browser. This app hot-links nothing (the content
	 *    sanitizer refuses an `<img>` that does), so the font files are copied into
	 *    `static/excalidraw/fonts/` and the global points there. Deliberately NOT copied: `Xiaolai`,
	 *    the CJK family, 13 MB against ~480 KB for the other eight — this interface is en + pl and
	 *    nothing here draws CJK. The honest limit is that the library appends its esm.sh URL as a
	 *    LAST fallback, so CJK text in a sketch would still reach for it; copying that one family
	 *    in beside the others is the fix if it ever matters.
	 * 3. **Pan and zoom are Excalidraw's own** — the infinite XY canvas, the scroll-to-zoom, the
	 *    space-drag, the zoom buttons. That is the whole reason a library was taken on rather than
	 *    `perfect-freehand` plus a hand-built viewport (the fallback the board note named).
	 *
	 * The result is a raster: `exportToBlob` renders the scene to PNG in the browser, and the
	 * server re-encodes it as WebP (`sketches/serializers.py`) — it never stores the bytes sent.
	 * The source is the scene JSON, which `restore()` reopens losslessly.
	 */
	import { onDestroy, onMount } from 'svelte';
	import type { Root } from 'react-dom/client';
	import { m } from '$lib/paraglide/messages.js';
	import type { SketchDraft } from '$lib/types/sketch';

	let {
		initialSource = '',
		onReady,
		onError
	}: {
		initialSource?: string;
		onReady?: () => void;
		onError?: (message: string) => void;
	} = $props();

	let host = $state<HTMLDivElement | null>(null);
	let ready = $state(false);
	let failed = $state(false);
	let root: Root | null = null;
	// The editor's imperative handle, and the two module functions used at save time. Kept as
	// plain variables (not `$state`) — nothing in the template reads them, and a Proxy around a
	// third-party API object is exactly the kind of thing that breaks in ways svelte-check cannot
	// see.
	let api: ExcalidrawApi | null = null;
	let exportToBlob: ExcalidrawModule['exportToBlob'] | null = null;

	type ExcalidrawModule = typeof import('@excalidraw/excalidraw');
	type ExcalidrawApi = {
		getSceneElements: () => readonly object[];
		getAppState: () => Record<string, unknown>;
		getFiles: () => Record<string, unknown>;
	};

	onMount(async () => {
		if (!host) return;
		try {
			const g = globalThis as unknown as Record<string, unknown>;
			g.process ??= { env: { NODE_ENV: import.meta.env.PROD ? 'production' : 'development' } };
			g.global ??= globalThis;
			// Must be set BEFORE the library evaluates: the font faces are registered at module
			// load, and a face registered against the fallback URL is not re-pointed later.
			g.EXCALIDRAW_ASSET_PATH ??= '/excalidraw/';
			const [{ createElement }, { createRoot }, excalidraw] = await Promise.all([
				import('react'),
				import('react-dom/client'),
				import('@excalidraw/excalidraw'),
				import('@excalidraw/excalidraw/index.css')
			]);
			exportToBlob = excalidraw.exportToBlob;
			// A saved sketch reopens from its scene JSON. `restore` is the library's own
			// forward-compatibility pass: it fills in whatever a scene written by an older version
			// is missing, so a drawing made today still opens after the package is upgraded.
			let initialData: object | null = null;
			if (initialSource) {
				try {
					initialData = excalidraw.restore(JSON.parse(initialSource), null, null);
				} catch (e) {
					onError?.(e instanceof Error ? e.message : String(e));
				}
			}
			root = createRoot(host);
			root.render(
				createElement(excalidraw.Excalidraw, {
					initialData,
					// `excalidrawAPI` is how a non-React host gets at the scene; there is no other
					// way out of the component.
					excalidrawAPI: (a: ExcalidrawApi) => {
						api = a;
						// The library's own convention for an embedder, and what the browser check
						// drives the board through when it needs to look at the scene.
						(window as Window & { excalidrawAPI?: ExcalidrawApi }).excalidrawAPI = a;
						ready = true;
						onReady?.();
					},
					// The board is a picture being drawn for somebody else to read, so it is always
					// light: black strokes on white, the same reason a chem drawing sits on white
					// in the dark theme. The export below would otherwise carry a dark background
					// into a comment that may be read in either theme.
					theme: 'light',
					// Nothing here saves to a file, opens one, or shares a live room: the sketch is
					// stored by this app, through its own API.
					UIOptions: {
						canvasActions: { loadScene: false, saveToActiveFile: false, export: false }
					}
				})
			);
		} catch (e) {
			failed = true;
			onError?.(e instanceof Error ? e.message : String(e));
		}
	});

	onDestroy(() => {
		root?.unmount();
		root = null;
		api = null;
		delete (window as Window & { excalidrawAPI?: ExcalidrawApi }).excalidrawAPI;
	});

	export function isReady(): boolean {
		return ready;
	}

	export async function getResult(): Promise<SketchDraft & { empty: boolean }> {
		if (!api || !exportToBlob) throw new Error(m.sketch_loadFailed());
		const elements = api.getSceneElements();
		const appState = api.getAppState();
		const files = api.getFiles();
		// The scene as the library's own `serializeAsJSON` would write it, minus the parts of
		// `appState` that are this browser's view rather than the drawing (the scroll position, the
		// current tool, the selection). The server only checks that it is a bounded JSON object
		// with an `elements` array; `restore()` on the way back in fills in the rest.
		const source = JSON.stringify({
			type: 'excalidraw',
			version: 2,
			source: 'edmat',
			elements,
			appState: { viewBackgroundColor: appState.viewBackgroundColor ?? '#ffffff' },
			files
		});
		if (!elements.length) {
			return { source, label: '', image: '', empty: true };
		}
		const blob = await exportToBlob({
			elements,
			appState: { ...appState, exportBackground: true, exportWithDarkMode: false },
			files: files as never,
			mimeType: 'image/png',
			// Twice the drawn size, then capped to 1600px server-side: a stroke drawn at 400px wide
			// and shown at 400px on a 2x screen is visibly soft otherwise.
			exportPadding: 12,
			getDimensions: (width: number, height: number) => ({
				width: width * 2,
				height: height * 2,
				scale: 2
			})
		});
		const image = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(reader.error ?? new Error('read failed'));
			reader.readAsDataURL(blob);
		});
		return { source, label: '', image, empty: false };
	}
</script>

<div class="sketch-host">
	{#if !ready && !failed}<p class="sketch-host__status">{m.sketch_loading()}</p>{/if}
	<!-- "Loading the board…" -->
	{#if failed}<p class="sketch-host__status">{m.sketch_loadFailed()}</p>{/if}
	<!-- "The board could not load." -->
	<div class="sketch-host__mount" bind:this={host}></div>
</div>

<style lang="scss">
	.sketch-host {
		position: relative;
		width: 100%;
		height: 100%;
		background: #fff;
		overflow: hidden;
	}
	.sketch-host__mount {
		position: absolute;
		inset: 0;
	}
	.sketch-host__status {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		margin: 0;
		color: #555;
		pointer-events: none;
	}
	// Excalidraw draws its own toolbars into this subtree; they must sit above the canvas and
	// below nothing else in the overlay.
	.sketch-host :global(.excalidraw) {
		--zIndex-layerUI: 4;
	}
</style>
