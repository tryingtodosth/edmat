// Chapter: getting started — the bar, the language, the audience chips, an account, the menu.
// See `types.ts` for why both languages live in one file.
import type { GuideChapterDoc } from './types';

const EN: GuideChapterDoc = {
	title: 'Getting started',
	lead: [
		'Nothing here needs an account to read. This chapter is the five minutes before that: what the front page offers, how to put the site into your language, how to say who the content is for, and what changes once you do sign up.'
	],
	steps: [
		{
			heading: 'The front page',
			tryHref: '/',
			body: [
				'A search box, a row of age bands, and tabs across the newest exercises, materials, concepts, courses, tutoring and events. The search box looks inside statements and titles, so "całka" or "Cauchy" is a reasonable thing to type into it.',
				'On a first visit three doors sit above the tabs: this chapter, the pages showing what each part of EdMat does, and a straight way into the exercises. The × puts them away for good in this browser.',
				'Everything below the tabs is a card. A card is a link; the small + on an exercise card puts it straight into your set without opening it.'
			],
			screenshot: {
				src: '/guide/start/01-home.png',
				alt: 'The EdMat front page: the search box, the row of age bands, the three first-visit doors "New here?", "Curious first?" and "Rather dive in?", the content tabs, and the first exercise cards under "Top rated".'
			}
		},
		{
			heading: 'The bar at the top',
			body: [
				'Left: the sections — exercises, materials, courses, a rosette for contests, help wanted, tutoring, an "i" for about, and a calendar icon for events. On a narrower screen more of them turn into icons, and on a phone they move into the menu behind the ☰ button. Right: the theme switch, the reading-size button marked "Aa", the language picker, and your saved set under the bookmark.',
				'The language picker changes the interface only. Which languages of content you are shown is a separate setting, and the two are deliberately independent: you may well want the English interface and the Polish original of an exercise.'
			],
			screenshot: {
				src: '/guide/start/02-header.png',
				alt: 'The top bar: the EdMat logo, the links Exercises, Materials and Courses, the contests rosette, Help wanted, Tutoring, the about and events icons, and on the right the theme, reading size, language picker, saved set and the Log in and Sign up links.'
			}
		},
		{
			heading: 'Say who you are reading for',
			body: [
				'The chips under the search box narrow everything on the front page to one age band — early years, primary, secondary, university, adult learners, seniors. "Everything" is the default and means no narrowing at all.',
				'A chosen band is remembered in this browser. Signed in, it becomes a setting on your account instead, so it follows you between machines.'
			],
			screenshot: {
				src: '/guide/start/03-audience.png',
				alt: 'The band chips: Everything, Early years, Primary school, Secondary school, University, Adult learners, Seniors.'
			}
		},
		{
			heading: 'Making an account',
			tryHref: '/register',
			tryFor: 'guests',
			body: [
				'A display name, an email, a year of birth, a password and the language you would rather read, and a tick to say you accept the terms of use and have read the privacy policy — both are links, so you can read them first. The year of birth is asked for one reason — to find out whether you are old enough to open an account by yourself — and is not stored; only the answer is.',
				'If you are under 16, a parent or guardian creates the account from their own settings page. There is no email on a child account and nothing is ever sent to one.',
				'A forgotten password is "Forgotten your password?" on the sign-in page: give the address you registered with and a link to set a new one arrives by email.'
			],
			screenshot: {
				src: '/guide/start/04-register.png',
				alt: 'The sign-up form: display name, email, year of birth, password and preferred interface language, a tick box reading "I accept the terms of use and have read the privacy policy", and a Sign up button.'
			}
		},
		{
			heading: 'Your own menu',
			body: [
				'Once signed in, your name opens the menu that holds everything that belongs to you, in four groups: Learning (your flashcard decks and contests), Taking part (your schedule, agenda and volunteering), Working together (the materials you co-author, your tasks, organisations and work) and Your account (profile, settings, this manual, reporting a problem and logging out).',
				'The "+ Add…" button beside it is the short way to add something: an exercise, a material, a course or community, an event, a tutoring listing, a post or a contest. Organisations are started from their own page instead.'
			],
			screenshot: {
				src: '/guide/start/05-account-menu.png',
				alt: 'The account menu open, in four groups: Learning — My decks, My contests; Taking part — My schedule, My agenda, Volunteering, My volunteering offers; Working together — Co-authoring, My tasks, My organisations, My work; Your account — Profile, Settings, Help & manual, Report issue, Log out.'
			}
		}
	],
	note: 'The pictures in this manual are of the English interface and of a test database. The names in them belong to demonstration accounts, not to real people.'
};

const PL: GuideChapterDoc = {
	title: 'Pierwsze kroki',
	lead: [
		'Do czytania nie potrzeba tu konta. Ten rozdział to pięć minut przed założeniem konta: co jest na stronie głównej, jak ustawić język, jak powiedzieć, dla kogo mają być treści, i co się zmienia, kiedy już się zarejestrujesz.'
	],
	steps: [
		{
			heading: 'Strona główna',
			tryHref: '/',
			body: [
				'Pole wyszukiwania, rząd przedziałów wiekowych i zakładki z najnowszymi zadaniami, materiałami, pojęciami, kursami, korepetycjami i wydarzeniami. Wyszukiwarka zagląda do treści i tytułów, więc „całka” albo „Cauchy” to sensowne hasła.',
				'Przy pierwszej wizycie nad zakładkami są trzy drzwi: ten rozdział, strony pokazujące, co robi każda część EdMatu, i prosta droga do zadań. Krzyżyk × chowa je w tej przeglądarce na dobre.',
				'Wszystko pod zakładkami to kafelki. Kafelek jest odnośnikiem; mały znak + na kafelku zadania wrzuca je do Twojego zestawu bez otwierania.'
			],
			screenshot: {
				src: '/guide/start/01-home.png',
				alt: 'Strona główna EdMatu: pole wyszukiwania, rząd przedziałów wiekowych, trzy drzwi dla pierwszej wizyty — „New here?”, „Curious first?” i „Rather dive in?” — zakładki z treściami i pierwsze kafelki zadań pod nagłówkiem „Top rated”.'
			}
		},
		{
			heading: 'Pasek u góry',
			body: [
				'Po lewej działy: zadania, materiały, kursy, rozeta prowadząca do konkursów, szukamy pomocy, korepetycje, „i” prowadzące do strony o nas i ikona kalendarza prowadząca do wydarzeń. Na węższym ekranie więcej z nich zamienia się w ikony, a na telefonie przenoszą się do menu pod przyciskiem ☰. Po prawej przełącznik motywu, przycisk wielkości tekstu („Aa”), wybór języka i Twój zestaw pod ikoną zakładki.',
				'Wybór języka zmienia tylko interfejs. To, w jakich językach widzisz treści, jest osobnym ustawieniem — i to rozdzielenie jest celowe: można chcieć angielskiego interfejsu i polskiego oryginału zadania.'
			],
			screenshot: {
				src: '/guide/start/02-header.png',
				alt: 'Górny pasek: logo EdMat, odnośniki do zadań, materiałów i kursów, rozeta konkursów, szukamy pomocy, korepetycje, ikony strony o nas i wydarzeń, a po prawej motyw, wielkość tekstu, wybór języka, zestaw i odnośniki do logowania i rejestracji.'
			}
		},
		{
			heading: 'Powiedz, dla kogo czytasz',
			body: [
				'Plakietki pod wyszukiwarką zawężają całą stronę główną do jednego przedziału wieku — wczesne lata, szkoła podstawowa, szkoła średnia, studia, dorośli, seniorzy. „Wszystko” to ustawienie domyślne i nie zawęża niczego.',
				'Wybrany przedział pamięta ta przeglądarka. Po zalogowaniu staje się ustawieniem konta, więc chodzi za Tobą między komputerami.'
			],
			screenshot: {
				src: '/guide/start/03-audience.png',
				alt: 'Plakietki przedziałów wiekowych: Everything, Early years, Primary school, Secondary school, University, Adult learners, Seniors.'
			}
		},
		{
			heading: 'Zakładanie konta',
			tryHref: '/register',
			tryFor: 'guests',
			body: [
				'Nazwa wyświetlana, e-mail, rok urodzenia, hasło, język, w którym wolisz czytać, i pole do zaznaczenia, że akceptujesz regulamin i znasz politykę prywatności — oba są odnośnikami, więc można je najpierw przeczytać. Rok urodzenia służy jednemu: sprawdzeniu, czy możesz samodzielnie założyć konto — i nie jest zapisywany, zapisywana jest tylko odpowiedź.',
				'Jeśli masz mniej niż 16 lat, konto zakłada rodzic lub opiekun ze swoich ustawień. Konto dziecka nie ma adresu e-mail i nic nigdy na nie nie jest wysyłane.',
				'Zapomniane hasło to odnośnik „Nie pamiętasz hasła?” na stronie logowania: wystarczy podać adres, na który założono konto, a przyjdzie na niego link do ustawienia nowego hasła.'
			],
			screenshot: {
				src: '/guide/start/04-register.png',
				alt: 'Formularz rejestracji: nazwa wyświetlana, e-mail, rok urodzenia, hasło i preferowany język interfejsu, pole „I accept the terms of use and have read the privacy policy” i przycisk „Sign up”.'
			}
		},
		{
			heading: 'Twoje własne menu',
			body: [
				'Po zalogowaniu Twoje nazwisko otwiera menu ze wszystkim, co należy do Ciebie, w czterech grupach: Learning (talie fiszek i konkursy), Taking part (grafik, plan dnia i wolontariat), Working together (współtworzone materiały, zadania do zrobienia, organizacje i panel pracy) oraz Your account (profil, ustawienia, ten podręcznik, zgłaszanie problemu i wylogowanie).',
				'Przycisk „+ Add…” obok to krótka droga do dodania czegoś: zadania, materiału, kursu albo społeczności, wydarzenia, ogłoszenia korepetycyjnego, wpisu albo konkursu. Organizacje zakłada się z ich własnej strony.'
			],
			screenshot: {
				src: '/guide/start/05-account-menu.png',
				alt: 'Otwarte menu konta w czterech grupach: Learning — My decks, My contests; Taking part — My schedule, My agenda, Volunteering, My volunteering offers; Working together — Co-authoring, My tasks, My organisations, My work; Your account — Profile, Settings, Help & manual, Report issue, Log out.'
			}
		}
	],
	note: 'Zrzuty w tym podręczniku pokazują interfejs po angielsku i bazę testową. Nazwiska na nich należą do kont demonstracyjnych, a nie do prawdziwych osób.'
};

export function startChapterFor(locale: string): GuideChapterDoc {
	return locale === 'en' ? EN : PL;
}
