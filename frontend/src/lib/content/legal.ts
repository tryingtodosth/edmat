/**
 * The DSA Art. 11/12 "point of contact" page: who runs EdMat, how to reach them, and how content
 * moderation works here — plus a link to `/legal/notice`, the Art. 16 notice-and-action form.
 *
 * Same deliberate exception to this project's "every string is a message key" rule as
 * `privacy.ts`/`levels.ts` (see either file's own doc comment for the full reasoning): a legal
 * point-of-contact page has to be readable end to end, in both locales, not assembled from a dozen
 * scattered `en.json`/`pl.json` keys.
 *
 * **This document is not legal advice and was not written by a lawyer**, the same honest caveat
 * `privacy.ts` carries. It describes what the software actually does; whether that satisfies every
 * one of the University's own obligations under Regulation (EU) 2022/2065 is a question for its
 * data protection / legal office, not this codebase.
 */

export interface LegalPageSection {
	heading: string;
	body: string[];
}

export interface LegalContactPage {
	title: string;
	intro: string[];
	sections: LegalPageSection[];
	noticeLinkLabel: string;
}

const EN: LegalContactPage = {
	title: 'Legal contact & content notices',
	intro: [
		'This page is EdMat\'s point of contact for legal matters, and explains how to report a specific piece of content as illegal — the process Regulation (EU) 2022/2065 (the Digital Services Act) calls "notice and action".'
	],
	sections: [
		{
			heading: 'Who runs this service',
			body: [
				'EdMat is operated by Ośrodek Komputerowy Wydziału Fizyki Uniwersytetu Warszawskiego (the Computer Centre of the Faculty of Physics, University of Warsaw), which administers the systems this site runs on.',
				"If you are a student with a question, Dziekanat Studencki (the Student Dean's Office) is your contact point and will pass your request on. For everything else, including a notice about a specific piece of content, use the form linked below."
			]
		},
		{
			heading: 'Reporting illegal content',
			body: [
				'If you believe a specific, published piece of content on this site — an exercise, a material, a comment, a listing, anything else — is illegal, you can tell us using the notice form below. You do not need an account.',
				"A notice needs to say exactly where the content is (its page address), why you consider it illegal, and a way to reach you — we ask for an email even from somebody filing anonymously otherwise, because we cannot tell you what we decided without one. A member of staff reviews every notice by hand and tells you the outcome, with the reason for it, once it's been decided."
			]
		},
		{
			heading: 'How moderation works here',
			body: [
				"Most content on this site is reviewed by a moderator before or shortly after it is published — see this project's own moderation queue, which every new exercise, material, translation and edit suggestion passes through. That review is about quality and fit for the site, not a legal judgment on every submission.",
				'A legal notice is a separate, additional channel specifically for "this is illegal", reviewed on its own by a member of staff, independent of the ordinary moderation queue.'
			]
		}
	],
	noticeLinkLabel: 'File a notice about a specific piece of content →'
};

const PL: LegalContactPage = {
	title: 'Kontakt w sprawach prawnych i zgłoszenia treści',
	intro: [
		'Ta strona to punkt kontaktowy EdMat w sprawach prawnych i wyjaśnia, jak zgłosić konkretną treść jako nielegalną — proces, który Rozporządzenie (UE) 2022/2065 (Akt o usługach cyfrowych, DSA) nazywa „zgłoszeniem i działaniem".'
	],
	sections: [
		{
			heading: 'Kto prowadzi ten serwis',
			body: [
				'EdMat prowadzi Ośrodek Komputerowy Wydziału Fizyki Uniwersytetu Warszawskiego, który administruje systemami, na których działa ta strona.',
				'Jeśli jesteś studentem i masz pytanie, punktem kontaktowym jest Dziekanat Studencki, który przekaże Twoje zgłoszenie dalej. We wszystkich innych sprawach, w tym zgłoszeniu konkretnej treści, skorzystaj z formularza poniżej.'
			]
		},
		{
			heading: 'Zgłaszanie nielegalnych treści',
			body: [
				'Jeśli uważasz, że konkretna, opublikowana treść w tym serwisie — zadanie, materiał, komentarz, ogłoszenie, cokolwiek innego — jest nielegalna, możesz to zgłosić za pomocą formularza poniżej. Nie potrzebujesz konta.',
				'Zgłoszenie musi wskazywać dokładnie, gdzie znajduje się treść (adres strony), dlaczego uważasz ją za nielegalną, oraz sposób kontaktu z Tobą — prosimy o adres e-mail nawet przy zgłoszeniu anonimowym, ponieważ bez niego nie możemy poinformować Cię o decyzji. Każde zgłoszenie jest ręcznie sprawdzane przez osobę z zespołu, która po podjęciu decyzji przekazuje Ci jej wynik wraz z uzasadnieniem.'
			]
		},
		{
			heading: 'Jak działa moderacja w tym serwisie',
			body: [
				'Większość treści w tym serwisie jest sprawdzana przez moderatora przed publikacją lub wkrótce po niej — każde nowe zadanie, materiał, tłumaczenie czy propozycja edycji przechodzi przez kolejkę moderacji tego projektu. Ta weryfikacja dotyczy jakości i dopasowania do serwisu, a nie prawnej oceny każdego zgłoszenia.',
				'Zgłoszenie prawne to osobny, dodatkowy kanał przeznaczony właśnie do „to jest nielegalne" — rozpatrywany osobno przez członka zespołu, niezależnie od zwykłej kolejki moderacji.'
			]
		}
	],
	noticeLinkLabel: 'Zgłoś konkretną treść →'
};

export function legalContactPage(locale: string): LegalContactPage {
	return locale === 'pl' ? PL : EN;
}
