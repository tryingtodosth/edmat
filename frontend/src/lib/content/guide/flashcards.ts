// Chapter: decks of flashcards, the review session, and placing a deck where other people study.
//
// Written on 2026-10-06 against the app as `eb6086a` merged it (closing step C,
// `prompts/14-manual-flashcards.md`), replacing the honest placeholder `learn/h-manual` wrote
// before the screens existed. The pictures are `static/guide/flashcards/01…07`, taken by
// `frontend/e2e/guide-screenshots.mjs` like every other picture in this manual.
import type { GuideChapterDoc } from './types';

const EN: GuideChapterDoc = {
	title: 'Flashcards',
	lead: [
		'A deck is a pile of cards you go through a few at a time. A card is either an exercise from the database or two lines you write yourself, and the site keeps your own schedule for each one: you say how it went, and it comes back on the day you were about to forget it.',
		'A deck belongs to the person who made it. Placing it on a course or an event is how other people get to study it.'
	],
	steps: [
		{
			heading: 'Make a deck',
			tryHref: '/my-set',
			body: [
				'The shortest way in is a set you have already saved. On "My set", every saved set carries a "Make a deck from this set" button, and the deck it makes has one card per exercise in the set.',
				'The same button sits on a lesson inside a course, on a session in an event programme, and on a concept page — anything you are already reading can become a deck. The "+" on an exercise card has a Decks section that folds open as well, for putting the one exercise in front of you into a deck you already have.',
				'What it makes is a copy, not a link: adding an exercise to the set afterwards does not add a card to the deck, and the deck survives the set being deleted.'
			],
			screenshot: {
				src: '/guide/flashcards/01-make-from-set.png',
				alt: 'The saved-sets block on the My set page: the set "Before the midterm" with 3 exercises and a Public tick, and the buttons Share, Load and "Make a deck from this set".'
			}
		},
		{
			heading: 'Your decks, and what is waiting',
			tryHref: '/flashcards',
			body: [
				'"My decks" in the account menu is the list. Each deck says how many cards it holds, where it came from, and how many are waiting for you; the line above the list adds them up across every deck.',
				'A deck you have never reviewed counts all of its cards as waiting, because a card you have not seen yet is a card to learn. The box under that line starts an empty deck, if you would rather build one card at a time.'
			],
			screenshot: {
				src: '/guide/flashcards/02-decks.png',
				alt: 'The My decks page: "5 cards waiting across 2 decks", a box for naming a new deck, and two decks — "Definitions I keep forgetting", 2 cards, built by hand, and "Limits and sequences", 3 cards, from an exercise set — each with Open and Review.'
			}
		},
		{
			heading: 'What is in a deck',
			body: [
				'A deck page lists its cards in order. An exercise card is a link to the exercise, so the hint, the solution and the discussion under it are always one click away — the card is a prompt, not a copy of the exercise.',
				'An exercise that has since been withdrawn stays in the deck and says so, and only you can see that card. Nothing is silently dropped out from under you.',
				'If you are reading a deck somebody else made, because they placed it on a course you are on, you see the cards and the Review button and none of the editing. The honest answer to "can I change this" is the button beside it: "Save a copy to my account" gives you a deck of your own.'
			],
			screenshot: {
				src: '/guide/flashcards/03-cards.png',
				alt: 'The Cards panel of a deck: three exercise titles, one of them with typeset mathematics, each with a Remove link.'
			}
		},
		{
			heading: 'Adding a card',
			body: [
				'Three ways, all on the deck page. Search the database by title and add an exercise; take every exercise out of one of your saved sets in one go; or write a card of your own, a front and a back. Mathematics is written the way it is everywhere else here, between \\( and \\).',
				'"Remove" takes a card out of the deck and your schedule for it with it. "Delete deck" does the same for every card at once, and asks first.'
			],
			screenshot: {
				src: '/guide/flashcards/04-add-a-card.png',
				alt: 'The "Add an exercise" panel of a deck: a search box, a "Add from one of my sets" picker, and a "Write a card of your own" form with Front and Back fields and an Add card button.'
			}
		},
		{
			heading: 'Reviewing',
			body: [
				'"Review" shows one card at a time, front first: the exercise statement, or whatever you wrote on the front, and nothing else — the point is to answer before you see the answer. "Show the answer" turns the card over, and so do Space and Enter.',
				'The line under the deck name is this deck\'s arithmetic: how many cards are due today, how many you have never seen, and how many are already scheduled for a later day. "1 of 3" is where you are in this sitting.'
			],
			screenshot: {
				src: '/guide/flashcards/05-review.png',
				alt: 'The review screen for "Limits and sequences": the counts "0 due · 3 new · 0 scheduled", the position "1 of 3", a card showing an exercise statement with a typeset formula, and a "Show the answer" button.'
			}
		},
		{
			heading: 'The four grades',
			body: [
				'With the card turned over you say how it went: Again, Hard, Good or Easy. The keys 1 to 4 do the same thing, which is what makes a long session quick. That is all there is to fill in.',
				'What you press decides when the card comes back. "Again" means now, in this same sitting — it is a request, not a punishment. The other three push the card further out each time you get it right, so one you know well is asked for a few times a year and one you keep missing is asked for tomorrow.',
				'When there is nothing left the screen says how many you did, and offers to ask again for anything that has fallen due while you were working.'
			],
			screenshot: {
				src: '/guide/flashcards/06-grades.png',
				alt: 'The same card turned over: the answer with three partial derivatives typeset as display mathematics, a link to open the exercise, and the four grade buttons 1 Again, 2 Hard, 3 Good, 4 Easy.'
			}
		},
		{
			heading: 'Putting a deck where people will find it',
			body: [
				'On a deck of your own, "Place this deck on a course or an event you run" is how it reaches anybody else. Once it is placed, that course or event page grows a Flashcards panel, and everybody who can open the page can study the deck — on your cards, with their own schedule, which nobody else ever sees.',
				'Placing is a pointer, not a handover: the deck stays yours and stays editable only by you, you can take it off again, and so can whoever runs the course. A course only its participants can see keeps its decks that way too, because the panel is only drawn for somebody who could already open the page.',
				'The tick on the deck page, "Anyone with the link can study this deck", is the wider version: it makes the deck readable by anybody you give the address to. Accounts under sixteen cannot turn it on.'
			],
			screenshot: {
				src: '/guide/flashcards/07-on-a-course.png',
				alt: 'The Flashcards panel on a course page, seen by somebody taking the course: the deck "Limits and sequences", 3 cards, by Ania Kowalczyk, with a "3 to review" button.'
			}
		}
	],
	note: 'What is not here yet: no list of public decks to browse, no reminder when cards fall due, and no way to study without a connection. A deck reaches other people by being placed on a course or an event, or by the link, and in no other way. The design, drawn from sample data, is at /about/flashcards.'
};

const PL: GuideChapterDoc = {
	title: 'Fiszki',
	lead: [
		'Fiszki to stos kart, przez który przechodzi się po kilka naraz. Karta to albo zadanie z bazy, albo dwie linijki napisane przez Ciebie, a serwis prowadzi Twój własny harmonogram dla każdej z nich: mówisz, jak poszło, a karta wraca w dniu, w którym miałeś ją zapomnieć.',
		'Fiszki należą do tego, kto je zrobił. Umieszczenie ich na kursie albo na wydarzeniu to sposób, w jaki mogą się z nich uczyć inni.'
	],
	steps: [
		{
			heading: 'Zrób fiszki',
			tryHref: '/my-set',
			body: [
				'Najkrótsza droga to zapisany zestaw. Na stronie „My set” każdy zapisany zestaw ma przycisk „Make a deck from this set”, a powstałe fiszki mają po jednej karcie na każde zadanie z zestawu.',
				'Ten sam przycisk jest przy lekcji w kursie, przy sesji w programie wydarzenia i na stronie pojęcia — wszystko, co właśnie czytasz, może stać się fiszkami. Menu „+” przy kafelku zadania ma też rozwijaną sekcję „Decks”, żeby wrzucić jedno zadanie do fiszek, które już masz.',
				'To, co powstaje, jest kopią, a nie odnośnikiem: dołożenie zadania do zestawu nie dołoży karty do fiszek, a fiszki przeżyją skasowanie zestawu.'
			],
			screenshot: {
				src: '/guide/flashcards/01-make-from-set.png',
				alt: 'Blok zapisanych zestawów na stronie My set: zestaw „Before the midterm” z 3 zadaniami i zaznaczonym „Public” oraz przyciski Share, Load i „Make a deck from this set”.'
			}
		},
		{
			heading: 'Twoje fiszki i to, co czeka',
			tryHref: '/flashcards',
			body: [
				'„My decks” w menu konta to lista. Przy każdych fiszkach widać, ile mają kart, skąd pochodzą i ile czeka na Ciebie; wiersz nad listą sumuje to po wszystkich.',
				'Fiszki, których jeszcze nie powtarzano, liczą wszystkie swoje karty jako czekające, bo karta nieobejrzana to karta do nauczenia. Pole pod tym wierszem zakłada nowe, puste fiszki, jeśli wolisz budować je po jednej karcie.'
			],
			screenshot: {
				src: '/guide/flashcards/02-decks.png',
				alt: 'Strona My decks: „5 cards waiting across 2 decks”, pole na nazwę nowych fiszek i dwie pozycje na liście — „Definitions I keep forgetting”, 2 karty, zbudowana ręcznie, oraz „Limits and sequences”, 3 karty, z zestawu zadań — każda z przyciskami Open i Review.'
			}
		},
		{
			heading: 'Co jest w fiszkach',
			body: [
				'Strona fiszek wypisuje ich karty po kolei. Karta z zadaniem jest odnośnikiem do zadania, więc wskazówka, rozwiązanie i dyskusja pod nim są zawsze o jedno kliknięcie dalej — karta jest pytaniem, a nie kopią zadania.',
				'Zadanie, które w międzyczasie zdjęto, zostaje w fiszkach i jest o tym napisane, a taką kartę widzisz tylko Ty. Nic nie znika po cichu.',
				'Jeśli czytasz cudze fiszki, bo ktoś umieścił je na kursie, na który chodzisz, widzisz karty i przycisk Review, a nic z edycji. Uczciwa odpowiedź na pytanie „czy mogę to zmienić” jest przyciskiem obok: „Save a copy to my account” daje Ci własne fiszki.'
			],
			screenshot: {
				src: '/guide/flashcards/03-cards.png',
				alt: 'Panel Cards na stronie fiszek: trzy tytuły zadań, jeden ze złożonym wzorem, każdy z odnośnikiem Remove.'
			}
		},
		{
			heading: 'Dokładanie karty',
			body: [
				'Trzy sposoby, wszystkie na stronie fiszek. Wyszukaj zadanie w bazie po tytule i dodaj je; wciągnij naraz wszystkie zadania z jednego ze swoich zapisanych zestawów; albo napisz własną kartę — przód i tył. Matematykę pisze się tak samo jak wszędzie tutaj, między \\( i \\).',
				'„Remove” usuwa kartę razem z Twoim harmonogramem dla niej. „Delete deck” robi to samo ze wszystkimi kartami naraz i pyta, zanim to zrobi.'
			],
			screenshot: {
				src: '/guide/flashcards/04-add-a-card.png',
				alt: 'Panel „Add an exercise” na stronie fiszek: wyszukiwarka, lista „Add from one of my sets” oraz formularz „Write a card of your own” z polami Front i Back i przyciskiem Add card.'
			}
		},
		{
			heading: 'Powtarzanie',
			body: [
				'„Review” pokazuje po jednej karcie, najpierw przód: treść zadania albo to, co napisałeś na przodzie, i nic więcej — chodzi o to, żeby odpowiedzieć, zanim zobaczysz odpowiedź. „Show the answer” odwraca kartę; spacja i Enter robią to samo.',
				'Wiersz pod nazwą fiszek to ich rachunek: ile kart jest na dziś, ile jest nowych, jeszcze nieoglądanych, i ile ma już wyznaczony późniejszy dzień. „1 of 3” mówi, gdzie jesteś w tym posiedzeniu.'
			],
			screenshot: {
				src: '/guide/flashcards/05-review.png',
				alt: 'Ekran powtórki fiszek „Limits and sequences”: liczby „0 due · 3 new · 0 scheduled”, pozycja „1 of 3”, karta z treścią zadania i złożonym wzorem oraz przycisk „Show the answer”.'
			}
		},
		{
			heading: 'Cztery oceny',
			body: [
				'Po odwróceniu karty mówisz, jak poszło: Again, Hard, Good albo Easy. Klawisze od 1 do 4 robią to samo, i to właśnie sprawia, że długa seria idzie szybko. Nic więcej nie trzeba wpisywać.',
				'To, co naciśniesz, decyduje, kiedy karta wróci. „Again” znaczy teraz, w tym samym posiedzeniu — to prośba, a nie kara. Pozostałe trzy odsuwają kartę coraz dalej za każdym razem, gdy ją umiesz, więc o dobrze znaną pyta się kilka razy w roku, a o ciągle mylącą się — jutro.',
				'Kiedy nic nie zostaje, ekran pisze, ile kart zrobiłeś, i proponuje dopytać o te, które zrobiły się aktualne w trakcie.'
			],
			screenshot: {
				src: '/guide/flashcards/06-grades.png',
				alt: 'Ta sama karta po odwróceniu: odpowiedź z trzema pochodnymi cząstkowymi złożonymi jako wzory, odnośnik do zadania i cztery przyciski ocen 1 Again, 2 Hard, 3 Good, 4 Easy.'
			}
		},
		{
			heading: 'Postawienie fiszek tam, gdzie ktoś je znajdzie',
			body: [
				'Na stronie własnych fiszek „Place this deck on a course or an event you run” to sposób, w jaki trafiają one do kogokolwiek innego. Po umieszczeniu na stronie kursu albo wydarzenia pojawia się panel „Flashcards”, a każdy, kto może otworzyć tę stronę, może się z tych fiszek uczyć — na Twoich kartach, z własnym harmonogramem, którego nikt inny nigdy nie widzi.',
				'Umieszczenie to wskazanie, a nie przekazanie: fiszki dalej są Twoje i dalej tylko Ty możesz je zmieniać, możesz je stamtąd zdjąć i może to zrobić także osoba prowadząca kurs. Kurs widoczny wyłącznie dla uczestników zachowuje to i przy fiszkach, bo panel rysuje się tylko komuś, kto i tak mógłby otworzyć stronę.',
				'Zaznaczenie na stronie fiszek, „Anyone with the link can study this deck”, to wersja szersza: fiszki stają się czytelne dla każdego, komu podasz adres. Konta poniżej szesnastu lat nie mogą tego włączyć.'
			],
			screenshot: {
				src: '/guide/flashcards/07-on-a-course.png',
				alt: 'Panel Flashcards na stronie kursu, widziany przez uczestnika: fiszki „Limits and sequences”, 3 karty, autorstwa Ani Kowalczyk, z przyciskiem „3 to review”.'
			}
		}
	],
	note: 'Czego jeszcze nie ma: listy publicznych fiszek do przeglądania, przypomnienia, kiedy karty robią się aktualne, ani nauki bez połączenia. Fiszki trafiają do innych przez umieszczenie ich na kursie albo wydarzeniu, albo przez link — i w żaden inny sposób. Projekt, narysowany na danych przykładowych, jest pod adresem /about/flashcards.'
};

export function flashcardsChapterFor(locale: string): GuideChapterDoc {
	return locale === 'en' ? EN : PL;
}
