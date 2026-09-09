/** Hand the browser a file to save. Used for `.ics` exports: the bytes are fetched through the
 * API client (token in a header) and saved here, rather than linking to a URL carrying the token —
 * the same tradeoff notifications/views.py's QueryParamTokenAuthentication documents, avoided. */
export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
	const blob = new Blob([text], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
