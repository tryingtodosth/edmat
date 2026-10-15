// Chapter: contributing an exercise or a material, and what the queue does with it.
import type { GuideChapterDoc } from './types';

const EN: GuideChapterDoc = {
	title: 'Adding an exercise or a material',
	lead: [
		'Anything you add is read by another person before it is published. That is slower than a wiki on purpose: a wrong solution on a revision site is worse than no solution at all.'
	],
	steps: [
		{
			heading: 'The form',
			tryHref: '/submit',
			body: [
				'Discipline, then subject, then a title. Difficulty, who it is for, and what kind of source it came from — an exercise sheet, a midterm, an exam. The language is the language the exercise is *written* in, not your interface language: it starts on the language you are reading the site in, so change it if you are writing in another one.',
				'The line under the heading tells you what will happen when you press Submit. For most accounts it says the exercise will be reviewed first; for a verified contributor it says it publishes straight away.'
			],
			screenshot: {
				src: '/guide/submit/01-form-top.png',
				alt: 'The top of the submit form: a note that new exercises are reviewed by a moderator, then discipline, branch, title, difficulty, audience, source type, and language — still on EN, the interface language.'
			}
		},
		{
			heading: 'Writing the maths',
			body: [
				'Statement, hint, answer and solution are four separate boxes, and only the statement is required — a "prove that" exercise has no answer to give.',
				'Each box takes Markdown with LaTeX inside it: \\( … \\) for maths in a line, \\[ … \\] for maths on a line of its own. The "Maths" strip above the box inserts the common symbols. "Editor" switches the same box to a rich editor if you would rather not type the markup; it writes to the same field.',
				'The "Add:" row attaches things that are not text — a Markdown or LaTeX file, a chemical structure, a drawing, a picture.'
			],
			screenshot: {
				src: '/guide/submit/02-filled.png',
				alt: 'The submit form filled in: discipline Matematyka, branch Analiza matematyczna, a Polish title, audience University, and a statement written with LaTeX in the Source view.'
			}
		},
		{
			heading: 'Look at it before you send it',
			body: [
				'"Preview" renders every field exactly as a reader will see it, mathematics and all. It is worth a look: a missing closing brace is obvious typeset and invisible in the source.'
			],
			screenshot: {
				src: '/guide/submit/03-preview.png',
				alt: 'The preview under the submit form: the statement and the hint typeset as a reader will see them, the recursive sequence and the square root of two as real mathematics, and the Submit button beneath.'
			}
		},
		{
			heading: 'What happens next',
			body: [
				'The form says, in one line, what became of it: waiting for review, or published. A submission that is waiting sits in the moderation queue, where somebody reads it and either accepts it or rejects it with a reason.',
				'Either way you are told. A rejected submission is kept rather than deleted — who offered what, and what was decided, is part of how this place stays trustworthy.'
			],
			screenshot: {
				src: '/guide/submit/04-submitted.png',
				alt: 'The submit form after sending, with a green line reading "Thanks! Your exercise was submitted and is awaiting review."'
			}
		},
		{
			heading: 'A material instead',
			tryHref: '/submit-material',
			tryFlag: 'material_submissions',
			body: [
				'A material is a file or a link rather than a problem — a course script, a sheet of formulas, a collection of past papers. PDF, PNG, JPEG, LaTeX, Word and OpenDocument are accepted, and every upload has its file type verified and is scanned where a scanner is configured.',
				'Give it either a file or a link, never both. Choosing several files makes several materials, one per file, because a material holds exactly one thing.'
			],
			screenshot: {
				src: '/guide/submit/05-material.png',
				alt: 'The submit-a-material form: discipline, branch, name, type, language, audience, description, and a "Where is it?" box offering a file or a link.'
			}
		},
		{
			heading: 'Fixing something that is already there',
			body: [
				'You do not need to be a moderator to improve a published exercise. Its page carries "Suggest an edit" and "Suggest a translation", and both land in the same queue as a new submission. A hint or a solution of your own is added straight on the page, under "Show hints" and "Show solutions".'
			]
		}
	],
	note: 'Submitting is governed by its own switch. If the site is not accepting submissions at the moment, the form is not there at all rather than failing when you press Submit.'
};

const PL: GuideChapterDoc = {
	title: 'Dodawanie zadania albo materiału',
	lead: [
		'Wszystko, co dodasz, czyta najpierw druga osoba. To celowo wolniej niż wiki: błędne rozwiązanie na stronie do powtórek jest gorsze niż brak rozwiązania.'
	],
	steps: [
		{
			heading: 'Formularz',
			tryHref: '/submit',
			body: [
				'Kierunek, potem przedmiot, potem tytuł. Trudność, dla kogo jest zadanie i z jakiego źródła pochodzi — ćwiczenia, kolokwium, egzamin. Język to język, w którym zadanie jest *napisane*, a nie język Twojego interfejsu: na start ustawia się na język, w którym czytasz serwis, więc zmień go, jeśli piszesz w innym.',
				'Zdanie pod nagłówkiem mówi, co się stanie po wysłaniu. Dla większości kont: zadanie najpierw trafi do sprawdzenia; dla zweryfikowanego autora: publikuje się od razu.'
			],
			screenshot: {
				src: '/guide/submit/01-form-top.png',
				alt: 'Góra formularza zgłoszenia: informacja, że nowe zadania sprawdza moderator, a niżej kierunek, przedmiot, tytuł, trudność, odbiorca, typ źródła i język — jeszcze ustawiony na EN, język interfejsu.'
			}
		},
		{
			heading: 'Pisanie wzorów',
			body: [
				'Treść, wskazówka, odpowiedź i rozwiązanie to cztery osobne pola i wymagana jest tylko treść — zadanie „wykaż, że” nie ma odpowiedzi do podania.',
				'Każde pole przyjmuje Markdown z LaTeX-em w środku: \\( … \\) dla wzoru w linii, \\[ … \\] dla wzoru w osobnym wierszu. Pasek „Maths” nad polem wstawia typowe symbole. „Editor” przełącza to samo pole na edytor wizualny, jeśli wolisz nie pisać znaczników — zapisuje do tego samego miejsca.',
				'Wiersz „Add:” dokłada to, co nie jest tekstem — plik Markdown albo LaTeX, wzór chemiczny, szkic, obrazek.'
			],
			screenshot: {
				src: '/guide/submit/02-filled.png',
				alt: 'Wypełniony formularz: kierunek Matematyka, przedmiot Analiza matematyczna, polski tytuł, odbiorca University i treść napisana w LaTeX-u w widoku Source.'
			}
		},
		{
			heading: 'Obejrzyj, zanim wyślesz',
			body: [
				'„Preview” pokazuje każde pole dokładnie tak, jak zobaczy je czytelnik, ze wzorami włącznie. Warto zerknąć: brakujący nawias klamrowy widać od razu w złożonym wzorze, a w źródle wcale.'
			],
			screenshot: {
				src: '/guide/submit/03-preview.png',
				alt: 'Podgląd pod formularzem zgłoszenia: treść i wskazówka złożone tak, jak zobaczy je czytelnik — ciąg rekurencyjny i pierwiastek z dwóch jako prawdziwe wzory — a pod nimi przycisk Submit.'
			}
		},
		{
			heading: 'Co dalej',
			body: [
				'Formularz mówi jednym zdaniem, co się stało: czeka na sprawdzenie albo jest opublikowane. Zgłoszenie, które czeka, stoi w kolejce moderacyjnej, gdzie ktoś je czyta i przyjmuje albo odrzuca z uzasadnieniem.',
				'Tak czy inaczej dostaniesz powiadomienie. Odrzucone zgłoszenie zostaje, a nie znika — kto co zaproponował i jak zdecydowano, jest częścią tego, dlaczego można temu miejscu ufać.'
			],
			screenshot: {
				src: '/guide/submit/04-submitted.png',
				alt: 'Formularz po wysłaniu, z zielonym napisem „Thanks! Your exercise was submitted and is awaiting review.”'
			}
		},
		{
			heading: 'Albo materiał',
			tryHref: '/submit-material',
			tryFlag: 'material_submissions',
			body: [
				'Materiał to plik albo odnośnik, a nie zadanie — skrypt, zestaw wzorów, zbiór dawnych egzaminów. Przyjmowane są PDF, PNG, JPEG, LaTeX, Word i OpenDocument; typ każdego pliku jest sprawdzany, a tam, gdzie skonfigurowano skaner, plik jest skanowany.',
				'Podaj albo plik, albo odnośnik — nigdy oba naraz. Wybranie kilku plików tworzy kilka materiałów, po jednym na plik, bo materiał mieści dokładnie jedną rzecz.'
			],
			screenshot: {
				src: '/guide/submit/05-material.png',
				alt: 'Formularz dodawania materiału: kierunek, przedmiot, nazwa, typ, język, odbiorca, opis i ramka „Where is it?” z wyborem pliku albo odnośnika.'
			}
		},
		{
			heading: 'Poprawianie tego, co już jest',
			body: [
				'Żeby poprawić opublikowane zadanie, nie trzeba być moderatorem. Na jego stronie są „Suggest an edit” i „Suggest a translation”, a obie trafiają do tej samej kolejki co nowe zgłoszenie. Własną wskazówkę albo rozwiązanie dodaje się wprost na stronie, pod „Show hints” i „Show solutions”.'
			]
		}
	],
	note: 'Zgłaszanie ma własny wyłącznik. Jeśli serwis akurat nie przyjmuje zgłoszeń, formularza po prostu nie ma — zamiast tego, żeby zawiódł po naciśnięciu „Wyślij”.'
};

export function submitChapterFor(locale: string): GuideChapterDoc {
	return locale === 'en' ? EN : PL;
}
