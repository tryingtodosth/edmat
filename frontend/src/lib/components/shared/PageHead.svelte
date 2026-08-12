<script lang="ts">
	/**
	 * The one place a page's title, description, canonical URL and social-preview tags are written.
	 *
	 * Before this, all 41 routes set a `<title>` by hand and NOT ONE set a description, a canonical
	 * or an Open Graph tag — so every link shared to Slack, Discord, WhatsApp or LinkedIn rendered
	 * as a bare URL, and every search result got a snippet auto-generated from a page that (until
	 * the prerendering in this same pass) had no text in it at all.
	 *
	 * Deliberately a component rather than a rune module holding the current page's metadata, even
	 * though this codebase reaches for `.svelte.ts` rune modules readily elsewhere. The reason is
	 * prerendering specifically: a module the layout reads and each page writes would have the
	 * layout emitting its `<svelte:head>` BEFORE the page component had run and set anything, so
	 * every prerendered file would ship the default title. A component invoked from inside the page
	 * renders where the page renders, which is the only ordering that survives being rendered once,
	 * at build time, with no hydration to correct it afterwards.
	 *
	 * `title` is the page's own name; the " — EdMat" suffix is added here so no call site has to
	 * remember it, and so the app name cannot end up doubled the way four routes previously managed
	 * ("EdMat — EdMat", where the fallback title and the suffix were both the app name).
	 */
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';

	interface Props {
		/** The page's own name. Omit on the homepage, where the app name alone IS the title. */
		title?: string;
		/** One or two sentences describing this page. Shown in search results and link previews. */
		description: string;
		/**
		 * Set for pages that must never be indexed — anything behind a token, and anything private
		 * enough that appearing in a search result would itself be the problem.
		 */
		noindex?: boolean;
	}

	let { title, description, noindex = false }: Props = $props();

	const SITE_NAME = 'EdMat';
	/** The canonical public origin. `www.` and the university hostname both resolve here. */
	const SITE_ORIGIN = 'https://edmat.net';

	let fullTitle = $derived(title ? `${title} — ${SITE_NAME}` : m.common_appName());

	/**
	 * Canonical is the path WITHOUT its query string, deliberately. `?tab=events` on the homepage
	 * and `?q=` on search are view state, not different documents, and letting each combination
	 * present itself as its own page is how a crawl budget gets spent on one page many times over.
	 *
	 * `page.url.pathname` is safe during prerendering; `page.url.searchParams` is not (SvelteKit
	 * throws on it, since a prerendered page has no query string) — which is the whole reason this
	 * reads only the pathname rather than rebuilding the URL.
	 */
	let canonical = $derived(`${SITE_ORIGIN}${page.url.pathname}`);
</script>

<svelte:head>
	<title>{fullTitle}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={canonical} />

	{#if noindex}
		<meta name="robots" content="noindex" />
	{/if}

	<!-- Open Graph. `og:type` is website throughout rather than `article` per content page: these
	     are reference and listing pages, not dated articles, and claiming otherwise invites
	     previews that ask for an author and a publish date neither of which this data model has. -->
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={SITE_NAME} />
	<meta property="og:title" content={fullTitle} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={canonical} />

	<!-- No `og:image`: this app has no share image, and pointing at one that does not exist is
	     worse than omitting the tag, since a scraper will fetch and then render a broken preview
	     rather than falling back to a clean text card. Worth adding once a real asset exists. -->
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={fullTitle} />
	<meta name="twitter:description" content={description} />
</svelte:head>
