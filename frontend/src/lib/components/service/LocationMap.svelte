<script lang="ts">
	// The one Leaflet/OpenStreetMap wrapper in this app. Two modes off one component, because the
	// read-only view and the picker differ only in whether the pin can move: `interactive={false}`
	// shows where a tutor teaches (listing card/detail), `interactive={true}` lets them place it
	// (LocationPicker, which wraps this and adds the address search).
	//
	// **Leaflet is imported dynamically inside `onMount`, deliberately.** It touches `window` and
	// `document` at module scope, so a top-level `import` would execute during SvelteKit's
	// server-side render and crash the render — and this project has already taken a Vite dev server
	// down exactly once by letting an unguarded call run during SSR (CLAUDE.md Section 17P, the
	// `/messages` 401). `onMount` never runs on the server, so the dynamic import inside it is the
	// pattern that actually holds rather than one that merely looks careful.
	// Leaflet's own stylesheet, as a side-effect import here rather than an `@use` in this
	// component's style block. Svelte scopes styles to the component's own markup, and Leaflet's
	// classes live on DOM it generates itself at runtime — so scoping strips them all, and
	// svelte-check reported ~170 "unused CSS selector" warnings for styles the map genuinely needs.
	// A script-level import is emitted by Vite as ordinary global CSS, which is what a third-party
	// widget stylesheet actually wants.
	//
	// (Worth knowing: the first version of this comment wrote the words "style block" as a literal
	// HTML tag. The Svelte preprocessor scans for that tag textually, matched it inside this comment,
	// and truncated the script element there — producing a baffling "script was left open" error
	// pointing at the closing style tag 25 lines below. Avoid writing element tags in comments here.)
	import 'leaflet/dist/leaflet.css';
	import { onMount } from 'svelte';
	import type { Map as LeafletMap, Marker } from 'leaflet';
	import { m } from '$lib/paraglide/messages.js';

	let {
		lat,
		lon,
		label = '',
		interactive = false,
		zoom = 15,
		onpick
	}: {
		lat: number | null;
		lon: number | null;
		label?: string;
		interactive?: boolean;
		zoom?: number;
		onpick?: (coords: { lat: number; lon: number }) => void;
	} = $props();

	// Warsaw — this is a University of Warsaw project, so an empty picker opening on the city the
	// overwhelming majority of listings will be in beats opening on the null island at 0,0.
	const FALLBACK: [number, number] = [52.2297, 21.0122];

	let container = $state<HTMLDivElement | null>(null);
	let map: LeafletMap | null = null;
	let marker: Marker | null = null;
	let leaflet: typeof import('leaflet') | null = null;
	let ready = $state(false);

	/** Leaflet's default marker icon is loaded from image files by relative URL, which every bundler
	 * rewrites — the single most common Leaflet-with-a-bundler breakage, showing up as a broken-image
	 * pin. Sidestepped entirely with a `divIcon`: pure markup and CSS, no asset to resolve, and it
	 * picks up this app's own theme tokens rather than shipping a foreign blue. */
	function pinIcon(L: typeof import('leaflet')) {
		return L.divIcon({
			className: 'edmat-pin',
			html: '<span class="edmat-pin__dot"></span>',
			iconSize: [22, 22],
			iconAnchor: [11, 11]
		});
	}

	function place(nextLat: number, nextLon: number) {
		if (!map || !leaflet) return;
		if (marker) {
			marker.setLatLng([nextLat, nextLon]);
		} else {
			marker = leaflet
				.marker([nextLat, nextLon], {
					icon: pinIcon(leaflet),
					draggable: interactive,
					keyboard: interactive
				})
				.addTo(map);
			if (interactive) {
				marker.on('dragend', () => {
					const p = marker!.getLatLng();
					onpick?.({ lat: p.lat, lon: p.lng });
				});
			}
		}
	}

	onMount(() => {
		let disposed = false;

		(async () => {
			const L = await import('leaflet');
			// `await` means the component can be destroyed before this resolves — a real possibility
			// on a page the user navigates away from quickly. Initialising a map into a detached
			// container throws.
			if (disposed || !container) return;
			leaflet = L;

			map = L.map(container, {
				center: [lat ?? FALLBACK[0], lon ?? FALLBACK[1]],
				zoom: lat != null ? zoom : 11,
				// A read-only map is a picture, not a toy: leaving scroll-zoom on means a reader
				// scrolling past a listing gets their page scroll swallowed by the map instead.
				scrollWheelZoom: interactive,
				dragging: interactive,
				zoomControl: interactive,
				doubleClickZoom: interactive,
				keyboard: interactive,
				attributionControl: true
			});

			L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
				maxZoom: 19,
				// Required. OSM tiles and data are ODbL-licensed and credit is a condition of use,
				// not a courtesy — Leaflet renders this into the corner of the map itself.
				attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
			}).addTo(map);

			if (lat != null && lon != null) place(lat, lon);

			if (interactive) {
				map.on('click', (event: { latlng: { lat: number; lng: number } }) => {
					place(event.latlng.lat, event.latlng.lng);
					onpick?.({ lat: event.latlng.lat, lon: event.latlng.lng });
				});
			}
			ready = true;
		})();

		return () => {
			disposed = true;
			// Leaflet attaches real window-level listeners; without `remove()` they outlive the
			// component and leak on every navigation.
			map?.remove();
			map = null;
			marker = null;
		};
	});

	// Keep the map in step when the parent changes the coordinates (an address search result landing
	// while the picker is already open). Guarded on `ready` so it cannot run before onMount finishes.
	$effect(() => {
		if (!ready || !map || lat == null || lon == null) return;
		place(lat, lon);
		map.setView([lat, lon], Math.max(map.getZoom(), zoom));
	});
</script>

<div class="location-map" class:location-map--interactive={interactive}>
	<div
		bind:this={container}
		class="location-map__canvas"
		role={interactive ? 'application' : 'img'}
		aria-label={interactive
			? m.services_locationPickerLabel()
			: label || m.services_locationMapLabel()}
	></div>
	{#if !ready}
		<div class="location-map__loading">{m.common_loading()}</div>
	{/if}
</div>

<style lang="scss">
	.location-map {
		position: relative;
		width: 100%;
		border-radius: var(--radius-sm);
		overflow: hidden;
		border: 1px solid var(--border-color);
	}
	.location-map__canvas {
		width: 100%;
		height: 220px;
		background: var(--bg-surface);
	}
	.location-map--interactive .location-map__canvas {
		height: 320px;
		cursor: crosshair;
	}
	.location-map__loading {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		background: var(--bg-surface);
	}

	// The divIcon pin — see `pinIcon` above for why the default marker image is not used.
	:global(.edmat-pin) {
		display: grid;
		place-items: center;
	}
	:global(.edmat-pin__dot) {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--accent);
		border: 3px solid var(--bg-page);
		box-shadow: 0 1px 4px rgb(0 0 0 / 45%);
		display: block;
	}
	// Leaflet's controls and attribution ship light-mode colors; without this they are unreadable
	// against this app's dark theme.
	:global(.location-map .leaflet-control-attribution) {
		background: var(--bg-surface);
		color: var(--text-secondary);
		font-size: 10px;
	}
	// The nested `a` needs its own :global() rather than sitting inside the block above — nesting
	// inside :global() does NOT make the descendant global, and Svelte correctly reported it as
	// unused because the <a> is generated by Leaflet at runtime.
	:global(.location-map .leaflet-control-attribution a) {
		color: var(--accent);
	}
</style>
