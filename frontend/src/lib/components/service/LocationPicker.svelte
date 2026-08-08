<script lang="ts">
	// "Where do you teach?" — the in-person half of a tutoring listing. Two ways in, because tutors
	// genuinely know their location in two different forms: search an address (someone who teaches at
	// a named place), or click/drag the pin (someone who knows the spot but not its postal address).
	// Both end in the same three values, and each keeps the other in sync — a search moves the pin, a
	// pin drop reverse-geocodes into the label.
	//
	// Controlled, "dumb" component: it never saves anything itself, it just hands the parent a
	// location — the same shape `AddCoverageForm`/`RequirementsEditor` already established here.
	import { m } from '$lib/paraglide/messages.js';
	import {
		GeocodingUnavailableError,
		reverseGeocode,
		searchAddress,
		type GeocodeResult
	} from '$lib/services/geocoding';
	import { isComposingKey } from '$lib/utils/textInput';
	import LocationMap from './LocationMap.svelte';

	let {
		label = '',
		lat = null,
		lon = null,
		onchange
	}: {
		label?: string;
		lat?: number | null;
		lon?: number | null;
		onchange: (location: { label: string; lat: number | null; lon: number | null }) => void;
	} = $props();

	let query = $state('');
	let results = $state<GeocodeResult[]>([]);
	let attribution = $state('');
	let searching = $state(false);
	let searched = $state(false);
	let error = $state('');

	// Note there is no nested form element here, deliberately: this picker renders INSIDE the
	// listing form, and nesting one form in another is invalid HTML that browsers resolve by
	// silently dropping the inner one. So the search is a plain row of controls, and the Enter key
	// is handled on the input itself (see its `onkeydown`, which also stops Enter from submitting
	// the OUTER listing form).
	async function runSearch() {
		if (!query.trim() || searching) return;
		searching = true;
		error = '';
		searched = false;
		try {
			const response = await searchAddress(query);
			results = response.results;
			attribution = response.attribution;
			searched = true;
		} catch (e) {
			results = [];
			// The two failures are told apart deliberately: "the lookup is down" must never read as
			// "your address does not exist", or the user retypes a valid address indefinitely.
			error =
				e instanceof GeocodingUnavailableError
					? m.services_locationLookupUnavailable()
					: m.services_locationLookupFailed();
		} finally {
			searching = false;
		}
	}

	function choose(result: GeocodeResult) {
		results = [];
		searched = false;
		query = '';
		onchange({ label: result.label, lat: result.lat, lon: result.lon });
	}

	/** The pin moved. Coordinates are authoritative immediately — they are what the map shows and
	 * what the distance filter uses — and the human label is filled in afterward if the reverse
	 * lookup succeeds. Deliberately NOT awaited before reporting the coordinates: a failed or slow
	 * reverse lookup must never lose the location the user just picked. */
	async function handlePick(coords: { lat: number; lon: number }) {
		error = '';
		onchange({ label, lat: coords.lat, lon: coords.lon });
		try {
			const resolved = await reverseGeocode(coords.lat, coords.lon);
			if (resolved) onchange({ label: resolved.label, lat: coords.lat, lon: coords.lon });
		} catch {
			// The pin stands; only the label is missing. Not surfaced as an error, because nothing
			// the user did failed — they can still type a label or just leave the coordinates.
		}
	}

	function clear() {
		onchange({ label: '', lat: null, lon: null });
	}
</script>

<div class="location-picker">
	<p class="hint">{m.services_locationHint()}</p>

	<div class="search-row">
		<input
			type="text"
			bind:value={query}
			placeholder={m.services_locationSearchPlaceholder()}
			onkeydown={(e) => {
				// While an input method has a composition open, Enter means "accept this candidate"
				// and the address is still half-typed — so it must not geocode, and it must not be
				// preventDefault'ed either, since the key is the IME's. Returning early is safe for
				// the outer form: a browser does not submit on an Enter its own IME has consumed.
				if (isComposingKey(e)) return;
				if (e.key === 'Enter') {
					// Without this the Enter key submits the OUTER listing form, saving a
					// half-finished listing when the user only meant to search for their address.
					e.preventDefault();
					runSearch();
				}
			}}
		/>
		<button type="button" onclick={runSearch} disabled={searching || !query.trim()}>
			{searching ? m.common_loading() : m.services_locationSearchButton()}
		</button>
	</div>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	{#if results.length > 0}
		<ul class="results">
			{#each results as result (`${result.lat},${result.lon}`)}
				<li>
					<button type="button" class="result" onclick={() => choose(result)}>
						{result.label}
					</button>
				</li>
			{/each}
		</ul>
		{#if attribution}
			<p class="attribution">{attribution}</p>
		{/if}
	{:else if searched}
		<p class="hint">{m.services_locationNoResults()}</p>
	{/if}

	<LocationMap {lat} {lon} {label} interactive onpick={handlePick} />

	{#if lat != null && lon != null}
		<div class="chosen">
			<span class="chosen__label">{label || m.services_locationNoLabel()}</span>
			<span class="chosen__coords">{lat.toFixed(5)}, {lon.toFixed(5)}</span>
			<button type="button" class="clear" onclick={clear}>{m.services_locationClear()}</button>
		</div>
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.location-picker {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.hint,
	.attribution {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		margin: 0;
	}
	.attribution {
		font-size: var(--font-size-xs);
	}
	.search-row {
		display: flex;
		gap: var(--space-2);
		input {
			@include mix.focus-ring;
			flex: 1;
			min-width: 0;
			padding: var(--space-1) var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-page);
			color: var(--text-primary);
		}
		button {
			@include mix.button-secondary;
			padding: var(--space-1) var(--space-3);
			white-space: nowrap;
		}
	}
	.results {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}
	.result {
		@include mix.focus-ring;
		width: 100%;
		text-align: left;
		padding: var(--space-1) var(--space-2);
		background: var(--bg-surface);
		border: none;
		border-bottom: 1px solid var(--border-color);
		color: var(--text-primary);
		font-size: var(--font-size-sm);
		cursor: pointer;
		&:hover {
			background: var(--bg-page);
		}
	}
	.results li:last-child .result {
		border-bottom: none;
	}
	.error {
		color: var(--status-danger);
		font-size: var(--font-size-sm);
		margin: 0;
	}
	.chosen {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		font-size: var(--font-size-sm);
	}
	.chosen__label {
		font-weight: 600;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.chosen__coords {
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}
	.clear {
		@include mix.focus-ring;
		background: none;
		border: none;
		color: var(--status-danger);
		cursor: pointer;
		font-size: var(--font-size-sm);
		text-decoration: underline;
	}
</style>
