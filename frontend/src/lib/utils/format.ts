export function formatDate(iso: string, locale: string): string {
	return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(
		new Date(iso)
	);
}

const RTF_DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
	{ amount: 60, unit: 'seconds' },
	{ amount: 60, unit: 'minutes' },
	{ amount: 24, unit: 'hours' },
	{ amount: 7, unit: 'days' },
	{ amount: 4.34524, unit: 'weeks' },
	{ amount: 12, unit: 'months' },
	{ amount: Number.POSITIVE_INFINITY, unit: 'years' }
];

export function formatRelativeDate(iso: string, locale: string): string {
	const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
	let duration = (new Date(iso).getTime() - Date.now()) / 1000;
	for (const division of RTF_DIVISIONS) {
		if (Math.abs(duration) < division.amount)
			return rtf.format(Math.round(duration), division.unit);
		duration /= division.amount;
	}
	return rtf.format(Math.round(duration), 'years');
}
