/** Addresses as the server splits them (`backend/courses/mailinvite.py: parse_addresses`): commas,
 *  semicolons, spaces and new lines; lower-cased, deduplicated, order kept. Loose on purpose — the
 *  server answers each address with its own reason, so nothing is dropped here for looking wrong. */
export function splitAddresses(text: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const part of text.split(/[\s,;]+/)) {
		const address = part.trim().replace(/^<|>$/g, '').toLowerCase();
		if (address && !seen.has(address)) {
			seen.add(address);
			out.push(address);
		}
	}
	return out;
}
