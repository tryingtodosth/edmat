/** How many items each browse list left out because of the content-language rule, keyed by
 * request path (no query string) — written by `client.ts` from the `X-EdMat-Hidden-Languages`
 * header, read by `HiddenLanguagesNotice`. A leaf module: imports nothing. */
class HiddenCountsStore {
	byPath = $state<Record<string, number>>({});
	record(path: string, count: number) {
		this.byPath = { ...this.byPath, [path]: count };
	}
	for(path: string): number {
		return this.byPath[path] ?? 0;
	}
}
export const hiddenCountsStore = new HiddenCountsStore();
