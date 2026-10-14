// Chapter: one-off events, their programme, registration, and the conference layer in a paragraph.
import type { GuideChapterDoc } from './types';

const EN: GuideChapterDoc = {
	title: 'Events',
	lead: [
		'An event is a one-off: a guest lecture, a workshop, a revision session before an exam. It is neither a course, which runs over weeks, nor an hour booked with a tutor.'
	],
	steps: [
		{
			heading: 'What is coming up',
			tryHref: '/events',
			body: [
				'Two tabs — what is still ahead, and what has already happened. Each card carries the date and time, who is hosting, whether it is in person or online, and how many places are left.'
			],
			screenshot: {
				src: '/guide/events/01-hub.png',
				alt: 'The events page with the "Coming up" tab selected and one card: a conference on Monday 19 October at 11:00, hosted by Anna Organiser, in person, 38 of 40 places left.'
			}
		},
		{
			heading: 'The event page, and saying you are coming',
			body: [
				'A box at the top answers four questions at once: when, who can see this, where, and who is coming. Underneath is either "Register" and "I cannot come", or — if you are not signed in — a line saying so and a link to the log-in page.',
				'Where an event asks for a registration rather than a yes/no, there is a form, and there may be a waiting list. If a seat frees up you are told, and you have a stated number of hours to confirm it.'
			],
			screenshot: {
				src: '/guide/events/02-event.png',
				alt: 'An event page: the title, who is hosting, and a box reading When, Who can see this, Where and Who is coming, with a note that a visitor must sign in to say whether they are coming.'
			}
		},
		{
			heading: 'The programme',
			body: [
				'Sessions, grouped by day, each with its time, its room and what kind of thing it is — a talk, a workshop, something else. "Add to my agenda" builds your own timetable through the event; "Add to calendar (.ics)" hands the whole thing to your calendar app.',
				'A session with a seat limit says how many are left and lets you take one. "Questions" is that session\'s own thread.'
			],
			screenshot: {
				src: '/guide/events/03-programme.png',
				alt: 'The programme of an event: Monday 19 October with an opening lecture and an exercises workshop (Seats: 0/12), and Tuesday 20 October with a closing round table, all in Room A.'
			}
		},
		{
			heading: 'A bigger event has more under it',
			body: [
				'Everything a conference needs hangs off the same page rather than off a different app: a call for proposals with its own deadline, documents the organisers share with the people who need them, help wanted, dated updates the host appends after the announcement, and the list of who is coming.',
				'Rooms and buildings, volunteer shifts with a printable certificate of hours, tickets and a cloakroom desk are all part of the same layer. Each answers to its own switch, so a small event never shows a feature it does not use.'
			],
			screenshot: {
				src: '/guide/events/04-conference.png',
				alt: 'The lower half of an event page: Proposals with a deadline, Documents, Help wanted, Updates and Who is coming.'
			}
		}
	],
	note: 'The desk applications a big conference uses — the ticket scanner, the cloakroom, the shifts rota — are not written up in this manual yet.'
};

const PL: GuideChapterDoc = {
	title: 'Wydarzenia',
	lead: [
		'Wydarzenie to coś jednorazowego: wykład gościnny, warsztat, powtórka przed egzaminem. To nie kurs, który ciągnie się tygodniami, ani godzina umówiona z korepetytorem.'
	],
	steps: [
		{
			heading: 'Co się szykuje',
			tryHref: '/events',
			body: [
				'Dwie zakładki — co dopiero będzie i co już było. Każdy kafelek niesie datę i godzinę, kto prowadzi, czy to spotkanie na żywo czy online, i ile zostało miejsc.'
			],
			screenshot: {
				src: '/guide/events/01-hub.png',
				alt: 'Strona wydarzeń z zakładką „Coming up” i jednym kafelkiem: konferencja w poniedziałek 19 października o 11:00, prowadzi Anna Organiser, na żywo, 38 z 40 miejsc wolnych.'
			}
		},
		{
			heading: 'Strona wydarzenia i zgłoszenie obecności',
			body: [
				'Ramka u góry odpowiada naraz na cztery pytania: kiedy, kto to widzi, gdzie i kto przychodzi. Pod nią albo „Register” i „I cannot come”, albo — jeśli nie jesteś zalogowany — zdanie o tym i odnośnik do logowania.',
				'Tam, gdzie wydarzenie prosi o rejestrację zamiast zwykłego „będę”, jest formularz, a bywa i lista rezerwowa. Kiedy zwolni się miejsce, dostaniesz powiadomienie i podaną liczbę godzin na potwierdzenie.'
			],
			screenshot: {
				src: '/guide/events/02-event.png',
				alt: 'Strona wydarzenia: tytuł, prowadząca i ramka z wierszami When, Who can see this, Where i Who is coming, z informacją, że gość musi się zalogować, by zadeklarować obecność.'
			}
		},
		{
			heading: 'Program',
			body: [
				'Sesje pogrupowane dniami, każda z godziną, salą i rodzajem — wykład, warsztat, coś innego. „Add to my agenda” składa Twój własny plan na to wydarzenie; „Add to calendar (.ics)” oddaje całość Twojemu kalendarzowi.',
				'Sesja z limitem miejsc mówi, ile zostało, i pozwala zająć jedno. „Questions” to jej własny wątek.'
			],
			screenshot: {
				src: '/guide/events/03-programme.png',
				alt: 'Program wydarzenia: poniedziałek 19 października z wykładem otwierającym i warsztatem zadaniowym (Seats: 0/12) oraz wtorek 20 października z panelem zamykającym, wszystko w Room A.'
			}
		},
		{
			heading: 'Większe wydarzenie ma pod spodem więcej',
			body: [
				'Wszystko, czego potrzebuje konferencja, wisi na tej samej stronie, a nie w osobnej aplikacji: nabór zgłoszeń z własnym terminem, dokumenty udostępniane przez organizatorów tym, którzy ich potrzebują, szukanie pomocy, datowane aktualności dopisywane po ogłoszeniu i lista przychodzących.',
				'Sale i budynki, dyżury wolontariuszy z zaświadczeniem o godzinach do wydruku, bilety i szatnia to części tej samej warstwy. Każda ma własny wyłącznik, więc małe wydarzenie nigdy nie pokazuje funkcji, z której nie korzysta.'
			],
			screenshot: {
				src: '/guide/events/04-conference.png',
				alt: 'Dolna część strony wydarzenia: Proposals z terminem, Documents, Help wanted, Updates i Who is coming.'
			}
		}
	],
	note: 'Aplikacje stanowiskowe dużej konferencji — skaner biletów, szatnia, grafik dyżurów — nie są jeszcze opisane w tym podręczniku.'
};

export function eventsChapterFor(locale: string): GuideChapterDoc {
	return locale === 'en' ? EN : PL;
}
