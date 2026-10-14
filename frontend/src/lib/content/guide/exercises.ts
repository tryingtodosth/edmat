// Chapter: finding and reading exercises, and building a set out of them.
import type { GuideChapterDoc } from './types';

const EN: GuideChapterDoc = {
	title: 'Finding and reading exercises',
	lead: [
		'The database is browsed in four steps — discipline, subject, topic, exercise — and read one exercise at a time, with the hint, the answer and the solution kept behind a click each. What you want to keep goes into a set you can print or share.'
	],
	steps: [
		{
			heading: 'Start with a discipline',
			tryHref: '/disciplines',
			body: [
				'A discipline is a field of study — mathematics, physics, computer science. Each card says how many subjects sit under it. Disciplines somebody has proposed but a moderator has not yet accepted are listed separately, under "Others".'
			],
			screenshot: {
				src: '/guide/exercises/01-disciplines.png',
				alt: 'The disciplines page: cards for Fizyka, Informatyka and Matematyka, each with a count of the subjects under it.'
			}
		},
		{
			heading: 'A subject, and its filters',
			tryHref: '/branches/analiza-matematyczna',
			body: [
				'A subject page is the working view: the filter column on the left narrows by topic, difficulty and source — an exercise sheet, a midterm, an exam — and the search box inside it searches only this subject. The count under the filters is how many exercises match.',
				'If the page says that items in other languages are hidden, that is the content-language setting, not an empty database. "Show them" lifts it for this list.',
				'Concept pages for the subject sit above the list, and the Materials tab beside it holds its scripts, formula sheets and past papers.'
			],
			screenshot: {
				src: '/guide/exercises/02-branch.png',
				alt: 'The exercise list for Analiza matematyczna: a filter column with search, topic, difficulty and source, a sort control, and exercise cards with difficulty, audience and "Verified solution" badges.'
			}
		},
		{
			heading: 'The exercise itself',
			body: [
				'The statement is always there, typeset as mathematics. Above it: the difficulty, where it came from, whether the solution has been reviewed ("Verified solution"), the rating other readers gave it, and the language picker for this exercise alone.',
				'"+ Save" puts the exercise into a set. The topics and tags beneath are links — they are how you find the other exercises about the same thing.'
			],
			screenshot: {
				src: '/guide/exercises/03-exercise.png',
				alt: 'An exercise page: the title with mathematics in it, the Medium / Exercise sheet / Verified solution badges, a language picker and a Save button, the topics, the tags, and the statement in a card.'
			}
		},
		{
			heading: 'Hint, answer, solution — one at a time',
			body: [
				'Nothing is revealed until you ask for it, which is the whole point of a practice database: "Show hints" first, then the answer, then the full working. Each is a separate button and each can be closed again.',
				'There can be more than one hint or solution, because readers may add their own; the one the site trusts most is marked as pinned. Each carries its own small discussion.'
			],
			screenshot: {
				src: '/guide/exercises/04-reveals.png',
				alt: 'The same exercise with the hint and the answer revealed: a pinned hint from the EdMat corpus, then three partial derivatives typeset as display mathematics.'
			}
		},
		{
			heading: 'Putting it in a set',
			body: [
				'The + on any exercise card opens the same small menu: your working set, each of your saved sets, and any course you run that can take content.',
				'The working set needs no account — it lives in this browser. Saved sets need one.'
			],
			screenshot: {
				src: '/guide/exercises/05-add-to-set.png',
				alt: 'The save menu open over an exercise card, offering the working set, a saved set called "Before the midterm", a Courses column and "New set…".'
			}
		},
		{
			heading: 'My set, and printing it',
			tryHref: '/my-set',
			body: [
				'"My set" is the study sheet you are building. For each exercise you decide whether the hint, the answer and the solution are printed with it — the checkboxes along the top set all of them at once.',
				'"Export to PDF" opens your browser\'s own print dialogue; choose "Save as PDF" there. Giving the set a name saves it to your account.'
			],
			screenshot: {
				src: '/guide/exercises/06-my-set.png',
				alt: 'The My set page: an Export to PDF button, a box for saving the set under a name, the saved set "Before the midterm" with a Public tick, and two exercises with hint / answer / solution checkboxes.'
			}
		},
		{
			heading: 'Sharing a set',
			body: [
				'A saved set marked public gets an address of its own, and anybody with the link can read it, load it into their own working set, or keep a copy. The link is a long random string, so a set that is not public is not guessable.',
				'This is how a tutor hands out "the ten problems before the midterm" without anybody needing an account.'
			],
			screenshot: {
				src: '/guide/exercises/07-saved-set.png',
				alt: 'A shared set page titled "Before the midterm", shared by Ania Kowalczyk, with "Load into my set" and "Save a copy to my account" buttons and three numbered exercises.'
			}
		}
	]
};

const PL: GuideChapterDoc = {
	title: 'Jak znaleźć i czytać zadania',
	lead: [
		'Bazę przegląda się w czterech krokach — kierunek, przedmiot, dział, zadanie — a czyta po jednym zadaniu, trzymając wskazówkę, odpowiedź i rozwiązanie każde za osobnym kliknięciem. To, co chcesz zachować, trafia do zestawu, który można wydrukować albo udostępnić.'
	],
	steps: [
		{
			heading: 'Zacznij od kierunku',
			tryHref: '/disciplines',
			body: [
				'Kierunek to dziedzina — matematyka, fizyka, informatyka. Każdy kafelek mówi, ile przedmiotów się pod nim kryje. Kierunki zaproponowane, ale jeszcze nieprzyjęte przez moderatora, są wypisane osobno, pod nagłówkiem „Others”.'
			],
			screenshot: {
				src: '/guide/exercises/01-disciplines.png',
				alt: 'Strona kierunków: kafelki Fizyka, Informatyka i Matematyka, każdy z liczbą przedmiotów.'
			}
		},
		{
			heading: 'Przedmiot i jego filtry',
			tryHref: '/branches/analiza-matematyczna',
			body: [
				'Strona przedmiotu to widok roboczy: kolumna filtrów po lewej zawęża po dziale, trudności i źródle — ćwiczenia, kolokwium, egzamin — a wyszukiwarka w niej przeszukuje tylko ten przedmiot. Liczba pod filtrami to liczba pasujących zadań.',
				'Jeśli strona pisze, że ukryto pozycje w innych językach, to ustawienie języka treści, a nie pusta baza. Przycisk „Show them” zdejmuje je dla tej listy.',
				'Nad listą są pojęcia związane z przedmiotem, a w zakładce obok — materiały: skrypty, zestawy wzorów i dawne egzaminy.'
			],
			screenshot: {
				src: '/guide/exercises/02-branch.png',
				alt: 'Lista zadań z Analizy matematycznej: kolumna filtrów z wyszukiwarką, działem, trudnością i źródłem, sortowanie oraz kafelki zadań z plakietkami trudności, odbiorcy i „Verified solution”.'
			}
		},
		{
			heading: 'Samo zadanie',
			body: [
				'Treść jest zawsze, złożona jak matematyka. Nad nią: trudność, skąd zadanie pochodzi, czy rozwiązanie zostało sprawdzone („Verified solution”), ocena innych czytelników i wybór języka dla tego jednego zadania.',
				'„+ Save” wrzuca zadanie do zestawu. Działy i tagi poniżej są odnośnikami — to po nich znajdziesz pozostałe zadania o tym samym.'
			],
			screenshot: {
				src: '/guide/exercises/03-exercise.png',
				alt: 'Strona zadania: tytuł ze wzorem, plakietki Medium / Exercise sheet / Verified solution, wybór języka i przycisk Save, działy, tagi i treść w karcie.'
			}
		},
		{
			heading: 'Wskazówka, odpowiedź, rozwiązanie — po kolei',
			body: [
				'Nic nie odsłania się samo, i o to właśnie chodzi w bazie zadań: najpierw „Show hints”, potem odpowiedź, na końcu pełne rozwiązanie. Każde to osobny przycisk i każde można z powrotem zamknąć.',
				'Wskazówek i rozwiązań może być kilka, bo czytelnicy dopisują własne; to, któremu serwis ufa najbardziej, jest oznaczone jako przypięte. Przy każdym jest własna krótka dyskusja.'
			],
			screenshot: {
				src: '/guide/exercises/04-reveals.png',
				alt: 'To samo zadanie z odsłoniętą wskazówką i odpowiedzią: przypięta wskazówka z korpusu EdMatu, a pod nią trzy pochodne cząstkowe złożone jako wzory.'
			}
		},
		{
			heading: 'Wrzucanie do zestawu',
			body: [
				'Znak + na dowolnym kafelku zadania otwiera to samo małe menu: zestaw roboczy, każdy z Twoich zapisanych zestawów i każdy prowadzony przez Ciebie kurs, który przyjmuje treści.',
				'Zestaw roboczy nie wymaga konta — mieszka w tej przeglądarce. Zapisane zestawy wymagają.'
			],
			screenshot: {
				src: '/guide/exercises/05-add-to-set.png',
				alt: 'Menu zapisu otwarte nad kafelkiem zadania: zestaw roboczy, zapisany zestaw „Before the midterm”, kolumna Courses i „New set…”.'
			}
		},
		{
			heading: 'Mój zestaw i drukowanie',
			tryHref: '/my-set',
			body: [
				'„My set” to arkusz, który składasz. Przy każdym zadaniu decydujesz, czy drukuje się z nim wskazówka, odpowiedź i rozwiązanie — pola na górze ustawiają to naraz dla wszystkich.',
				'„Export to PDF” otwiera zwykłe okno drukowania przeglądarki; tam wybierz „Zapisz jako PDF”. Nadanie zestawowi nazwy zapisuje go na koncie.'
			],
			screenshot: {
				src: '/guide/exercises/06-my-set.png',
				alt: 'Strona „My set”: przycisk Export to PDF, pole zapisania zestawu pod nazwą, zapisany zestaw „Before the midterm” z zaznaczonym Public i dwa zadania z polami hint / answer / solution.'
			}
		},
		{
			heading: 'Udostępnianie zestawu',
			body: [
				'Zapisany zestaw oznaczony jako publiczny dostaje własny adres i każdy, kto ma odnośnik, może go przeczytać, wczytać do swojego zestawu roboczego albo zachować kopię. Odnośnik to długi losowy ciąg, więc zestawu niepublicznego nie da się zgadnąć.',
				'Tak korepetytor rozdaje „dziesięć zadań przed kolokwium”, nie wymagając od nikogo konta.'
			],
			screenshot: {
				src: '/guide/exercises/07-saved-set.png',
				alt: 'Strona udostępnionego zestawu „Before the midterm” od Ani Kowalczyk, z przyciskami „Load into my set” i „Save a copy to my account” oraz trzema ponumerowanymi zadaniami.'
			}
		}
	]
};

export function exercisesChapterFor(locale: string): GuideChapterDoc {
	return locale === 'en' ? EN : PL;
}
