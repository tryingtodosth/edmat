<script lang="ts">
	/**
	 * Ketcher (Apache 2.0, EPAM) mounted inside this Svelte app. Ketcher ships as a React
	 * component, so React, ReactDOM, `ketcher-react` and the standalone Indigo WASM service are
	 * all imported lazily HERE, on mount — a reader never downloads any of them (the KaTeX /
	 * Leaflet / Tiptap discipline), and React exists in this app only inside this one host.
	 *
	 * The result is vector: `generateImage(…, {outputFormat: 'svg'})` renders through Indigo in
	 * the browser, and the server keeps the SVG after sanitizing it (chem/svg.py). The source is
	 * KET, Ketcher's own JSON, which `setMolecule` reopens losslessly.
	 */
	import { onDestroy, onMount } from 'svelte';
	import type { Ketcher } from 'ketcher-core';
	import type { Root } from 'react-dom/client';
	import { m } from '$lib/paraglide/messages.js';
	import type { ChemDrawingDraft } from '$lib/types/chem';

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
	let ketcher: Ketcher | null = null;
	let root: Root | null = null;

	onMount(async () => {
		if (!host) return;
		try {
			// Ketcher's bundles read two Node globals at module-evaluation time — `process.env`
			// and `global` — which a browser does not have; each surfaced as `… is not defined`
			// under Vite's dev server (found by a browser run, not by the build, which passes
			// silently). Minimal shims, set right before the lazy imports below evaluate; nothing
			// else in this app touches them. `events`/`assert` are aliased in vite.config.ts.
			// (`Record<string, unknown>` rather than a typed `process`: with @types/node in scope,
			// TypeScript types `globalThis.process` as Node's full `Process`, which a two-key shim is
			// not, and this is a runtime placeholder, not a claim to be Node.)
			const g = globalThis as unknown as Record<string, unknown>;
			g.process ??= { env: { NODE_ENV: import.meta.env.PROD ? 'production' : 'development' } };
			g.global ??= globalThis;
			const [{ createElement }, { createRoot }, { Editor }, { StandaloneStructServiceProvider }] =
				await Promise.all([
					import('react'),
					import('react-dom/client'),
					import('ketcher-react'),
					import('ketcher-standalone'),
					import('ketcher-react/dist/index.css')
				]);
			root = createRoot(host);
			root.render(
				createElement(Editor, {
					staticResourcesUrl: '',
					structServiceProvider: new StandaloneStructServiceProvider(),
					errorHandler: (message: string) => onError?.(message),
					disableMacromoleculesEditor: true,
					onInit: async (k: Ketcher) => {
						ketcher = k;
						// Ketcher's own convention (its standalone build and parts of ketcher-react read
						// `window.ketcher`); it is also what a browser check drives the editor through.
						(window as Window & { ketcher?: Ketcher }).ketcher = k;
						try {
							if (initialSource) await k.setMolecule(initialSource);
						} catch (e) {
							onError?.(e instanceof Error ? e.message : String(e));
						}
						ready = true;
						onReady?.();
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
		ketcher = null;
	});

	function isEmptyKet(ket: string): boolean {
		try {
			const parsed = JSON.parse(ket) as { root?: { nodes?: unknown[] } };
			return (parsed.root?.nodes?.length ?? 0) === 0;
		} catch {
			return false;
		}
	}

	/** Reactions: an open-angle reaction arrow appended to whatever is drawn, as a KET `arrow`
	 * node — the same thing the toolbar's arrow tool draws, one click instead of a tool hunt.
	 * Ketcher also reads reaction SMILES (`CCO>>C=C`) straight into `setMolecule`. */
	export async function addReactionArrow() {
		if (!ketcher) return;
		const ket = JSON.parse(await ketcher.getKet()) as {
			root: { nodes: Array<Record<string, unknown>> };
		};
		// Placed to the right of everything drawn, at the drawing's own vertical centre. KET
		// positions are Ångström-ish units with y pointing up; an arrow dropped at y=0 while the
		// reaction sat elsewhere once stretched the exported SVG's bounding box into a mostly
		// blank picture (seen in a screenshot, not by any assertion).
		const xs: number[] = [];
		const ys: number[] = [];
		for (const key of Object.keys(ket)) {
			const mol = (ket as Record<string, unknown>)[key] as { atoms?: { location?: number[] }[] };
			for (const a of mol?.atoms ?? []) {
				if (a.location) {
					xs.push(a.location[0]);
					ys.push(a.location[1]);
				}
			}
		}
		const x = xs.length ? Math.max(...xs) + 1.5 : 0;
		const y = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
		ket.root.nodes.push({
			type: 'arrow',
			data: {
				mode: 'open-angle',
				pos: [
					{ x, y, z: 0 },
					{ x: x + 2.5, y, z: 0 }
				]
			}
		});
		await ketcher.setMolecule(JSON.stringify(ket));
	}

	export function isReady(): boolean {
		return ready;
	}

	export async function getResult(): Promise<ChemDrawingDraft & { empty: boolean }> {
		if (!ketcher) throw new Error(m.chem_loadFailed());
		const ket = await ketcher.getKet();
		const empty = isEmptyKet(ket);
		const label = await ketcher.getSmiles().catch(() => '');
		const blob = await ketcher.generateImage(ket, { outputFormat: 'svg' });
		return { sourceFormat: 'ket', source: ket, label, image: await blob.text(), empty };
	}
</script>

<div class="ketcher-host">
	{#if !ready && !failed}<p class="ketcher-host__status">{m.chem_loading()}</p>{/if}
	{#if failed}<p class="ketcher-host__status">{m.chem_loadFailed()}</p>{/if}
	<div class="ketcher-host__mount" bind:this={host}></div>
</div>

<style lang="scss">
	.ketcher-host {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 480px;
		background: #fff;
		border-radius: 6px;
		overflow: hidden;
	}
	.ketcher-host__mount {
		position: absolute;
		inset: 0;
	}
	.ketcher-host__status {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		margin: 0;
		color: var(--text-secondary);
		pointer-events: none;
	}
</style>
