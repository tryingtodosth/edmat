/**
 * `/about/conference` — the conference layer: a building and its rooms, documents by who may read
 * them, tickets scanned at the door, a volunteer rota and a cloakroom desk.
 *
 * Written 2026-10-14 against `CONFERENCE-BRIEF.md` and `backend/{venues,documents,shifts,
 * cloakroom,events}/` with their CLAUDE.md files. The brief's own numbers are out of date in places
 * (its "146 registrations" demo now has a dozen attendee accounts, HISTORY.md §17CC), so nothing
 * here is quoted from the brief that was not found in the code.
 *
 * **Every screenshot is of the seeded demonstration conference** (`seed_conference_demo`, its title
 * prefixed `TEST=FAKE `): every person, talk and figure on it is invented, and the captions say so.
 * The ticket, scanner, rota and cloakroom pictures carry NO "open the real page" link: each of
 * those pages sits behind an event id and an attendee or staff right, so a link would only take a
 * visitor to a refusal (`ShowcaseShot.route` is optional for exactly this). The way in is
 * `/conference`, which forwards to the demo event wherever it was seeded.
 *
 * See `content/showcase/index.ts` for why this text is here rather than in the catalogues.
 */

import type { ShowcaseModuleDoc } from './index';

const EN: ShowcaseModuleDoc = {
	title: 'Running a conference',
	description:
		'What EdMat gives the people running a conference: the building and its rooms, documents by who may read them, tickets scanned at the door, a volunteer rota with counted hours, and a cloakroom desk.',
	lead: [
		'An event on EdMat can be a one-hour lecture or a two-day conference. For the second, it grows a set of tools the people running it use on the day: the building it is in, the documents the team needs, tickets checked at the door, the volunteer rota and the cloakroom.',
		'Each tool is its own part of the site with its own switch, and each one shows only to the people it is for — a door scanner to the people working the door, a ticket to the person it belongs to.'
	],
	points: [
		{
			heading: 'Shown here on an invented conference',
			body: 'Every picture on this page is of a demonstration event whose name starts with “TEST=FAKE”. The people, talks and numbers on it are made up; the screens are the real ones.'
		},
		{
			heading: 'A ticket carries a code, nothing else',
			body: 'The QR code on a ticket holds a random code and no personal data. Whoever holds it can get a new one at any time, and the old one stops working at once.'
		},
		{
			heading: 'The rules for under-16s are fixed, not optional',
			body: 'A volunteer under 16 cannot take a shift before consent is recorded, nor one that touches 22:00–06:00, nor more than seven hours in a day — the rota refuses it and says why.'
		}
	],
	tryIt: [
		{ label: 'Open the demo conference', route: '/conference' },
		{ label: 'All events', route: '/events' },
		{ label: 'Venues', route: '/venues' },
		{ label: 'Your volunteering hours', route: '/volunteering/hours' }
	],
	// Screenshots of the running site (`e2e/showcase-screens.mjs`), each looked at before it was used.
	shots: [
		{
			src: '/showcase/conference/01-event.png',
			focus: [250, 1030],
			width: 1280,
			height: 946,
			route: '/conference',
			alt: 'Screenshot of the demo conference’s page as its organiser sees it: “You are running this” with Edit and Cancel this event, then a stack of folded panels — Programme 20, Proposals 7, Your registration questions 4, Registrations 14, Who runs this event 17, Venue and room 10, The building’s checklist 1, Documents 10, Tickets, Volunteer rota 28, Cloakroom 1.',
			caption:
				'The organiser’s view of the invented demo conference: one folded panel per tool, each with a count.'
		},
		{
			src: '/showcase/conference/02-venue.png',
			focus: [260, 1020],
			width: 1280,
			height: 786,
			route: '/venues',
			alt: 'Screenshot of the demo venue “Wydział Fizyki UW — Pasteura 5 (demo)”: its address, a contact note saying room numbers and capacities in the demo are illustrative, a porter’s lodge number, and six rooms, each with its floor, seats, fire capacity and pills for step-free access and AV equipment.',
			caption:
				'A building and its rooms: seats, fire capacity, step-free access and equipment. This one is a demo; its numbers are illustrative.'
		},
		{
			src: '/showcase/conference/03-ticket.png',
			width: 440,
			height: 720,
			alt: 'Screenshot of a ticket for “TEST=FAKE Dni Dydaktyki Fizyki 2026” in the name of Kasia Attendee: a QR code, a short code to read out if the camera fails, when and where, the time she left, and buttons Print this badge and Get a new code.',
			caption:
				'An attendee’s ticket (an invented one): a QR code, a short code to read out instead, and a button to replace the code.'
		},
		{
			src: '/showcase/conference/04-scan.png',
			width: 600,
			height: 580,
			alt: 'Screenshot of the Door scanner for the demo conference: a choice between Coming in and Going out, a Use the camera button, a field to type a code, a field to find somebody by first name, and a line saying how many scans are waiting to be sent and that a list of 12 people is loaded.',
			caption:
				'The door scanner, seen only by the people working the door: camera, a typed code or a name, coming in or going out — and it keeps working offline.'
		},
		{
			src: '/showcase/conference/05-rota.png',
			focus: [190, 1090],
			width: 1280,
			height: 560,
			alt: 'Screenshot of the printable volunteer rota for the first day of the demo conference: a table of time, station, where and who — registration, cloakroom, information point, room support — with invented volunteers’ names.',
			caption: 'The rota, ready to print and pin on the wall. The names are invented.'
		},
		{
			src: '/showcase/conference/06-cloakroom.png',
			focus: [180, 1100],
			width: 1280,
			height: 740,
			alt: 'Screenshot of the cloakroom desk for the demo conference: “2 on the racks · 4 handed back · 22 hooks free”, buttons Take something in, Hand something back, The racks and Close the desk, and a grid of hooks A01 to B12, two of them taken by a backpack, with a field “What it looks like (optional)”.',
			caption:
				'The cloakroom desk: pick a free hook, describe the item if you like, print the slip. No item is ever linked to a person.'
		}
	],
	sections: [
		{
			key: 'venue',
			heading: 'The building and its rooms',
			body: [
				'A venue is a building with an address, a contact note and a porter’s number, and rooms with their seats, fire capacity, step-free access and equipment. The building has its own staff — administrators and porters — who approve or turn down an event’s request for a room.',
				'A building hands out checklists — fire safety, catering, a school group with children — and an event that books a room gets a copy to work through. While a required item is still open, the event cannot be published. There is no map and no calendar of the building’s bookings yet.'
			]
		},
		{
			key: 'documents',
			heading: 'Documents, by who may read them',
			body: [
				'The team shares files and links on the event, each set to one of five audiences: everybody, attendees, staff, organisers — each a wider circle inside the next — or the building’s own administrators. Somebody outside a document’s audience does not see it at all. Only PDFs and images are accepted, rebuilt or checked the same way as every other upload.',
				'A document can be marked as one everybody on the team must read. Then a volunteer who has not opened it cannot check people in, scan tickets or work the cloakroom until they have — the briefing comes before the shift. Replacing a document keeps the old version and who read it.'
			]
		},
		{
			key: 'tickets',
			heading: 'Tickets and the door',
			body: [
				'A ticket is issued the moment somebody has a place. It shows a QR code and a short code, prints as a badge, and can be given a new code by its holder. Organisers can print a whole sheet of badges; badges for under-16s show only a first name and an initial.',
				'At the door, the people on the event’s team scan by camera, type the short code, or find somebody by name, choosing “coming in” or “going out”. Scans are kept on the device if the connection drops and sent when it comes back; the server decides each one. Not built: scanning per session, wallet passes, an app.'
			],
			sample: {
				caption:
					'The six answers the door scanner can give, drawn as a list. The volunteer reads the left-hand word; the right-hand note is when it happens.',
				rows: [
					{ label: 'Admitted', title: 'A valid ticket, coming in', note: 'first time in' },
					{ label: 'Already in', title: 'Nothing changed', note: 'either way' },
					{ label: 'Exited', title: 'A valid ticket, going out', note: 'was inside' },
					{ label: 'Not going', title: 'The ticket’s holder withdrew', note: 'refused' },
					{ label: 'Unknown', title: 'No ticket has this code', note: 'refused' },
					{
						label: 'Collision',
						title: 'One code in twice before the scans were sent',
						note: 'flagged'
					}
				]
			}
		},
		{
			key: 'shifts',
			heading: 'The volunteer rota',
			body: [
				'The organisers set up stations — registration, cloakroom, a room — and shifts at each. Volunteers take shifts themselves, and the organisers can put anybody from the team on one. A volunteer can hand a shift back until four hours before it starts.',
				'After a shift, an organiser marks it done, and its hours count — the length of the shift, or a corrected number with a note. Every volunteer sees their own hours across events and can print an unsigned certificate of service. Not built: swapping shifts, and any message telling somebody they have been put on one.'
			]
		},
		{
			key: 'cloakroom',
			heading: 'The cloakroom',
			body: [
				'A cloakroom desk has rails of numbered hooks. Taking something in picks a free hook and prints a slip with a QR code and a large number; handing it back is a scan or the typed code. For a lost slip, the clerk notes what the item looks like and what kind of ID was shown — never its number — and the lost code stops working at that desk.',
				'Closing the desk turns whatever is still hanging into “unclaimed”, which the organiser gets as a list. At no point is an item tied to a person’s account.'
			]
		},
		{
			key: 'preview',
			heading: 'Seeing the event as somebody else',
			body: [
				'An organiser can look at the event page as a signed-out visitor sees it — the page is simply asked for again without the organiser’s sign-in, under a bar that says so — or laid out as somebody who is coming would see it. Nobody is ever signed in as anybody else. It is how a team checks, before the doors open, that what is meant for attendees is not showing to the public.'
			]
		}
	],
	closing:
		'The demo conference is there to be looked at. Its organiser, porter, volunteers and attendees are seeded demonstration accounts, not people — which is why every name on this page can be shown.'
};

const PL: ShowcaseModuleDoc = {
	title: 'Prowadzenie konferencji',
	description:
		'Co EdMat daje osobom prowadzącym konferencję: budynek i jego sale, dokumenty według tego, kto może je czytać, bilety skanowane przy wejściu, grafik wolontariuszy z liczonymi godzinami i szatnię.',
	lead: [
		'Wydarzenie w EdMacie może być godzinnym wykładem albo dwudniową konferencją. W tym drugim przypadku dostaje zestaw narzędzi, z których zespół korzysta w dniu wydarzenia: budynek, w którym się odbywa, dokumenty potrzebne zespołowi, bilety sprawdzane przy wejściu, grafik wolontariuszy i szatnię.',
		'Każde narzędzie jest osobną częścią serwisu z własnym przełącznikiem i każde pokazuje się tylko tym, dla których jest — skaner osobom pilnującym wejścia, bilet osobie, do której należy.'
	],
	points: [
		{
			heading: 'Pokazane na wymyślonej konferencji',
			body: 'Każdy obrazek na tej stronie pochodzi z wydarzenia demonstracyjnego, którego nazwa zaczyna się od „TEST=FAKE”. Ludzie, wystąpienia i liczby są zmyślone; ekrany są prawdziwe.'
		},
		{
			heading: 'Bilet niesie kod i nic więcej',
			body: 'Kod QR na bilecie zawiera losowy ciąg znaków i żadnych danych osobowych. Osoba, do której należy bilet, może w każdej chwili dostać nowy kod, a stary od razu przestaje działać.'
		},
		{
			heading: 'Zasady dla osób poniżej 16 lat są stałe, nie opcjonalne',
			body: 'Wolontariusz poniżej 16 lat nie weźmie dyżuru, zanim nie zostanie zapisana zgoda, ani takiego, który zahacza o godziny 22:00–06:00, ani więcej niż siedem godzin dziennie — grafik tego nie przyjmie i powie dlaczego.'
		}
	],
	tryIt: [
		{ label: 'Otwórz konferencję demonstracyjną', route: '/conference' },
		{ label: 'Wszystkie wydarzenia', route: '/events' },
		{ label: 'Budynki', route: '/venues' },
		{ label: 'Twoje godziny wolontariatu', route: '/volunteering/hours' }
	],
	shots: [
		{
			src: '/showcase/conference/01-event.png',
			focus: [250, 1030],
			width: 1280,
			height: 946,
			route: '/conference',
			alt: 'Zrzut ekranu strony konferencji demonstracyjnej tak, jak widzi ją organizatorka: „You are running this” z przyciskami Edit i Cancel this event, a pod spodem stos zwiniętych paneli — Programme 20, Proposals 7, Your registration questions 4, Registrations 14, Who runs this event 17, Venue and room 10, The building’s checklist 1, Documents 10, Tickets, Volunteer rota 28, Cloakroom 1.',
			caption:
				'Widok organizatorki wymyślonej konferencji demonstracyjnej: jeden zwinięty panel na każde narzędzie, każdy z licznikiem.'
		},
		{
			src: '/showcase/conference/02-venue.png',
			focus: [260, 1020],
			width: 1280,
			height: 786,
			route: '/venues',
			alt: 'Zrzut ekranu budynku demonstracyjnego „Wydział Fizyki UW — Pasteura 5 (demo)”: adres, notka kontaktowa mówiąca, że numery sal i pojemności w demo są przykładowe, numer portierni i sześć sal, każda z piętrem, liczbą miejsc, pojemnością przeciwpożarową i oznaczeniami wejścia bez schodów i sprzętu AV.',
			caption:
				'Budynek i jego sale: miejsca, pojemność przeciwpożarowa, wejście bez schodów i sprzęt. To jest demo; liczby są przykładowe.'
		},
		{
			src: '/showcase/conference/03-ticket.png',
			width: 440,
			height: 720,
			alt: 'Zrzut ekranu biletu na „TEST=FAKE Dni Dydaktyki Fizyki 2026” na nazwisko Kasia Attendee: kod QR, krótki kod do odczytania na głos, gdy kamera zawiedzie, kiedy i gdzie, godzina wyjścia oraz przyciski Print this badge i Get a new code.',
			caption:
				'Bilet uczestniczki (wymyślonej): kod QR, krótki kod do odczytania zamiast niego i przycisk wymiany kodu.'
		},
		{
			src: '/showcase/conference/04-scan.png',
			width: 600,
			height: 580,
			alt: 'Zrzut ekranu skanera „Door scanner” dla konferencji demonstracyjnej: wybór między Coming in i Going out, przycisk Use the camera, pole do wpisania kodu, pole do szukania kogoś po imieniu i linia mówiąca, ile skanów czeka na wysłanie i że wczytano listę 12 osób.',
			caption:
				'Skaner przy wejściu, widoczny tylko dla osób pilnujących drzwi: kamera, wpisany kod albo imię, wejście albo wyjście — i działa też bez internetu.'
		},
		{
			src: '/showcase/conference/05-rota.png',
			focus: [190, 1090],
			width: 1280,
			height: 560,
			alt: 'Zrzut ekranu grafiku wolontariuszy do druku na pierwszy dzień konferencji demonstracyjnej: tabela z godziną, stanowiskiem, miejscem i osobami — rejestracja, szatnia, punkt informacyjny, obsługa sal — z wymyślonymi nazwiskami wolontariuszy.',
			caption: 'Grafik gotowy do wydruku i powieszenia na ścianie. Nazwiska są wymyślone.'
		},
		{
			src: '/showcase/conference/06-cloakroom.png',
			focus: [180, 1100],
			width: 1280,
			height: 740,
			alt: 'Zrzut ekranu stanowiska szatni na konferencji demonstracyjnej: „2 on the racks · 4 handed back · 22 hooks free”, przyciski Take something in, Hand something back, The racks i Close the desk oraz siatka wieszaków od A01 do B12, z których dwa zajmuje plecak, i pole „What it looks like (optional)”.',
			caption:
				'Szatnia: wybierz wolny wieszak, opisz rzecz, jeśli chcesz, wydrukuj numerek. Żadna rzecz nigdy nie jest powiązana z osobą.'
		}
	],
	sections: [
		{
			key: 'venue',
			heading: 'Budynek i jego sale',
			body: [
				'Budynek ma adres, notkę kontaktową i numer portierni, a sale mają liczbę miejsc, pojemność przeciwpożarową, informację o wejściu bez schodów i sprzęcie. Budynek ma własny zespół — administratorów i portierów — który zatwierdza albo odrzuca prośbę wydarzenia o salę.',
				'Budynek udostępnia listy kontrolne — bezpieczeństwo pożarowe, catering, grupa szkolna z dziećmi — a wydarzenie, które rezerwuje salę, dostaje kopię do przejścia. Dopóki wymagany punkt jest otwarty, wydarzenia nie da się opublikować. Nie ma jeszcze mapy ani kalendarza rezerwacji budynku.'
			]
		},
		{
			key: 'documents',
			heading: 'Dokumenty według tego, kto może je czytać',
			body: [
				'Zespół udostępnia na wydarzeniu pliki i linki, każdy dla jednej z pięciu grup: wszystkich, uczestników, obsługi, organizatorów — każda kolejna to węższy krąg w poprzednim — albo dla administratorów budynku. Ktoś spoza grupy w ogóle nie widzi dokumentu. Przyjmowane są tylko PDF-y i obrazy, odbudowywane albo sprawdzane tak samo jak każdy inny przesłany plik.',
				'Dokument można oznaczyć jako obowiązkowy do przeczytania dla całego zespołu. Wtedy wolontariusz, który go nie otworzył, nie może rejestrować osób, skanować biletów ani obsługiwać szatni, dopóki tego nie zrobi — odprawa jest przed dyżurem. Podmiana dokumentu zachowuje starą wersję i to, kto ją przeczytał.'
			]
		},
		{
			key: 'tickets',
			heading: 'Bilety i wejście',
			body: [
				'Bilet powstaje w chwili, gdy ktoś ma miejsce. Pokazuje kod QR i krótki kod, drukuje się jako identyfikator, a jego właściciel może wygenerować nowy kod. Organizatorzy mogą wydrukować cały arkusz identyfikatorów; na identyfikatorach osób poniżej 16 lat jest tylko imię i inicjał.',
				'Przy wejściu osoby z zespołu wydarzenia skanują kamerą, wpisują krótki kod albo szukają kogoś po imieniu, wybierając „wejście” albo „wyjście”. Gdy zniknie internet, skany czekają na urządzeniu i wysyłają się, gdy wróci; o każdym decyduje serwer. Czego nie ma: skanowania na poszczególne sesje, biletów w portfelu telefonu, aplikacji.'
			],
			sample: {
				caption:
					'Sześć odpowiedzi, które może dać skaner przy wejściu, narysowanych jako lista. Wolontariusz odczytuje słowo z lewej; notka z prawej mówi, kiedy się pojawia.',
				rows: [
					{ label: 'Wpuszczony', title: 'Ważny bilet, wejście', note: 'pierwsze wejście' },
					{ label: 'Już w środku', title: 'Nic się nie zmieniło', note: 'w obie strony' },
					{ label: 'Wyszedł', title: 'Ważny bilet, wyjście', note: 'był w środku' },
					{ label: 'Nie idzie', title: 'Właściciel biletu się wypisał', note: 'odmowa' },
					{ label: 'Nieznany', title: 'Żaden bilet nie ma tego kodu', note: 'odmowa' },
					{
						label: 'Kolizja',
						title: 'Jeden kod wszedł dwa razy, zanim skany się wysłały',
						note: 'oznaczone'
					}
				]
			}
		},
		{
			key: 'shifts',
			heading: 'Grafik wolontariuszy',
			body: [
				'Organizatorzy tworzą stanowiska — rejestracja, szatnia, sala — i dyżury na każdym z nich. Wolontariusze sami biorą dyżury, a organizatorzy mogą wpisać na dyżur każdego z zespołu. Wolontariusz może oddać dyżur do czterech godzin przed jego początkiem.',
				'Po dyżurze organizator oznacza go jako odbyty i jego godziny się liczą — długość dyżuru albo poprawiona liczba z notką. Każdy wolontariusz widzi swoje godziny ze wszystkich wydarzeń i może wydrukować niepodpisane zaświadczenie o wolontariacie. Czego nie ma: zamiany dyżurów i jakiejkolwiek wiadomości, że ktoś został na dyżur wpisany.'
			]
		},
		{
			key: 'cloakroom',
			heading: 'Szatnia',
			body: [
				'Stanowisko szatni ma wieszaki z numerami. Przyjęcie rzeczy wybiera wolny wieszak i drukuje numerek z kodem QR i dużą liczbą; wydanie to skan albo wpisany kod. Przy zgubionym numerku osoba w szatni zapisuje, jak wygląda rzecz i jakiego rodzaju dokument został pokazany — nigdy jego numer — a zgubiony kod przestaje działać przy tym stanowisku.',
				'Zamknięcie szatni zamienia wszystko, co jeszcze wisi, w „nieodebrane”, a organizator dostaje to jako listę. Żadna rzecz nie jest w żadnym momencie powiązana z czyimś kontem.'
			]
		},
		{
			key: 'preview',
			heading: 'Spojrzenie na wydarzenie oczami kogoś innego',
			body: [
				'Organizator może zobaczyć stronę wydarzenia tak, jak widzi ją osoba niezalogowana — strona jest po prostu pobierana jeszcze raz bez jego logowania, pod paskiem, który to mówi — albo ułożoną tak, jak zobaczy ją ktoś, kto przychodzi. Nikt nigdy nie loguje się jako ktoś inny. Tak zespół sprawdza, zanim otworzą się drzwi, czy to, co jest dla uczestników, nie jest widoczne publicznie.'
			]
		}
	],
	closing:
		'Konferencja demonstracyjna jest po to, żeby ją oglądać. Jej organizatorka, portier, wolontariusze i uczestnicy to konta demonstracyjne, a nie prawdziwi ludzie — dlatego każde nazwisko na tej stronie może być pokazane.'
};

export function conferenceShowcaseFor(locale: string): ShowcaseModuleDoc {
	return locale === 'pl' ? PL : EN;
}
