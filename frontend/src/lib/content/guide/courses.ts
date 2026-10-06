// Chapter: courses people run here — joining one, and running one.
import type { GuideChapterDoc } from './types';

const EN: GuideChapterDoc = {
	title: 'Courses',
	lead: [
		'A course is something a person runs and other people join: a set of chapters and lessons built out of the exercises and materials that are already here. It is not the same thing as a university subject — that is the taxonomy you browse, and it lives under "Exercises".'
	],
	steps: [
		{
			heading: 'Finding one',
			body: [
				'Every course that is listed shows who runs it, how many people are taking part, which age band it is for and which subject it belongs to. The tick box narrows the list to courses you are already in.',
				'Not every course is here. A course starts out visible to nobody but its own staff, and the person running it decides when — and whether — to list it publicly. Some are only reachable by an invite link.'
			],
			screenshot: {
				src: '/guide/courses/01-hub.png',
				alt: 'The courses page: two course cards, "Analiza od zera" run by Ania Kowalczyk with three people taking part, and "Analiza matematyczna dla początkujących", each marked OPEN.'
			}
		},
		{
			heading: 'The course page',
			body: [
				'The description, then two boxes that are worth reading before you join: "What it covers" — the claims about this course that other people have voted on — and "What\'s required" — what you are expected to know already.',
				'Then "Join this course". Where joining needs the organiser\'s approval, or the course is full, the button says so instead of failing silently.'
			],
			screenshot: {
				src: '/guide/courses/05-join.png',
				alt: 'A course page seen by somebody who has not joined: title, who runs it, the description, the "What it covers" and "What\'s required" boxes, and a "Join this course" button.'
			}
		},
		{
			heading: 'Chapters, lessons and what is in them',
			body: [
				'Content is one list: chapters, lessons inside them, and inside a lesson the exercises, materials, files, links and discussion points the person running it has put there. A whole saved set can be linked into a lesson in one go.',
				'The line under each lesson — "0 of 3 have finished this" — is what the participants themselves have said, not a measurement of anything. Who sees the names and who sees only the count is one decision the organiser makes for the whole course.'
			],
			screenshot: {
				src: '/guide/courses/03-content.png',
				alt: 'The Content section of a course: the chapter "Program" with lessons "Ciągi i granice" and "Szeregi liczbowe", each with "Link a saved set", a progress line reading "0 of 3 have finished this", and a discussion toggle.'
			}
		},
		{
			heading: 'Running one',
			body: [
				'Everything for the person running it is on one page, reached from "Manage this course": the queue of content other people have offered, the chapters, the people who help run it and their roles, and the invite links.',
				'Somebody is added to the team by their account id — there is no people search yet, so the number from their profile address is what the form wants. An invite link lets a person in past the approval queue but never over the seat limit.'
			],
			screenshot: {
				src: '/guide/courses/04-manage.png',
				alt: 'The "Manage this course" page: a "Waiting for review" section, a form for adding a chapter, a "Who runs this" section with the owner and an Account ID field, and an "Invite links" section.'
			}
		},
		{
			heading: 'The rest of the page',
			body: [
				"Underneath the content there is a search box that looks only inside this course — a chapter, a lesson, a file, something somebody said in a discussion — and tabs for the course's files, your own private notes, the discussion and the people."
			],
			screenshot: {
				src: '/guide/courses/02-course.png',
				alt: 'A course page seen by the person running it: Edit and Delete buttons, a "Manage this course" link, a search box for the course, and the Content / Files / My notes / Discussion / People tabs.'
			}
		}
	],
	note: 'A school on EdMat is an organisation of a particular kind, whose courses are its classes. Organisations, tasks, plans and decisions are not covered by this manual yet.'
};

const PL: GuideChapterDoc = {
	title: 'Kursy',
	lead: [
		'Kurs to coś, co ktoś prowadzi, a inni do tego dołączają: rozdziały i lekcje zbudowane z zadań i materiałów, które już tu są. To nie to samo co przedmiot — przedmiot należy do taksonomii, którą się przegląda, i siedzi pod „Zadaniami”.'
	],
	steps: [
		{
			heading: 'Jak znaleźć kurs',
			body: [
				'Każdy wypisany kurs pokazuje, kto go prowadzi, ile osób bierze udział, dla jakiego wieku jest i do którego przedmiotu należy. Pole wyboru zawęża listę do kursów, w których już jesteś.',
				'Nie każdy kurs tu jest. Kurs zaczyna jako widoczny tylko dla prowadzących, a osoba prowadząca decyduje, kiedy — i czy — wystawić go publicznie. Do niektórych wchodzi się wyłącznie z zaproszenia.'
			],
			screenshot: {
				src: '/guide/courses/01-hub.png',
				alt: 'Strona kursów: dwa kafelki — „Analiza od zera” prowadzony przez Anię Kowalczyk z trzema uczestnikami i „Analiza matematyczna dla początkujących”, oba oznaczone OPEN.'
			}
		},
		{
			heading: 'Strona kursu',
			body: [
				"Opis, a potem dwie ramki, które warto przeczytać przed dołączeniem: „What it covers” — zgłoszenia o tym, co kurs obejmuje, przegłosowane przez innych — i „What's required” — czego oczekuje się od Ciebie na wejściu.",
				'Niżej „Join this course”. Jeśli dołączenie wymaga zgody prowadzącego albo miejsc już nie ma, przycisk mówi to wprost, zamiast po cichu nie zadziałać.'
			],
			screenshot: {
				src: '/guide/courses/05-join.png',
				alt: "Strona kursu widziana przez osobę spoza niego: tytuł, prowadzący, opis, ramki „What it covers” i „What's required” oraz przycisk „Join this course”."
			}
		},
		{
			heading: 'Rozdziały, lekcje i ich zawartość',
			body: [
				'Zawartość to jedna lista: rozdziały, w nich lekcje, a w lekcji zadania, materiały, pliki, odnośniki i punkty do dyskusji, które wstawiła osoba prowadząca. Cały zapisany zestaw można podpiąć do lekcji jednym kliknięciem.',
				'Wiersz pod lekcją — „0 of 3 have finished this” — to deklaracja samych uczestników, a nie pomiar czegokolwiek. Kto widzi nazwiska, a kto tylko liczbę, to jedna decyzja prowadzącego na cały kurs.'
			],
			screenshot: {
				src: '/guide/courses/03-content.png',
				alt: 'Sekcja Content kursu: rozdział „Program” z lekcjami „Ciągi i granice” i „Szeregi liczbowe”, przy każdej „Link a saved set”, wiersz postępu „0 of 3 have finished this” i rozwijana dyskusja.'
			}
		},
		{
			heading: 'Prowadzenie kursu',
			body: [
				'Wszystko dla prowadzącego jest na jednej stronie, pod „Manage this course”: kolejka treści zaproponowanych przez innych, rozdziały, osoby współprowadzące z rolami oraz linki zapraszające.',
				'Osobę dodaje się do zespołu po numerze konta — wyszukiwarki osób jeszcze nie ma, więc formularz chce numeru z adresu jej profilu. Link zapraszający wpuszcza z pominięciem kolejki, ale nigdy ponad limit miejsc.'
			],
			screenshot: {
				src: '/guide/courses/04-manage.png',
				alt: 'Strona „Manage this course”: sekcja „Waiting for review”, formularz dodania rozdziału, sekcja „Who runs this” z właścicielką i polem Account ID oraz sekcja „Invite links”.'
			}
		},
		{
			heading: 'Reszta strony',
			body: [
				'Pod zawartością jest wyszukiwarka przeszukująca tylko ten kurs — rozdział, lekcję, plik, czyjąś wypowiedź w dyskusji — oraz zakładki z plikami kursu, Twoimi prywatnymi notatkami, dyskusją i listą osób.'
			],
			screenshot: {
				src: '/guide/courses/02-course.png',
				alt: 'Strona kursu widziana przez prowadzącą: przyciski Edit i Delete, odnośnik „Manage this course”, wyszukiwarka w kursie i zakładki Content / Files / My notes / Discussion / People.'
			}
		}
	],
	note: 'Szkoła w EdMacie to organizacja odpowiedniego rodzaju, a jej kursy to klasy. Organizacje, zadania, plany i decyzje nie są jeszcze opisane w tym podręczniku.'
};

export function coursesChapterFor(locale: string): GuideChapterDoc {
	return locale === 'en' ? EN : PL;
}
