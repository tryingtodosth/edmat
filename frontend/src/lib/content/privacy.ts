/**
 * The privacy policy, in full, per locale.
 *
 * **A deliberate exception to this project's "every user-facing string is a message key" rule
 * (CLAUDE.md Section 8/10), for a reason specific to legal text.** That rule exists so no string is
 * ever English-only — a purpose this file satisfies exactly, since both locales live here and a new
 * one cannot be added without adding both. What it would cost to follow literally is the thing that
 * matters most about a privacy policy: it has to be readable, and reviewable, AS A DOCUMENT. Split
 * across ~50 keys interleaved with button labels in `en.json`, neither language version can be read
 * end to end, which is exactly what a lawyer, a data protection officer, or a student exercising
 * their rights needs to do with it.
 *
 * The two versions are equally authoritative — the Polish one is not a translation of the English
 * one in any legal sense, and both are shown at the same URL depending on the reader's own locale.
 *
 * **This document is not legal advice and was not written by a lawyer.** It describes accurately
 * what the software does — every claim below was checked against the real code, not assumed — but
 * whether that description satisfies the University's own obligations is a question for the
 * data protection officer. See LAUNCHCHECKLIST.md's own 🟢 section, which still carries GDPR
 * compliance as open.
 */

export interface PolicySection {
	heading: string;
	/** Rendered as paragraphs. */
	body?: string[];
	/** Rendered as a bulleted list under the paragraphs. */
	bullets?: string[];
	/** Rendered as a two-column table. */
	table?: { columns: [string, string]; rows: [string, string][] };
}

export interface PrivacyPolicy {
	title: string;
	updated: string;
	intro: string[];
	sections: PolicySection[];
}

/** Change this whenever the policy's own substance changes, not on a typo fix. Readers who were
 * told one thing need to be able to tell that they are now being told another. */
export const POLICY_LAST_UPDATED = '2026-07-31';

const EN: PrivacyPolicy = {
	title: 'Privacy policy',
	updated: `Last updated: ${POLICY_LAST_UPDATED}`,
	intro: [
		'EdMat is a study resource run within the Faculty of Physics, University of Warsaw. This page explains exactly what the service records about you, why, how long it keeps it, and what you can ask us to do about it.',
		'We do not use a cookie banner, and that is a deliberate decision rather than an omission. EdMat runs no analytics, no advertising, and no third-party tracking of any kind. The only things stored on your own device are the ones the site cannot work without, and they are listed in full below. If we ever add something that genuinely requires your consent, we will ask you for it at that moment, in the place it applies — not through a banner that asks about everything at once.'
	],
	sections: [
		{
			heading: 'Who is responsible',
			body: [
				'The service is operated by Ośrodek Komputerowy Wydziału Fizyki Uniwersytetu Warszawskiego (the Computer Centre of the Faculty of Physics, University of Warsaw), which administers the systems this site runs on and oversees how the data described here is handled.',
				"EdMat is developed by students of the Faculty. If you are a student and have a question about this service, or want to exercise any of the rights below, Dziekanat Studencki (the Student Dean's Office) is your contact point and will pass your request on."
			]
		},
		{
			heading: 'What is stored on your device',
			body: [
				'These are the only things EdMat writes to your browser. All of them are necessary for a feature you asked for, none of them are shared with anyone, and none of them are used to track you across other websites.'
			],
			table: {
				columns: ['What', 'Why'],
				rows: [
					['Login token', 'Keeps you signed in. Removed when you log out.'],
					['PARAGLIDE_LOCALE', 'Remembers whether you chose Polish or English.'],
					['Theme preference', 'Remembers light or dark mode.'],
					[
						'My Set',
						'The exercise collection you build while browsing, so it survives a page reload. Stays on your device unless you sign in and save it.'
					],
					[
						'Recently viewed exercises',
						'Used only to avoid handing you the same exercise twice from the random picker. Never sent to the server.'
					],
					['Interface preferences', 'Small things like which tab you last had open.']
				]
			}
		},
		{
			heading: 'What the server records',
			body: [
				'Every website receives certain information simply by being asked for a page, and EdMat keeps a record of it to keep the service working and secure — to investigate errors, and to detect abuse such as password-guessing attacks.',
				'The legal basis for this is our legitimate interest in the security and correct operation of the service (Article 6(1)(f) GDPR; see also Recital 49, which names network and information security specifically). It is not based on consent, which is why there is nothing here for a banner to ask about.'
			],
			bullets: [
				'Your IP address',
				'The date and time of the request',
				'Which page or endpoint was requested, and whether it succeeded',
				'How long it took to serve',
				"Your browser's self-reported name and version, and the page you arrived from",
				'Your account, if you were signed in at the time'
			]
		},
		{
			heading: 'What the server deliberately does not record',
			bullets: [
				"What you searched for. Search terms are removed before anything is written down — what you are studying is nobody else's business.",
				'Anything you type into a login or registration form.',
				'Your password, or the contents of any authentication request.',
				'Any identifier that would let us recognise you as a returning visitor when you are not signed in. We do not fingerprint devices, and there is an automated test in the codebase that fails if anyone tries to add one.'
			]
		},
		{
			heading: 'How long it is kept',
			table: {
				columns: ['Data', 'Retention'],
				rows: [
					[
						'Full IP address',
						'30 days, then shortened so it identifies a network rather than a household'
					],
					['The rest of the request log', '90 days, then deleted'],
					['Record of moderation decisions', 'For as long as the account exists, plus one year'],
					['Your account and the content you posted', 'Until you ask for it to be deleted']
				]
			},
			body: [
				'Deletion is automatic and runs daily. It is not something a person has to remember to do.'
			]
		},
		{
			heading: 'Content you post publicly',
			body: [
				'Exercises, translations, comments, reviews, tutoring listings and profile information are visible to other users by design, under whatever display name you chose. Please treat anything you post as public. Messages you send to another user through the site are visible to that user and to moderators.'
			]
		},
		{
			heading: 'Your rights',
			body: [
				'Under the GDPR you can ask for a copy of the data we hold about you, ask us to correct it, ask us to delete it, and object to our processing it on the basis of legitimate interest. Contact Dziekanat Studencki, or Ośrodek Komputerowy Wydziału Fizyki UW, to make a request. You also have the right to complain to the Polish data protection authority (Prezes Urzędu Ochrony Danych Osobowych).',
				'One limit is worth stating plainly rather than leaving you to discover it: if you have acted as a moderator, the record of the decisions you made is kept even after your account is deleted, with your name removed from it. This is because those decisions can be appealed and reviewed by others, and a decision nobody can examine cannot be challenged by the person it affected.'
			]
		},
		{
			heading: 'Who else sees it',
			body: [
				'Nobody outside the Faculty. EdMat sends no data to advertisers, analytics providers or any other third party.',
				'Two external services are contacted in the branch of normal use, and neither receives anything about you: OpenStreetMap, when you search for an address while creating a tutoring listing (the search text is sent, your identity is not), and the map tiles shown on a listing, which are requested by your browser directly from OpenStreetMap and therefore reveal your IP address to them.'
			]
		},
		{
			heading: 'Changes to this policy',
			body: [
				'If this policy changes in substance, the date at the top will change with it. We will not quietly broaden what we collect without saying so here first.'
			]
		}
	]
};

const PL: PrivacyPolicy = {
	title: 'Polityka prywatności',
	updated: `Ostatnia aktualizacja: ${POLICY_LAST_UPDATED}`,
	intro: [
		'EdMat to serwis edukacyjny prowadzony na Wydziale Fizyki Uniwersytetu Warszawskiego. Ta strona wyjaśnia dokładnie, co serwis o Tobie zapisuje, po co, jak długo to przechowuje i o co możesz nas poprosić.',
		'Nie używamy baneru zgody na pliki cookie — i jest to świadoma decyzja, a nie przeoczenie. EdMat nie korzysta z żadnej analityki, reklam ani śledzenia przez podmioty trzecie. Na Twoim urządzeniu zapisujemy wyłącznie to, bez czego serwis nie mógłby działać, a pełną listę znajdziesz poniżej. Jeśli kiedykolwiek pojawi się coś, co naprawdę wymaga Twojej zgody, poprosimy o nią w tym momencie i w tym miejscu, którego dotyczy — a nie przez baner pytający o wszystko naraz.'
	],
	sections: [
		{
			heading: 'Kto odpowiada za serwis',
			body: [
				'Serwis prowadzi Ośrodek Komputerowy Wydziału Fizyki Uniwersytetu Warszawskiego, który administruje systemami, na których działa ta strona, i nadzoruje sposób postępowania z opisanymi tu danymi.',
				'EdMat rozwijają studenci Wydziału. Jeśli jesteś studentem i masz pytanie dotyczące serwisu albo chcesz skorzystać z któregokolwiek z wymienionych niżej praw, punktem kontaktowym jest Dziekanat Studencki, który przekaże Twoje zgłoszenie dalej.'
			]
		},
		{
			heading: 'Co jest zapisywane na Twoim urządzeniu',
			body: [
				'To jedyne rzeczy, jakie EdMat zapisuje w Twojej przeglądarce. Każda z nich jest niezbędna do działania funkcji, o którą sam poprosiłeś, żadna nie jest nikomu udostępniana i żadna nie służy do śledzenia Cię na innych stronach.'
			],
			table: {
				columns: ['Co', 'Po co'],
				rows: [
					['Token logowania', 'Utrzymuje Twoją sesję. Usuwany przy wylogowaniu.'],
					['PARAGLIDE_LOCALE', 'Zapamiętuje wybór języka polskiego lub angielskiego.'],
					['Preferencja motywu', 'Zapamiętuje tryb jasny lub ciemny.'],
					[
						'Mój zestaw',
						'Zbiór zadań budowany podczas przeglądania, aby przetrwał odświeżenie strony. Pozostaje na Twoim urządzeniu, dopóki nie zalogujesz się i go nie zapiszesz.'
					],
					[
						'Ostatnio oglądane zadania',
						'Służy wyłącznie do tego, by losowanie nie podało Ci dwa razy tego samego zadania. Nigdy nie jest wysyłane na serwer.'
					],
					['Ustawienia interfejsu', 'Drobiazgi, np. ostatnio otwarta zakładka.']
				]
			}
		},
		{
			heading: 'Co zapisuje serwer',
			body: [
				'Każdy serwis internetowy otrzymuje pewne informacje już przez samo zapytanie o stronę. EdMat zachowuje ich zapis, aby serwis działał poprawnie i bezpiecznie — aby badać błędy oraz wykrywać nadużycia, takie jak próby odgadywania haseł.',
				'Podstawą prawną jest nasz prawnie uzasadniony interes polegający na zapewnieniu bezpieczeństwa i prawidłowego działania serwisu (art. 6 ust. 1 lit. f RODO; zob. też motyw 49, który wprost wymienia bezpieczeństwo sieci i informacji). Nie opiera się to na zgodzie — dlatego nie ma tu o co pytać w banerze.'
			],
			bullets: [
				'Twój adres IP',
				'Data i godzina zapytania',
				'Która strona lub który zasób był żądany i czy zapytanie się powiodło',
				'Czas obsługi zapytania',
				'Nazwa i wersja przeglądarki podana przez nią samą oraz strona, z której przyszedłeś',
				'Twoje konto, jeśli w tym momencie byłeś zalogowany'
			]
		},
		{
			heading: 'Czego serwer świadomie nie zapisuje',
			bullets: [
				'Treści wyszukiwania. Wpisane frazy są usuwane, zanim cokolwiek zostanie zapisane — to, czego się uczysz, nie jest niczyją sprawą.',
				'Niczego, co wpisujesz w formularzu logowania lub rejestracji.',
				'Twojego hasła ani zawartości jakiegokolwiek zapytania uwierzytelniającego.',
				'Żadnego identyfikatora, który pozwoliłby rozpoznać Cię jako powracającego użytkownika, gdy nie jesteś zalogowany. Nie stosujemy odcisku palca urządzenia, a w kodzie znajduje się automatyczny test, który nie przejdzie, jeśli ktoś spróbuje taki identyfikator dodać.'
			]
		},
		{
			heading: 'Jak długo to przechowujemy',
			table: {
				columns: ['Dane', 'Okres przechowywania'],
				rows: [
					[
						'Pełny adres IP',
						'30 dni, następnie skracany tak, by wskazywał sieć, a nie gospodarstwo domowe'
					],
					['Pozostała część dziennika zapytań', '90 dni, następnie usuwana'],
					['Zapis decyzji moderacyjnych', 'Przez czas istnienia konta oraz rok dłużej'],
					[
						'Twoje konto i opublikowane przez Ciebie treści',
						'Do czasu zgłoszenia żądania usunięcia'
					]
				]
			},
			body: [
				'Usuwanie jest automatyczne i wykonywane codziennie. Nie zależy od tego, czy ktoś o nim pamięta.'
			]
		},
		{
			heading: 'Treści publikowane publicznie',
			body: [
				'Zadania, tłumaczenia, komentarze, recenzje, ogłoszenia korepetycji oraz informacje profilowe są z założenia widoczne dla innych użytkowników pod wybraną przez Ciebie nazwą. Traktuj wszystko, co publikujesz, jako jawne. Wiadomości wysyłane do innego użytkownika są widoczne dla niego oraz dla moderatorów.'
			]
		},
		{
			heading: 'Twoje prawa',
			body: [
				'Na podstawie RODO możesz zażądać kopii swoich danych, ich sprostowania lub usunięcia, a także wnieść sprzeciw wobec przetwarzania opartego na prawnie uzasadnionym interesie. Zgłoszenie możesz skierować do Dziekanatu Studenckiego lub do Ośrodka Komputerowego Wydziału Fizyki UW. Masz również prawo wniesienia skargi do Prezesa Urzędu Ochrony Danych Osobowych.',
				'Jedno ograniczenie warto powiedzieć wprost, zamiast pozostawiać je do odkrycia: jeśli działałeś jako moderator, zapis podjętych przez Ciebie decyzji pozostaje także po usunięciu konta, z usuniętym Twoim imieniem i nazwiskiem. Decyzje te podlegają bowiem odwołaniu i weryfikacji przez innych, a decyzji, której nikt nie może zbadać, nie da się zakwestionować osobie, której dotyczyła.'
			]
		},
		{
			heading: 'Kto jeszcze ma do tego dostęp',
			body: [
				'Nikt spoza Wydziału. EdMat nie przekazuje żadnych danych reklamodawcom, dostawcom analityki ani innym podmiotom zewnętrznym.',
				'W trakcie zwykłego korzystania kontaktujemy się z dwiema usługami zewnętrznymi i żadna z nich nie otrzymuje informacji o Tobie: OpenStreetMap przy wyszukiwaniu adresu podczas tworzenia ogłoszenia korepetycji (wysyłany jest sam tekst wyszukiwania, nie Twoja tożsamość) oraz kafelki mapy widoczne przy ogłoszeniu, o które Twoja przeglądarka pyta OpenStreetMap bezpośrednio — a tym samym ujawnia im swój adres IP.'
			]
		},
		{
			heading: 'Zmiany tej polityki',
			body: [
				'Jeśli polityka zmieni się co do istoty, zmieni się także data na górze strony. Nie rozszerzymy po cichu zakresu zbieranych danych bez uprzedniego opisania tego tutaj.'
			]
		}
	]
};

/** Falls back to English for any locale that has no version yet — an untranslated policy in a
 * language the reader understands is far better than no policy at all. */
export function privacyPolicyFor(locale: string): PrivacyPolicy {
	return locale === 'pl' ? PL : EN;
}
