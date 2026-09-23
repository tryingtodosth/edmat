// Event documents and the briefing gate (CONFERENCE-BRIEF.md §3.C) driven in a real browser:
// the tiers as three different people see them, an upload through the real form, and the
// interstitial that stands between a volunteer and the check-in button until the briefing is read.
//
// Kasia hosts and organises; Ola is the volunteer; Michał is going. Scratch data is created and
// removed through the real API.
//
//   E2E_BASE=http://localhost:5203 E2E_API=http://127.0.0.1:8103 node e2e/event-documents.mjs
//
// It also asserts, against `build/` when one exists, that pdf.js is absent from the entry chunks
// (house rule 11) — the interstitial renders a PDF, and the whole point of importing both
// `PdfViewer` and `pdfjs-dist` dynamically is that a reader who never opens one never pays for it.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { englishContext } from './english.mjs';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	({ chromium } = await import('playwright-core'));
}

const BASE = process.env.E2E_BASE ?? 'http://localhost:5203';
const API = process.env.E2E_API ?? 'http://127.0.0.1:8103';
let pass = 0,
	fail = 0;
const errors = [];
const check = (label, ok, detail = '') => {
	if (ok) pass++;
	else fail++;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ' — ' + detail}`);
};

// ---- the entry-bundle assertion (no browser needed) -------------------------------------------
const entryDir = 'build/_app/immutable/entry';
if (existsSync(entryDir)) {
	const entries = readdirSync(entryDir).filter((f) => f.endsWith('.js'));
	const withPdf = entries.filter((f) => readFileSync(`${entryDir}/${f}`, 'utf8').includes('pdfjs'));
	check(
		`pdf.js is absent from the ${entries.length} entry chunks`,
		entries.length > 0 && withPdf.length === 0,
		withPdf.join(', ')
	);
} else {
	console.log('  note  no build/ — run `npm run build` to check the entry bundle too');
}

// ---- API helpers ------------------------------------------------------------------------------
const tokenFor = async (email) => {
	const r = await fetch(`${API}/api/auth/login/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: email, password: 'password123' })
	});
	return (await r.json()).token;
};
const kasia = await tokenFor('kasia@edmat.example');
const ola = await tokenFor('ola@edmat.example');
const michal = await tokenFor('michal@edmat.example');
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Token ${t}` });
const me = async (t) =>
	(await (await fetch(`${API}/api/auth/me/`, { headers: auth(t) })).json()).id;

const MARKER = 'Documents e2e — conference day';
const removeEvent = async (id) => {
	for (const t of [ola, michal]) {
		await fetch(`${API}/api/events/${id}/attend/`, {
			method: 'POST',
			headers: auth(t),
			body: JSON.stringify({ status: 'not_going' })
		});
	}
	const r = await fetch(`${API}/api/events/${id}/`, { method: 'DELETE', headers: auth(kasia) });
	if (r.status !== 204)
		await fetch(`${API}/api/events/${id}/cancel/`, { method: 'POST', headers: auth(kasia) });
};
for (const e of await (
	await fetch(`${API}/api/events/?mine=hosting`, { headers: auth(kasia) })
).json()) {
	if (e.title.startsWith(MARKER) && e.status !== 'cancelled') await removeEvent(e.id);
}

const start = new Date(Date.now() + 5 * 86400e3);
start.setHours(9, 0, 0, 0);
const event = await (
	await fetch(`${API}/api/events/`, {
		method: 'POST',
		headers: auth(kasia),
		body: JSON.stringify({
			title: MARKER,
			summary: 'Scratch event for the documents e2e',
			status: 'published',
			visibility: 'public',
			starts_at: start.toISOString(),
			duration_minutes: 300,
			location_kind: 'onsite',
			location_text: 'Room 1',
			audience: 'university',
			language: 'en'
		})
	})
).json();
check('the scratch event was created', Boolean(event.id), JSON.stringify(event).slice(0, 200));

await fetch(`${API}/api/events/${event.id}/staff/`, {
	method: 'POST',
	headers: auth(kasia),
	body: JSON.stringify({ user: await me(ola), role: 'volunteer' })
});
await fetch(`${API}/api/events/${event.id}/attend/`, {
	method: 'POST',
	headers: auth(michal),
	body: JSON.stringify({ status: 'going' })
});

// An organisers-only document, posted through the API, that no volunteer and no attendee may see.
await fetch(`${API}/api/events/${event.id}/documents/`, {
	method: 'POST',
	headers: auth(kasia),
	body: JSON.stringify({
		title: 'Budget (organisers)',
		kind: 'link',
		url: 'https://example.org/budget',
		visibility: 'organisers'
	})
});

// A real, renderable one-page PDF built byte by byte (with a correct xref, which pdf.js does look
// at) — the point is to drive the WHOLE file path in a browser: multipart upload through the real
// form, the sniff and the scan on the server, the stored random name, and then the tier-checked
// byte endpoint fetched as a Blob through `client.ts` and handed to pdf.js.
function onePagePdf() {
	const objects = [
		'<</Type/Catalog/Pages 2 0 R>>',
		'<</Type/Pages/Kids[3 0 R]/Count 1>>',
		'<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
		null, // the content stream, built below
		'<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'
	];
	const stream = 'BT /F1 24 Tf 30 100 Td (Volunteer briefing) Tj ET';
	objects[3] = `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`;
	let pdf = '%PDF-1.4\n';
	const offsets = [];
	objects.forEach((body, i) => {
		offsets.push(pdf.length);
		pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = pdf.length;
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
	pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(pdf, 'latin1');
}

// ---- the browser ------------------------------------------------------------------------------
const browser = await chromium.launch(
	process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
const mk = async () => {
	const ctx = await englishContext(browser, BASE, {
		viewport: { width: 1280, height: 1100 },
		acceptDownloads: true
	});
	const p = await ctx.newPage();
	p.on('console', (msg) => {
		// The ONE expected console error in this script: Chromium logs every non-2xx response, and
		// the refused check-in is a 409 on purpose — that refusal is the feature being tested. Every
		// other console error still fails the run.
		const expected409 = msg.text().includes('409 (Conflict)');
		if (msg.type() === 'error' && !expected409) errors.push(`[${p.url()}] ${msg.text()}`);
	});
	p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
	return p;
};
const login = async (p, email) => {
	// Waiting for the form proves nothing about whether it WORKS (e2e/CLAUDE.md trap 25): every
	// control is in the server-rendered HTML and a click does nothing until the bundle has
	// hydrated, which on a cold dev server is many seconds. The root layout's own boot request is
	// the honest signal, registered BEFORE the navigation.
	const booted = p
		.waitForResponse((r) => r.url().includes('/feature-flags/'), { timeout: 180000 })
		.catch(() => null);
	await p.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 180000 });
	await booted;
	await p.locator('form input[autocomplete="username"]').waitFor({ timeout: 60000 });
	await p.waitForTimeout(1200);
	await p.locator('form input[autocomplete="username"]').fill(email);
	await p.locator('form input[type="password"]').fill('password123');
	await p.locator('form button[type="submit"]').click();
	await p.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60000 });
};
const openEvent = async (p) => {
	await p.goto(`${BASE}/events/${event.id}`, { waitUntil: 'load', timeout: 180000 });
	await p.locator('h1').waitFor({ timeout: 60000 });
	await p.waitForTimeout(2000);
};

// --- the organiser adds a mandatory staff briefing through the real form ---
const organiser = await mk();
await login(organiser, 'kasia@edmat.example');
await openEvent(organiser);
const panel = organiser.locator('section.documents');
await panel.waitFor({ timeout: 30000 });
check('the organiser sees the Documents panel', await panel.isVisible());

await panel.getByRole('button', { name: 'Add a document', exact: true }).click();
const form = panel.locator('form');
await form.waitFor({ timeout: 10000 });
await form.locator('input[type="text"]').fill('Volunteer briefing');
await form.locator('select').first().selectOption('link');
await form.locator('input[type="url"]').fill('https://example.org/briefing');
await form.locator('select:has(option[value="organisers"])').selectOption('staff');
await form.locator('input[type="checkbox"]').check();
await form.getByRole('button', { name: 'Add', exact: true }).click();
await organiser.waitForTimeout(2500);
const briefingRow = panel.locator('li', { hasText: 'Volunteer briefing' }).first();
check('the briefing was added and is listed', await briefingRow.isVisible());
check('it carries the "Must be read" pill', (await briefingRow.locator('.pill--warn').count()) > 0);
check(
	'the organiser sees both tier groups (staff and organisers)',
	(await panel.locator('.group').count()) === 2,
	String(await panel.locator('.group').count())
);
await organiser.screenshot({ path: 'e2e/screens/event-documents-organiser.png', fullPage: false });

// The same form again, this time with a real file: the upload path, the protected byte endpoint and
// the lazy pdf.js preview, all in a browser (house rule 2 — the Django tests prove the refusals, a
// browser is the only thing that proves the reader ever sees the page).
await panel.getByRole('button', { name: 'Add a document', exact: true }).click();
const fileForm = panel.locator('form');
await fileForm.waitFor({ timeout: 10000 });
await fileForm.locator('input[type="text"]').fill('Site plan');
await fileForm.locator('select:has(option[value="organisers"])').selectOption('attendees');
await fileForm.locator('input[type="file"]').setInputFiles({
	name: 'site-plan.pdf',
	mimeType: 'application/pdf',
	buffer: onePagePdf()
});
await fileForm.getByRole('button', { name: 'Add', exact: true }).click();
await organiser.waitForTimeout(3000);
const pdfRow = panel.locator('li', { hasText: 'Site plan' }).first();
check('the PDF upload was accepted', await pdfRow.isVisible());
check(
	'it is flagged as not virus-scanned rather than silently "clean"',
	(await pdfRow.innerText()).includes('Not virus-scanned')
);
await pdfRow.getByRole('button', { name: 'Preview', exact: true }).click();
const canvas = pdfRow.locator('.pdf-viewer canvas');
await canvas.waitFor({ timeout: 40000 });
const box = await canvas.boundingBox();
check('pdf.js renders the stored PDF in place', Boolean(box) && box.width > 50 && box.height > 50);
const download = organiser.waitForEvent('download', { timeout: 30000 });
await pdfRow.getByRole('button', { name: 'Download', exact: true }).click();
const saved = await download;
check(
	'the download is named after the document, not the uploaded file',
	saved.suggestedFilename() === 'Site plan.pdf',
	saved.suggestedFilename()
);
await organiser.screenshot({ path: 'e2e/screens/event-documents-pdf.png' });

// --- the attendee sees neither ---
const attendee = await mk();
await login(attendee, 'michal@edmat.example');
await openEvent(attendee);
const attendeePanel = attendee.locator('section.documents');
const attendeeText = (await attendeePanel.count()) ? await attendeePanel.innerText() : '';
check('an attendee does not see the staff briefing', !attendeeText.includes('Volunteer briefing'));
check('an attendee does not see the organisers document', !attendeeText.includes('Budget'));
check('an attendee DOES see the attendees-tier document', attendeeText.includes('Site plan'));
await attendee.screenshot({ path: 'e2e/screens/event-documents-attendee.png' });

// --- the volunteer is blocked at check-in until the briefing is acknowledged ---
const volunteer = await mk();
await login(volunteer, 'ola@edmat.example');
await openEvent(volunteer);
const volunteerPanel = volunteer.locator('section.documents');
const volunteerText = await volunteerPanel.innerText();
check('the volunteer sees the staff briefing', volunteerText.includes('Volunteer briefing'));
check('the volunteer does not see the organisers document', !volunteerText.includes('Budget'));

const registrations = volunteer.locator('section.registrations');
await registrations.waitFor({ timeout: 30000 });
await registrations.getByRole('button', { name: 'Check in', exact: true }).first().click();
const interstitial = volunteer.locator('section.briefing');
await interstitial.waitFor({ timeout: 15000 });
check('check-in is refused with the briefing interstitial', await interstitial.isVisible());
// It fetches the documents it is about, so wait for the row rather than reading the text while it
// still says "Loading…" (a vacuous pass either way — e2e/CLAUDE.md trap 8).
await interstitial
	.getByRole('button', { name: 'Read and understood', exact: true })
	.waitFor({ timeout: 20000 });
check(
	'the interstitial names the document that is blocking',
	(await interstitial.innerText()).includes('Volunteer briefing'),
	await interstitial.innerText()
);
await volunteer.screenshot({ path: 'e2e/screens/event-documents-briefing.png' });
const stillPending = await registrations.locator('.pill--checked').count();
check('nobody was checked in while it was refused', stillPending === 0, String(stillPending));

await interstitial.getByRole('button', { name: 'Read and understood', exact: true }).click();
await volunteer.waitForTimeout(2000);
check('the interstitial closes once it is acknowledged', (await interstitial.count()) === 0);
await registrations.getByRole('button', { name: 'Check in', exact: true }).first().click();
// Wait for the pill itself rather than a fixed two seconds: on the merged event page the refresh
// after a check-in also re-runs the other conference panels, and a fixed wait raced it (integration,
// 2026-09-23).
await registrations
	.locator('.pill--checked')
	.first()
	.waitFor({ timeout: 15000 })
	.catch(() => {});
const checkedIn = await registrations.locator('.pill--checked').count();
check('check-in goes through afterwards', checkedIn === 1, String(checkedIn));
// The panel further down the page holds its own copy of the list and was loaded BEFORE the
// acknowledgement. Nothing asserted this and the screenshot showed it lying ("1 still to read"
// beside a briefing that had just been read) — hence `state/documentAcks` and this check.
// Scoped to the HEADER pill ("n still to read"): the row's own "Must be read" pill is a property
// of the document, not of this reader, and stays exactly where it is (e2e/CLAUDE.md trap 6 — the
// first version of this check counted both and failed against a correct page).
const stillToRead = await volunteerPanel.locator('.head .pill--warn').count();
check(
	'the panel no longer claims the briefing is unread',
	stillToRead === 0,
	await volunteerPanel.locator('.head').innerText()
);
check(
	'and the row now reads as read',
	(
		await volunteerPanel.locator('li', { hasText: 'Volunteer briefing' }).first().innerText()
	).includes('Read')
);
await volunteer.screenshot({ path: 'e2e/screens/event-documents-after-briefing.png' });

// --- the organiser's read-receipt table now says so ---
await openEvent(organiser);
await organiser.locator('section.documents').waitFor({ timeout: 30000 });
await organiser
	.locator('section.documents')
	.getByRole('button', { name: 'Who has read what', exact: true })
	.click();
await organiser.waitForTimeout(800);
const receiptsText = await organiser.locator('section.documents .receipts').innerText();
check('the read-receipt table lists the volunteer', receiptsText.includes('Ola'));
check('and still says somebody has not read it', receiptsText.includes('Not yet'));
await organiser.screenshot({ path: 'e2e/screens/event-documents-receipts.png' });

// --- an anonymous visitor sees no panel content at all ---
const stranger = await mk();
await openEvent(stranger);
const strangerPanel = stranger.locator('section.documents');
const strangerText = (await strangerPanel.count()) ? await strangerPanel.innerText() : '';
check('a signed-out visitor sees no staff document', !strangerText.includes('Volunteer briefing'));

// ---- cleanup ----------------------------------------------------------------------------------
await removeEvent(event.id);
const gone = await fetch(`${API}/api/events/${event.id}/`, { headers: auth(kasia) });
const goneBody = gone.status === 200 ? await gone.json() : null;
check(
	'the scratch event is gone or cancelled',
	gone.status === 404 || goneBody?.status === 'cancelled',
	String(gone.status)
);

check('no console or page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
