// Chapter: tutoring listings and booking an hour. The route is /tutoring, or /korki in Polish.
import type { GuideChapterDoc } from './types';

const EN: GuideChapterDoc = {
	title: 'Tutoring',
	lead: [
		'A listing is one person offering to teach something, with the hours they are free. No money ever passes through this site — a price is a number on a page, and what you agree is between the two of you.'
	],
	steps: [
		{
			heading: 'The listings',
			tryHref: '/tutoring',
			body: [
				"Filter by subject and by whether the tutor works online or in person. Each card carries the rate the tutor quotes, the age band, the subject, the rating other students left, and the tutor's name.",
				'In Polish the page is at /korki, which is the word a Polish reader would search for; in English it is /tutoring. Both are the same page.'
			],
			screenshot: {
				src: '/guide/tutoring/01-listings.png',
				alt: 'The tutoring listings page: filters by branch and by format, and three listing cards with prices of 60 and 80 PLN per hour, their subjects and their tutors.'
			}
		},
		{
			heading: 'A listing',
			body: [
				'What the tutor teaches and how, who they are, and two links that matter: "Contact", which opens a message to them, and "Report", for a listing that should not be there.',
				'Below it is the part that does something: the hours.'
			],
			screenshot: {
				src: '/guide/tutoring/02-listing.png',
				alt: 'A tutoring listing: the title "Analiza — dyżur konsultacyjny", 60 PLN/h, the badges University and Online, the description, the tutor Ania Kowalczyk with Contact and Report links, and the start of the booking panel.'
			}
		},
		{
			heading: 'The free hours are real',
			body: [
				'The calendar shows the hours this tutor advertises, with the ones already taken removed — so an hour you can see is an hour you can ask for. List, week and month are three views of the same thing.',
				'On your own listing the panel says so, and sends you to your schedule instead.'
			],
			screenshot: {
				src: '/guide/tutoring/03-booking.png',
				alt: 'The "Book a session" panel: a note that these are the hours the tutor advertises, List / Week / Month views, a week of 5–11 October, and free hours on Tuesday 6 October.'
			}
		},
		{
			heading: 'Asking for an hour',
			body: [
				'Choosing an hour sends a request, not a booking: the panel says in one line that the tutor still has to confirm it, and links to your own bookings. The tutor is notified, and confirms or declines.',
				"All times are shown in the site's own timezone. There is no per-account timezone yet, so if you are not in Poland, do the arithmetic yourself."
			],
			screenshot: {
				src: '/guide/tutoring/04-requested.png',
				alt: 'The booking panel after choosing an hour, with a green line reading "Request sent — the tutor still has to confirm it." and a link to your bookings.'
			}
		},
		{
			heading: 'Putting up your own listing',
			tryHref: '/tutoring/new',
			body: [
				'"+ Add…" in the bar, then "New listing". A listing takes a description — which may contain mathematics, a chemical structure, a drawing or a picture, like everything else here — and the hours you are free, which you set once as a weekly pattern on your schedule page.'
			]
		}
	]
};

const PL: GuideChapterDoc = {
	title: 'Korepetycje',
	lead: [
		'Ogłoszenie to jedna osoba, która proponuje, że czegoś nauczy, wraz z godzinami, w których jest wolna. Przez ten serwis nie przechodzą żadne pieniądze — cena to liczba na stronie, a to, co ustalicie, jest sprawą między wami.'
	],
	steps: [
		{
			heading: 'Lista ogłoszeń',
			tryHref: '/tutoring',
			body: [
				'Filtr po przedmiocie i po tym, czy korepetytor uczy online czy na miejscu. Każdy kafelek niesie podaną stawkę, przedział wiekowy, przedmiot, ocenę od innych uczniów i nazwisko korepetytora.',
				'Po polsku strona jest pod /korki — bo takiego słowa szuka polski czytelnik — a po angielsku pod /tutoring. To ta sama strona.'
			],
			screenshot: {
				src: '/guide/tutoring/01-listings.png',
				alt: 'Strona ogłoszeń korepetycyjnych: filtry po przedmiocie i formie oraz trzy kafelki z cenami 60 i 80 PLN za godzinę, przedmiotami i nazwiskami korepetytorów.'
			}
		},
		{
			heading: 'Ogłoszenie',
			body: [
				'Czego i jak uczy dana osoba, kim jest, i dwa odnośniki, które mają znaczenie: „Contact”, który otwiera wiadomość do niej, oraz „Report” dla ogłoszenia, którego nie powinno tu być.',
				'Niżej część, która naprawdę coś robi: godziny.'
			],
			screenshot: {
				src: '/guide/tutoring/02-listing.png',
				alt: 'Ogłoszenie korepetycyjne: tytuł „Analiza — dyżur konsultacyjny”, 60 PLN/h, plakietki University i Online, opis, korepetytorka Ania Kowalczyk z odnośnikami Contact i Report oraz początek panelu rezerwacji.'
			}
		},
		{
			heading: 'Wolne godziny są prawdziwe',
			body: [
				'Kalendarz pokazuje godziny, które korepetytor ogłasza, z usuniętymi już zajętymi — więc godzina, którą widzisz, to godzina, o którą możesz poprosić. Lista, tydzień i miesiąc to trzy widoki tego samego.',
				'Na własnym ogłoszeniu panel mówi to wprost i odsyła do Twojego grafiku.'
			],
			screenshot: {
				src: '/guide/tutoring/03-booking.png',
				alt: 'Panel „Book a session”: informacja, że to godziny ogłaszane przez korepetytora, widoki List / Week / Month, tydzień 5–11 października i wolne godziny we wtorek 6 października.'
			}
		},
		{
			heading: 'Prośba o godzinę',
			body: [
				'Wybranie godziny wysyła prośbę, a nie rezerwację: panel pisze jednym zdaniem, że korepetytor musi ją jeszcze potwierdzić, i odsyła do Twoich rezerwacji. Korepetytor dostaje powiadomienie i potwierdza albo odmawia.',
				'Wszystkie godziny są pokazywane w strefie czasowej serwisu. Strefy per konto jeszcze nie ma, więc będąc poza Polską, trzeba przeliczyć samodzielnie.'
			],
			screenshot: {
				src: '/guide/tutoring/04-requested.png',
				alt: 'Panel rezerwacji po wybraniu godziny, z zielonym napisem „Request sent — the tutor still has to confirm it.” i odnośnikiem do Twoich rezerwacji.'
			}
		},
		{
			heading: 'Własne ogłoszenie',
			tryHref: '/tutoring/new',
			body: [
				'„+ Add…” na pasku, potem „New listing”. Ogłoszenie przyjmuje opis — w którym, jak wszędzie tutaj, mogą być wzory, struktura chemiczna, szkic albo obrazek — oraz godziny, w których jesteś wolny; te ustawia się raz, jako tygodniowy wzorzec, na stronie grafiku.'
			]
		}
	]
};

export function tutoringChapterFor(locale: string): GuideChapterDoc {
	return locale === 'en' ? EN : PL;
}
