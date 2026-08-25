import { loadMath } from '$lib/utils/mathRender';

// Prerendering renders synchronously, and the math renderer is loaded on demand (see
// lib/utils/mathRender.ts). Awaiting it here, server-side only, is what lets every prerendered
// page carry typeset KaTeX instead of raw source; in the browser this is a no-op, and the chunk
// is fetched by the first component that needs it.
export const load = async () => {
	if (import.meta.env.SSR) await loadMath();
};
