/** Hand the browser a file to save. Used for `.ics` exports: the bytes are fetched through the
 * API client (token in a header) and saved here, rather than linking to a URL carrying the token —
 * the same tradeoff notifications/views.py's QueryParamTokenAuthentication documents, avoided. */
export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
	downloadBlob(filename, new Blob([text], { type: mime }));
}

/** The same, for bytes that were never text. An event document (CONFERENCE-BRIEF.md §3.C) arrives
 * as a Blob from a tier-checked endpoint that only answers a request carrying the token, so there
 * is no URL to link to — this is the whole of how it reaches the person's disk. */
export function downloadBlob(filename: string, blob: Blob): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
