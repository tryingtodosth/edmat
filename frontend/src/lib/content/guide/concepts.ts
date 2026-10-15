// Chapter: the concept wiki — one idea, several articles, one per kind of reader.
import type { GuideChapterDoc } from './types';

const EN: GuideChapterDoc = {
	title: 'Concepts',
	lead: [
		'A concept is an idea the exercises keep leaning on — a limit, an integral, recursion. Its page explains the idea, says what you should know first, and gathers the exercises and materials about it.'
	],
	steps: [
		{
			heading: 'The list',
			tryHref: '/concepts',
			body: [
				'Search, filter by subject or tag, sort, or jump by first letter. Each card says which readers its article was written for, which language it is in, and how many articles the concept has.',
				'A concept with no article for your kind of reader says so on its card rather than opening into an empty page.'
			],
			screenshot: {
				src: '/guide/concepts/01-hub.png',
				alt: 'The concepts page: search, subject, tag and order controls, an A–Z strip, and cards for Integral, Mechanika kwantowa, Limit and Derivative, each with its audience, language and article count.'
			}
		},
		{
			heading: 'One idea, several articles',
			body: [
				'The chips above the title are the versions of this concept: one per kind of reader and language — "University EN", "University PL", and so on. The same idea explained for a fourteen-year-old and for a third-year student are two different pieces of writing, not one piece with a difficulty slider.',
				'Under the title: who wrote this version, which revision it is, and when. "History" shows every revision and what changed.',
				'Under the text, a line names the licence — who holds the rights, and what you may do with the article outside EdMat. A licence here only ever changes towards more open.'
			],
			screenshot: {
				src: '/guide/concepts/02-concept.png',
				alt: 'The concept page for Integral: the University EN and University PL chips, the author and revision line, the text with a link to another concept, the licence line "All rights reserved by the author", the tag, and the Connections block.'
			}
		},
		{
			heading: 'What it connects to',
			body: [
				'"Know this first" is the prerequisite chain — the only "learn this before that" the site has. "Related concepts" are the sideways links; one marked "from the text" was found in the article itself rather than added by hand.',
				'Underneath are the exercises and materials linked to this concept, which is the short way from an idea to something to practise on.'
			]
		},
		{
			heading: 'Writing one',
			body: [
				'Signed in, the page offers three things: "Improve this article" edits the version you are reading, "Write your own article for these readers" starts a new one where none exists for your audience, and "Link something" attaches an exercise, a material or another concept.',
				'Every edit is a revision, kept. Nothing is overwritten, and the history shows who changed what.',
				'"Make a deck from this concept" turns the article into a flashcard deck of your own, to review on the flashcards page.'
			],
			screenshot: {
				src: '/guide/concepts/03-signed-in.png',
				alt: 'The same concept page signed in: under the text the licence line with a "Change licence" link, then "Improve this article", "History", "Report", a "Make a deck from this concept" button, and "Write your own article for these readers".'
			}
		}
	]
};

const PL: GuideChapterDoc = {
	title: 'Pojęcia',
	lead: [
		'Pojęcie to idea, o którą zadania ciągle się opierają — granica, całka, rekurencja. Jego strona tłumaczy ideę, mówi, co trzeba wiedzieć wcześniej, i zbiera zadania oraz materiały na jej temat.'
	],
	steps: [
		{
			heading: 'Lista',
			tryHref: '/concepts',
			body: [
				'Wyszukiwarka, filtr po przedmiocie albo tagu, sortowanie i skok po pierwszej literze. Każdy kafelek mówi, dla jakich czytelników napisano artykuł, w jakim jest języku i ile artykułów ma pojęcie.',
				'Pojęcie, które nie ma artykułu dla Twojego rodzaju czytelnika, pisze to na kafelku, zamiast otwierać pustą stronę.'
			],
			screenshot: {
				src: '/guide/concepts/01-hub.png',
				alt: 'Strona pojęć: wyszukiwarka, przedmiot, tag i kolejność, pasek A–Z oraz kafelki Integral, Mechanika kwantowa, Limit i Derivative z odbiorcą, językiem i liczbą artykułów.'
			}
		},
		{
			heading: 'Jedna idea, kilka artykułów',
			body: [
				'Plakietki nad tytułem to wersje tego pojęcia: po jednej na rodzaj czytelnika i język — „University EN”, „University PL” i tak dalej. Ta sama idea wyłożona czternastolatkowi i studentowi trzeciego roku to dwa różne teksty, a nie jeden z suwakiem trudności.',
				'Pod tytułem: kto napisał tę wersję, która to rewizja i kiedy powstała. „History” pokazuje każdą rewizję i to, co się zmieniło.',
				'Pod tekstem jest wiersz z licencją — kto ma prawa i co wolno zrobić z artykułem poza EdMatem. Licencję można tu zmienić tylko na bardziej otwartą.'
			],
			screenshot: {
				src: '/guide/concepts/02-concept.png',
				alt: 'Strona pojęcia Integral: plakietki University EN i University PL, wiersz z autorką i rewizją, tekst z odnośnikiem do innego pojęcia, wiersz licencji „All rights reserved by the author”, tag i blok Connections.'
			}
		},
		{
			heading: 'Z czym się łączy',
			body: [
				'„Know this first” to łańcuch wymagań wstępnych — jedyne „naucz się tego przed tamtym”, jakie serwis ma. „Related concepts” to powiązania w bok; to oznaczone „from the text” zostało znalezione w samym artykule, a nie dodane ręcznie.',
				'Niżej są zadania i materiały podpięte do pojęcia, czyli najkrótsza droga od idei do czegoś, na czym można poćwiczyć.'
			]
		},
		{
			heading: 'Pisanie artykułu',
			body: [
				'Po zalogowaniu strona proponuje trzy rzeczy: „Improve this article” poprawia czytaną wersję, „Write your own article for these readers” zaczyna nową tam, gdzie dla Twoich odbiorców jeszcze jej nie ma, a „Link something” podpina zadanie, materiał albo inne pojęcie.',
				'Każda poprawka to rewizja, która zostaje. Nic nie jest nadpisywane, a historia pokazuje, kto co zmienił.',
				'„Make a deck from this concept” robi z artykułu Twoje własne fiszki do powtarzania na stronie fiszek.'
			],
			screenshot: {
				src: '/guide/concepts/03-signed-in.png',
				alt: 'Ta sama strona pojęcia po zalogowaniu: pod tekstem wiersz licencji z odnośnikiem „Change licence”, a dalej „Improve this article”, „History”, „Report”, przycisk „Make a deck from this concept” i „Write your own article for these readers”.'
			}
		}
	]
};

export function conceptsChapterFor(locale: string): GuideChapterDoc {
	return locale === 'en' ? EN : PL;
}
