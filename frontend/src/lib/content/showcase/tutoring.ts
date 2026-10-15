/**
 * `/about/tutoring` — listings, the hours a tutor publishes, and a booking that stays a request
 * until the tutor answers it.
 *
 * Written 2026-10-14 against `backend/services/`, `backend/booking/` (and their CLAUDE.md files),
 * `FINANCES.md` §1 and the routes under `routes/tutoring/` and `routes/bookings/`. Three things are
 * said plainly because a reader would otherwise assume them:
 *   - no money passes through EdMat — a rate on a listing is a number a tutor typed, not a price;
 *   - an unanswered request is never declined for you: requests do not expire (a known cost,
 *     `booking/models.py`);
 *   - which clock the hours are on: a tutor's weekly hours are wall-clock times the server reads
 *     in `settings.TIME_ZONE`, which is `Europe/Warsaw` since 2026-10-15 (owner: "stays poland"),
 *     and the slots are drawn in the reader's own browser zone — so 14:00 is 14:00 to anybody in
 *     Poland, and a reader abroad sees it converted. Until that day the setting was UTC and a
 *     Polish reader was offered 16:00 (summer) / 15:00 (winter); WP11 had said so here, and this
 *     point now says the fixed state. There is still no per-account time zone.
 *
 * The listings and listing pictures are the manual's own (`static/guide/tutoring/`), checked
 * against today's screen before reuse; the tutor's side is new (`e2e/showcase-screens.mjs`). The
 * live link goes to `/tutoring`, which a Polish reader sees as `/korki` (`hrefs.ts: liveHref`).
 *
 * See `content/showcase/index.ts` for why this text is here rather than in the catalogues.
 */

import type { ShowcaseModuleDoc } from './index';

const EN: ShowcaseModuleDoc = {
	title: 'Tutoring you can book',
	description:
		'How tutoring works on EdMat: a listing with the subjects and hours a tutor offers, a calendar of free slots, and a booking that is a request until the tutor confirms it — with no payment through the site.',
	lead: [
		'A tutor publishes a listing — what they teach, at what level, online or in person, and the rate they ask — and the hours they are available. A student picks a free slot on the listing’s calendar and sends a request; the tutor confirms it or declines it.',
		'EdMat handles the calendar and nothing else. No money passes through the site: the rate on a listing is what the tutor tells you to expect, and you settle it between yourselves.'
	],
	points: [
		{
			heading: 'A booking is always a request first',
			body: 'Nothing is ever booked behind a tutor’s back. Every booking starts as a request and becomes confirmed only when the tutor says so.'
		},
		{
			heading: 'The calendar knows what is taken',
			body: 'Busy time is counted across all of a tutor’s listings, and an event the tutor is hosting takes those hours off the calendar too, so the same hour is not offered twice.'
		},
		{
			heading: 'The hours are Polish time',
			body: 'A tutor’s weekly hours are plain clock times in Polish time, summer and winter alike: hours set as 14:00–17:00 are offered from 14:00 to anybody reading in Poland. Free slots and bookings are drawn in the time zone of the device you are reading on, so somebody reading from abroad sees the same hours on their own clock — from 13:00 in London, for example. There is no per-account time zone.'
		}
	],
	tryIt: [
		{ label: 'Browse tutoring listings', route: '/tutoring' },
		{ label: 'Your schedule', route: '/bookings' }
	],
	// The first two are the manual's (`e2e/guide-screenshots.mjs`); the third is
	// `e2e/showcase-screens.mjs`'s. All three looked at against today's screen before use.
	shots: [
		{
			src: '/guide/tutoring/01-listings.png',
			focus: [200, 1080],
			// The manual's shot runs on into the site footer; stop under the cards.
			focusY: [0, 530],
			width: 1280,
			height: 760,
			route: '/tutoring',
			alt: 'Screenshot of “Tutoring listings”: filters by subject and by format, then three listing cards — “Analiza — dyżur konsultacyjny” at 60 PLN/h online, “Mechanika klasyczna — zajęcia na miejscu” at 80 PLN/h in person at the Physics Faculty, and “Korepetycje z analizy — poziom licencjacki” online with one five-star review — each with its tutor’s name.',
			caption:
				'The listings: subject, level, online or in person, the rate the tutor asks, and their reviews.'
		},
		{
			src: '/guide/tutoring/02-listing.png',
			focus: [260, 1020],
			width: 1280,
			height: 560,
			route: '/tutoring',
			linkLabel: 'Open a listing',
			alt: 'Screenshot of one listing, “Analiza — dyżur konsultacyjny”, 60 PLN/h, online, with a Contact button, and under it “Book a session”: a note that these are the hours the tutor advertises and that the tutor will confirm or decline, List, Week and Month views, and three free hours on a Thursday.',
			caption:
				'One listing: a Contact button that opens a message, and the calendar of free hours to request one from.'
		},
		{
			src: '/showcase/tutoring/03-schedule.png',
			focus: [260, 1020],
			width: 1280,
			height: 466,
			route: '/bookings',
			alt: 'Screenshot of the tutor’s “My schedule”, tab “Requests for me (3)”: the first two of three requests from Michał Zieliński for “Analiza — dyżur konsultacyjny” on Thursday at 18:00, each marked Requested, each with a note that another live booking clashes with this time, and Confirm and Decline buttons.',
			caption:
				'The tutor’s side: each request waits for Confirm or Decline, and a clash with another booking is pointed out rather than hidden.'
		}
	],
	sections: [
		{
			key: 'listing',
			heading: 'A listing',
			body: [
				'A listing has a title, a description that may contain mathematics, the subjects it covers, the level it is for, the language, an hourly rate in złoty, euro or dollars, and whether lessons are online, in person or either. An in-person listing carries a place, found on a map from the address the tutor types. A tutor can pause a listing to take it off the board; a listing that still has a booking coming up cannot be deleted, only paused.',
				'Students filter the board by subject and by format, write to a tutor through the site’s messages, keep a watchlist of listings to compare, and leave one rating with an optional review per listing.'
			]
		},
		{
			key: 'availability',
			heading: 'Hours a tutor publishes',
			body: [
				'A tutor sets weekly hours — Tuesdays 16:00 to 19:00, say — and one-off changes on top: a day off, or extra hours on a particular date. For a week that does not look like the others, a tutor can lay out that one week by hand, and it replaces the weekly pattern for that week.',
				'A listing either shows the hours that are still free (the default), or always shows the whole advertised window and leaves it to the tutor to say which requests fit — the note above the calendar says which one you are looking at.'
			]
		},
		{
			key: 'booking',
			heading: 'A booking, from request to done',
			body: [
				'Picking a free hour sends a request. A request already holds the hour so nobody else can ask for it, and the tutor sees it under “Requests for me”. Either side can cancel later; marking a session as completed is done by hand, and only once its time is over.',
				'One honest gap: a request nobody answers is never declined automatically, so it holds its hour until the tutor answers it or the student cancels it.'
			],
			sample: {
				caption:
					'The five states a booking can be in, drawn as a list. Every booking starts in the first; only the tutor moves it to the second or third.',
				rows: [
					{ label: 'Requested', title: 'Sent by the student, holding the hour', note: 'start' },
					{ label: 'Confirmed', title: 'The tutor said yes', note: 'tutor' },
					{ label: 'Declined', title: 'The tutor said no', note: 'tutor' },
					{ label: 'Cancelled', title: 'Either side withdrew, and it says who', note: 'either' },
					{ label: 'Completed', title: 'Marked by hand after the session', note: 'after' }
				]
			}
		},
		{
			key: 'money',
			heading: 'No payment, on purpose',
			body: [
				'There is no payment of any kind on EdMat. The rate is shown so a student knows roughly what to expect; booking an hour moves no money, and a completed session is connected to nothing. Paying, and anything that follows from it, stays between the tutor and the student.'
			]
		}
	],
	closing:
		'Tutoring is one of the switches a moderator can turn off. When it is off, the listings, the schedule and every link to them leave the site together, and this page says so at the top.'
};

const PL: ShowcaseModuleDoc = {
	title: 'Korepetycje z rezerwacją',
	description:
		'Jak działają korepetycje w EdMacie: ogłoszenie z przedmiotami i godzinami korepetytora, kalendarz wolnych terminów i rezerwacja, która jest prośbą, dopóki korepetytor jej nie potwierdzi — bez żadnych płatności przez serwis.',
	lead: [
		'Korepetytor publikuje ogłoszenie — czego uczy, na jakim poziomie, zdalnie czy na miejscu i jaką stawkę proponuje — oraz godziny, w których jest dostępny. Uczeń albo studentka wybiera wolny termin w kalendarzu ogłoszenia i wysyła prośbę; korepetytor ją potwierdza albo odrzuca.',
		'EdMat zajmuje się kalendarzem i niczym więcej. Przez serwis nie przechodzą żadne pieniądze: stawka w ogłoszeniu to informacja, czego się spodziewać, a rozliczacie się między sobą.'
	],
	points: [
		{
			heading: 'Rezerwacja jest zawsze najpierw prośbą',
			body: 'Nic nie jest rezerwowane za plecami korepetytora. Każda rezerwacja zaczyna się jako prośba i staje się potwierdzona dopiero wtedy, gdy korepetytor tak zdecyduje.'
		},
		{
			heading: 'Kalendarz wie, co jest zajęte',
			body: 'Zajęty czas liczy się ze wszystkich ogłoszeń korepetytora, a wydarzenie, które prowadzi, też zdejmuje te godziny z kalendarza — więc ta sama godzina nie jest oferowana dwa razy.'
		},
		{
			heading: 'Godziny są w czasie polskim',
			body: 'Godziny tygodniowe korepetytora to zwykłe godziny zegarowe w czasie polskim, latem i zimą: godziny ustawione jako 14:00–17:00 każdy, kto czyta w Polsce, zobaczy od 14:00. Wolne terminy i rezerwacje pokazują się w strefie czasowej urządzenia, na którym czytasz, więc ktoś za granicą zobaczy te same godziny na swoim zegarze — na przykład w Londynie od 13:00. Stref czasowych przypisanych do konta nie ma.'
		}
	],
	tryIt: [
		{ label: 'Przejrzyj ogłoszenia', route: '/tutoring' },
		{ label: 'Twój grafik', route: '/bookings' }
	],
	shots: [
		{
			src: '/guide/tutoring/01-listings.png',
			focus: [200, 1080],
			// The manual's shot runs on into the site footer; stop under the cards.
			focusY: [0, 530],
			width: 1280,
			height: 760,
			route: '/tutoring',
			alt: 'Zrzut ekranu „Tutoring listings”: filtry według przedmiotu i formy, a pod nimi trzy karty ogłoszeń — „Analiza — dyżur konsultacyjny” za 60 zł/h zdalnie, „Mechanika klasyczna — zajęcia na miejscu” za 80 zł/h na Wydziale Fizyki i „Korepetycje z analizy — poziom licencjacki” zdalnie, z jedną recenzją na pięć gwiazdek — każde z nazwiskiem korepetytora.',
			caption:
				'Ogłoszenia: przedmiot, poziom, zdalnie czy na miejscu, stawka, której oczekuje korepetytor, i recenzje.'
		},
		{
			src: '/guide/tutoring/02-listing.png',
			focus: [260, 1020],
			width: 1280,
			height: 560,
			route: '/tutoring',
			linkLabel: 'Otwórz ogłoszenie',
			alt: 'Zrzut ekranu jednego ogłoszenia, „Analiza — dyżur konsultacyjny”, 60 zł/h, zdalnie, z przyciskiem Contact, a pod nim „Book a session”: uwaga, że to godziny ogłaszane przez korepetytora, który potwierdzi albo odrzuci prośbę, widoki List, Week i Month i trzy wolne godziny w czwartek.',
			caption:
				'Jedno ogłoszenie: przycisk kontaktu, który otwiera wiadomość, i kalendarz wolnych godzin, z których można poprosić o jedną.'
		},
		{
			src: '/showcase/tutoring/03-schedule.png',
			focus: [260, 1020],
			width: 1280,
			height: 466,
			route: '/bookings',
			alt: 'Zrzut ekranu „My schedule” korepetytorki, zakładka „Requests for me (3)”: pierwsze dwie z trzech próśb od Michała Zielińskiego o „Analiza — dyżur konsultacyjny” w czwartek o 18:00, obie oznaczone Requested, obie z uwagą, że koliduje z nimi inna aktywna rezerwacja, i z przyciskami Confirm i Decline.',
			caption:
				'Strona korepetytora: każda prośba czeka na „Potwierdź” albo „Odrzuć”, a kolizja z inną rezerwacją jest wskazana, a nie ukryta.'
		}
	],
	sections: [
		{
			key: 'listing',
			heading: 'Ogłoszenie',
			body: [
				'Ogłoszenie ma tytuł, opis, w którym może być matematyka, przedmioty, których dotyczy, poziom, język, stawkę godzinową w złotych, euro albo dolarach i informację, czy zajęcia są zdalnie, na miejscu, czy tak i tak. Ogłoszenie stacjonarne ma miejsce, odnalezione na mapie z adresu, który wpisuje korepetytor. Ogłoszenie można wstrzymać, żeby zniknęło z tablicy; ogłoszenia z nadchodzącą rezerwacją nie da się usunąć, można je tylko wstrzymać.',
				'Uczniowie filtrują tablicę według przedmiotu i formy, piszą do korepetytora przez wiadomości w serwisie, trzymają listę obserwowanych ogłoszeń do porównania i wystawiają jedną ocenę z opcjonalną recenzją na ogłoszenie.'
			]
		},
		{
			key: 'availability',
			heading: 'Godziny, które publikuje korepetytor',
			body: [
				'Korepetytor ustawia godziny tygodniowe — na przykład wtorki od 16:00 do 19:00 — i jednorazowe zmiany: dzień wolny albo dodatkowe godziny w konkretnym dniu. Tydzień, który wygląda inaczej niż pozostałe, można ułożyć ręcznie i wtedy zastępuje on tygodniowy wzór.',
				'Ogłoszenie pokazuje albo tylko godziny, które są jeszcze wolne (domyślnie), albo zawsze całe ogłoszone okno, a korepetytor sam mówi, które prośby pasują — uwaga nad kalendarzem mówi, na który wariant patrzysz.'
			]
		},
		{
			key: 'booking',
			heading: 'Rezerwacja, od prośby do końca',
			body: [
				'Wybranie wolnej godziny wysyła prośbę. Prośba od razu zajmuje tę godzinę, żeby nikt inny o nią nie poprosił, a korepetytor widzi ją w zakładce „Prośby do mnie”. Każda ze stron może później odwołać spotkanie; oznaczenie zajęć jako odbytych robi się ręcznie i dopiero po ich czasie.',
				'Jedna uczciwa luka: prośba, na którą nikt nie odpowie, nigdy nie jest odrzucana automatycznie, więc trzyma swoją godzinę, dopóki korepetytor nie odpowie albo uczeń jej nie odwoła.'
			],
			sample: {
				caption:
					'Pięć stanów, w których może być rezerwacja, narysowanych jako lista. Każda rezerwacja zaczyna się w pierwszym; do drugiego albo trzeciego przenosi ją tylko korepetytor.',
				rows: [
					{ label: 'Prośba', title: 'Wysłana przez ucznia, zajmuje godzinę', note: 'start' },
					{ label: 'Potwierdzona', title: 'Korepetytor powiedział „tak”', note: 'korepetytor' },
					{ label: 'Odrzucona', title: 'Korepetytor powiedział „nie”', note: 'korepetytor' },
					{
						label: 'Odwołana',
						title: 'Któraś ze stron się wycofała — i widać która',
						note: 'obie strony'
					},
					{ label: 'Odbyta', title: 'Oznaczona ręcznie po zajęciach', note: 'po zajęciach' }
				]
			}
		},
		{
			key: 'money',
			heading: 'Bez płatności, celowo',
			body: [
				'W EdMacie nie ma żadnych płatności. Stawka jest pokazana, żeby uczeń wiedział mniej więcej, czego się spodziewać; zarezerwowanie godziny nie przesuwa żadnych pieniędzy, a odbyte zajęcia nie są z niczym połączone. Płatność i wszystko, co z niej wynika, zostaje między korepetytorem a uczniem.'
			]
		}
	],
	closing:
		'Korepetycje to jedna z funkcji, które moderator może wyłączyć. Gdy są wyłączone, ogłoszenia, grafik i wszystkie linki do nich znikają z serwisu razem, a ta strona mówi o tym na samej górze.'
};

export function tutoringShowcaseFor(locale: string): ShowcaseModuleDoc {
	return locale === 'pl' ? PL : EN;
}
