/**
 * `/about/contests` — what a contest is here, why the default one promises nothing, and what a
 * prize brings with it.
 *
 * The eighth showcase page (`CONTESTS-BRIEF.md` §3.B). It is the one page of the eight whose
 * subject is mostly **law**, and that changes what it has to do: the other seven describe a design,
 * and a reader who misunderstands one of them loses a feature. A reader who misunderstands this one
 * runs a contest that is *bezskuteczne* under KC art. 921 §1, or a lottery under the gambling act.
 * So every claim on it carries how well it was checked, and the page says in two places that
 * nobody on this project is a lawyer (`CONTESTS-LAW.md` §14).
 *
 * The samples are drawn from `backend/contests/presets.py` — not imported from it (Python), but
 * written against it, and `contests-personalise.mjs` is what checks that the ten presets named here
 * are the ten the API serves. The law rows quote `presets.LAW` with its own markers.
 *
 * See `content/showcase/index.ts` for why this text lives here rather than in the catalogues.
 */

import type { ShowcaseDoc, ShowcaseRow } from './index';

/** One preset as the page draws it: its name, who the organiser is, and whether it promises a
 *  prize. `staffOnly` is the two a user may not found (CONTESTS-LAW.md §14 item 9). */
export interface ShowcasePreset {
	key: string;
	name: string;
	summary: string;
	organiser: string;
	hasPrize: boolean;
	staffOnly?: boolean;
}

/** One row of the law table: what it says, and how well it was checked. */
export interface ShowcaseLawRow {
	citation: string;
	marker: 'verified' | 'secondary' | 'unverified' | 'disputed';
	consequence: string;
}

/** One thing the preset creates for an organiser, on the contest's own page. */
export interface ShowcaseCreated {
	module: string;
	what: string;
}

export interface ContestsShowcase extends ShowcaseDoc {
	noPrizeHeading: string;
	noPrizeBody: string[];
	presetsHeading: string;
	presetsBody: string[];
	presets: ShowcasePreset[];
	presetsCaption: string;
	lawHeading: string;
	lawBody: string[];
	law: ShowcaseLawRow[];
	lawCaption: string;
	createdHeading: string;
	createdBody: string[];
	created: ShowcaseCreated[];
	createdCaption: string;
	peopleHeading: string;
	peopleBody: string[];
	peopleRows: ShowcaseRow[];
	peopleCaption: string;
	platformHeading: string;
	platformBody: string[];
}

const EN: ContestsShowcase = {
	title: 'Contests, and what a prize brings with it',
	description:
		'How a contest works on EdMat: a jury, stages, a published ranking — and the Polish law that a promised prize turns on. Sample data, and not legal advice.',
	lead: [
		'A contest is the third thing people run here, after a course and an event, and it has one property neither of them has: the people taking part are judged, and the judging produces a ranking that outlives the contest.',
		'That ranking is why a contest needed its own app rather than a flag on an event. It is also why this page is half about law: the moment somebody promises a prize for the best work, Polish law has a great deal to say about it, and most of what it says is a deadline.'
	],
	points: [
		{
			heading: 'The organiser is a person, never this site',
			body: 'Whoever founded the contest is named above the fold on every page of it. They promised the prize, they decide the result, they are the controller of the entrants’ data and the payer of any tax. EdMat is where it happens and nothing more — no platform jury seat, no platform prize, no tie broken here.'
		},
		{
			heading: 'A draw is structurally impossible',
			body: 'There is no "decide by lot" anywhere: not as a way of advancing between stages, not as a tie-break. A stage whose description promises a draw (a "losowanie") is refused. Chance deciding any part of it would make the whole thing a lottery needing a permit, with two sets of penalties that stack.'
		},
		{
			heading: 'The default promises nothing',
			body: 'The first preset is a challenge with a jury, a ranking and no prize — which keeps it outside the public-promise rules, the gambling act and income tax entirely. Adding a prize is a separate, deliberate step, and it unlocks obligations rather than a field.'
		},
		{
			heading: 'Every citation says how well it was checked',
			body: 'Four words appear next to the article numbers on these pages: checked against the text, from an authoritative restatement, not checked, and disputed. The research behind them was not done by a lawyer, and a page that printed an article number as settled would be the dishonest part.'
		}
	],
	noPrizeHeading: 'What changes the moment a prize exists',
	noPrizeBody: [
		'Without a prize, a contest here is a problem set with a jury and a leaderboard. With one, it becomes a "przyrzeczenie publiczne" — a public promise of a reward — and five things become true at once.',
		'It needs a deadline within which the prize may be claimed, or the whole promise is ineffective and nobody can enforce it. It may not be revoked once somebody has performed, and a revocation has to use the same channel the announcement did — which means that if the announcement was here, so is the withdrawal. Chance may decide nothing. The prize is income, so somebody is the payer of the tax on it. And a minor can only enter with a guardian’s consent recorded against their entry.',
		'None of that is a reason not to offer a prize. It is a reason to know, before you do, that you have taken on five obligations — which is what the checklist on your contest’s own page is for.'
	],
	presetsHeading: 'Ten kinds of contest, because they are not the same thing',
	presetsBody: [
		'A teacher’s contest inside one school, an open internet contest with a prize pot, and a kurator’s "konkurs przedmiotowy" whose laureate is excused part of a state exam are three completely different legal animals. The wizard asks which one you are running first, and everything after that is prefilled from the answer.',
		'Two of the ten can only be founded by a platform operator. A false claim that a contest is the kurator’s harms pupils who believe they are earning an exam exemption, so those two require a link to the kurator’s or the committee’s own announcement and are not a user’s to start.'
	],
	presets: [
		{
			key: 'challenge',
			name: 'Challenge (no prize)',
			summary:
				'A problem set with a jury and a published ranking. Outside the public-promise, gambling and tax rules entirely. The default.',
			organiser: 'A person',
			hasPrize: false
		},
		{
			key: 'school',
			name: 'School contest',
			summary:
				'Pupils of one school, a teacher or the school as organiser, every entrant a minor. Guardian consent on every entry; initials on the results list.',
			organiser: 'A person',
			hasPrize: true
		},
		{
			key: 'staged',
			name: 'Multi-stage contest',
			summary:
				'A qualifying round online and a final — stages without pretending to be a kurator’s. Advancement by threshold or top-N.',
			organiser: 'A person',
			hasPrize: true
		},
		{
			key: 'university',
			name: 'University or faculty contest',
			summary:
				'For students. The university, not the faculty, is the legal person behind it — which decides who the payer and the controller are.',
			organiser: 'An organisation',
			hasPrize: true
		},
		{
			key: 'student_circle',
			name: 'Student circle contest',
			summary:
				'As the university one, with the university named as the body behind the circle, and an "approved by" line for its supervisor.',
			organiser: 'An organisation',
			hasPrize: true
		},
		{
			key: 'organization',
			name: 'On behalf of an organisation',
			summary:
				'An organisation this site already knows is the organiser, so its identity is inherited rather than asked for again.',
			organiser: 'An organisation',
			hasPrize: true
		},
		{
			key: 'open_online',
			name: 'Open online contest with prizes',
			summary:
				'Anyone may enter and a prize is promised: the full rules, the full tax block, the explicit no-draw attestation. The riskiest kind.',
			organiser: 'A person',
			hasPrize: true
		},
		{
			key: 'team',
			name: 'Team contest',
			summary:
				'Teams enter together, so the rules must say how a team prize is split — otherwise a disputed joint prize is a matter for a court.',
			organiser: 'A person',
			hasPrize: true
		},
		{
			key: 'kuratorium',
			name: 'Kurator’s subject contest',
			summary:
				'Organised by the kurator oświaty under the 2002 regulation. A laureate is excused that part of the eighth-grade exam.',
			organiser: 'A kurator oświaty',
			hasPrize: true,
			staffOnly: true
		},
		{
			key: 'olympiad',
			name: 'Subject olympiad',
			summary:
				'Three fixed stages, a main committee at a university, a mandatory appeal procedure. A laureate is excused the matura in that subject.',
			organiser: 'A committee',
			hasPrize: true,
			staffOnly: true
		}
	],
	presetsCaption:
		'The ten presets, each with who the organiser is and whether it promises a prize. The last two are marked as platform-operators-only.',
	lawHeading: 'The five rules the module is built around',
	lawBody: [
		'These are design decisions taken from the research, not advice, and each of them is the owner’s to overturn. What matters is that they are structural: the claim deadline is a field the contest cannot be announced without, and the draw is not a setting that is switched off but a thing with no code behind it.'
	],
	law: [
		{
			citation: 'Kodeks cywilny art. 921 §1',
			marker: 'verified',
			consequence:
				'No deadline for claiming the prize and the whole promise is ineffective. So a contest with a prize cannot be announced here until the deadline is set, and the refusal says which field is missing.'
		},
		{
			citation: 'Kodeks cywilny art. 919 §2',
			marker: 'verified',
			consequence:
				'A promise with no deadline is freely revocable, and a revocation must use the same channel as the announcement — and never works against somebody who has already performed. Cancelling a contest here posts the notice where the announcement was.'
		},
		{
			citation: 'Kodeks cywilny art. 921 §2',
			marker: 'verified',
			consequence:
				'The organiser judges unless the rules create a jury. So the rules template creates one, and a contest cannot be announced without at least the minimum the preset asks for — three is the recommendation.'
		},
		{
			citation: 'Ustawa o grach hazardowych art. 2 ust. 1',
			marker: 'secondary',
			consequence:
				'If chance decides any stage, it is a game of chance needing a permit. There is no draw anywhere in this module, and a stage that describes one is refused.'
		},
		{
			citation: 'PIT art. 21 ust. 1 pkt 68',
			marker: 'disputed',
			consequence:
				'Prizes up to 2 000 zł in contests "in the field of science" are exempt. The other limb of the same provision — contests announced in the mass media — is genuinely disputed for the internet, so the tax block never offers it.'
		},
		{
			citation: 'RODO art. 8',
			marker: 'verified',
			consequence:
				'Under sixteen, the consent is the guardian’s — Poland did not lower the age. A minor may enter a contest whose rules allow it, with that consent recorded against the entry, and may not write a complaint themself.'
		}
	],
	lawCaption:
		'Six rules, each with what it does to the module and how well the citation was checked. Nothing here is legal advice.',
	createdHeading: 'What founding one gives you, without asking',
	createdBody: [
		'A contest is a lot of administration, and almost all of it is the same administration every time. So choosing a preset does not only prefill a form: it writes the work onto the contest’s own page, through the same panels a course or an event already uses.',
		'All of it is yours to edit, delete or ignore. A module a moderator has switched off is simply not written, and the report after founding says which — it does not pretend.'
	],
	created: [
		{
			module: 'A plan',
			what: 'The timeline, one step per phase: announce, registration opens and closes, each stage opening and closing, judging, results, the complaints window closing, prizes handed over, closed. Due dates worked out from your own dates.'
		},
		{
			module: 'A goal',
			what: 'The definition of done, one line per condition — the rules published, the jury appointed, every stage scored, results out, every complaint answered. It reads as met when the lines are ticked and in no other way.'
		},
		{
			module: 'Tasks',
			what: 'One per item of the legal checklist, on the organiser or the secretary by role, due by phase, each carrying the article it comes from, how well that article was checked, and the sentence saying none of it is advice.'
		},
		{
			module: 'Needs',
			what: '"Jury member wanted", and a proctor for an on-site stage. An open need is readable by everybody, which is the point — it is how a contest asks the site for help instead of only its own staff.'
		},
		{
			module: 'A poll',
			what: '"Confirm the final ranking", for the jury, as a draft. A vote there records agreement; it decides nothing the criteria did not already decide.'
		}
	],
	createdCaption:
		'The five things a preset writes onto a new contest’s page, each through the module that owns it.',
	peopleHeading: 'The people you already work with',
	peopleBody: [
		'The hardest part of founding anything here used to be finding the people: there is no name search on this site, so putting somebody on a jury meant knowing their account number.',
		'So the wizard asks a different question. It offers the people you already share a roster with — staff on a course you teach, staff on an event you host, members of your organisations, people on your co-authored materials — and says beside each one why they are being suggested. Typing an account number still works, for somebody the site has never seen you with.'
	],
	peopleRows: [
		{ label: 'Jury', title: 'Michał Zawadzki', note: 'staff with you on Analiza I' },
		{ label: 'Jury', title: 'Ola Nowakowska', note: 'staff with you on Dzień Otwarty' },
		{ label: 'Secretary', title: 'Bartek Lis', note: 'member of Koło Naukowe Matematyki' },
		{ label: 'Proctor', title: 'by account id', note: 'the fallback for somebody new' }
	],
	peopleCaption:
		'The role pickers in the wizard, each suggestion carrying the roster it comes from. "By account id" is the fallback.',
	platformHeading: 'Why EdMat takes no part in it',
	platformBody: [
		'No prize money passes through this site, there is no entry fee and there never will be — the module has no payment field of any kind, and a prize’s value is recorded only so the tax paragraph can be written. EdMat does not verify that a prize exists, does not promise it will be given, and a dispute about one is between the entrant and the organiser.',
		'That is not modesty. Funding a prize, sitting on a jury, breaking a tie or letting this site’s name dominate an announcement are exactly the facts that would make a court treat EdMat as a co-organiser, bound by the promise alongside the person who made it. Keeping out of it is a structural choice, and these pages are built to it.',
		'What EdMat does owe is to act when somebody reports a contest — a prize that does not exist, a name used without permission. A contest can be reported like anything else here, and a decision about one comes with its reasons.'
	],
	closing:
		'The research this page stands on is in CONTESTS-LAW.md in the repository, with every source and every open question ranked. Nothing on this page has been read by a Polish lawyer, and the parts that most need one are marked.',
	tryIt: [{ label: 'Browse the contests', route: '/contests' }],
	// The manual's own pictures (`e2e/guide-screenshots.mjs`, the contests chapter), looked at against
	// today's screens before use (2026-10-15, WP10). They are of the seeded demo contests.
	shots: [
		{
			src: '/guide/contests/01-hub.png',
			focus: [136, 1144],
			width: 1280,
			height: 660,
			route: '/contests',
			alt: 'Screenshot of the Contests page: a search box, Status and Kind filters, the tabs All, I run these, I am judging and I am taking part, and three contest cards — two prize-free weekly challenges organised by Michał Zieliński and “Konkurs z analizy II — jesień 2026” organised by Kasia Wiśniewska, with a prize and its results published — each saying when it starts and how many have entered.',
			caption:
				'Every contest names its organiser on its card, says whether there is a prize, and says how far it has got.'
		},
		{
			src: '/guide/contests/06-kind.png',
			focus: [206, 1074],
			width: 1280,
			height: 706,
			route: '/contests',
			linkLabel: 'Start one from the contests page',
			alt: 'Screenshot of the first step of founding a contest, “What kind of contest is this?”: Challenge (no prize) selected, then School contest (a teacher runs it), Multi-stage contest (not a kurator’s) and University or faculty contest, each with chips naming who organises it, whether there is a prize, the tax rule that applies and the smallest jury.',
			caption:
				'The first question the wizard asks is which kind of contest this is. The default promises no prize.'
		},
		{
			src: '/guide/contests/10-compliance.png',
			focus: [136, 1144],
			width: 1280,
			height: 760,
			alt: 'Screenshot of “What the law asks of the organiser” on a contest with a prize: a note that this is not legal advice, a count of 14 done, 0 still missing and 2 that only a person can check, the tax on the prize with its citations marked restated or disputed, and obligations marked DONE, each with the articles it rests on.',
			caption:
				'Only the organiser sees this checklist: every obligation the prize brought with it, and how well each citation was checked.'
		},
		{
			src: '/guide/contests/04-results.png',
			focus: [225, 1054],
			width: 1280,
			height: 378,
			route: '/contests',
			linkLabel: 'Find a contest’s results',
			alt: 'Screenshot of the published results of “Konkurs z analizy II — jesień 2026”: a ranking of four entrants shown by their initials, with points out of 15 and their titles — Laureate, Finalist, Distinction, Took part — and the reader’s own row marked “that is you”.',
			caption:
				'Published results show initials, unless an entrant has separately agreed to their full name.'
		}
	]
};

const PL: ContestsShowcase = {
	title: 'Konkursy i to, co przynosi ze sobą nagroda',
	description:
		'Jak działa konkurs w EdMacie: jury, etapy, publikowany ranking — i polskie prawo, które włącza przyrzeczona nagroda. Dane przykładowe, nie porada prawna.',
	lead: [
		'Konkurs to trzecia rzecz, którą prowadzi się tutaj, po kursie i wydarzeniu, i ma jedną cechę, której nie ma żadne z nich: uczestnicy są oceniani, a ocena daje ranking, który zostaje po konkursie.',
		'Ten ranking jest powodem, dla którego konkurs dostał własną aplikację, a nie przełącznik przy wydarzeniu. Jest też powodem, dla którego ta strona w połowie mówi o prawie: w chwili, w której ktoś przyrzeka nagrodę za najlepszą pracę, polskie prawo ma o tym bardzo dużo do powiedzenia, a większość tego, co mówi, to terminy.'
	],
	points: [
		{
			heading: 'Organizatorem jest człowiek, nigdy ten serwis',
			body: 'Osoba, która założyła konkurs, jest wskazana na każdej jego stronie, nad zgięciem. To ona przyrzekła nagrodę, ona rozstrzyga wynik, ona jest administratorem danych uczestników i płatnikiem podatku. EdMat jest miejscem, w którym się to dzieje, i niczym więcej — bez miejsca w jury, bez nagrody od platformy, bez rozstrzygania remisów.'
		},
		{
			heading: 'Losowanie jest strukturalnie niemożliwe',
			body: 'Nigdzie nie ma „rozstrzygnięcia losem”: ani jako sposobu awansu między etapami, ani jako rozstrzygnięcia remisu. Etap, którego opis obiecuje losowanie, zostaje odrzucony. Gdyby los decydował o którejkolwiek części, całość byłaby grą losową wymagającą zezwolenia, z dwiema kumulującymi się sankcjami.'
		},
		{
			heading: 'Wariant domyślny niczego nie obiecuje',
			body: 'Pierwszy wariant to wyzwanie z jury i rankingiem, bez nagrody — co trzyma je całkowicie poza przepisami o przyrzeczeniu publicznym, ustawą hazardową i podatkiem dochodowym. Dodanie nagrody to osobny, świadomy krok, który odblokowuje obowiązki, a nie pole w formularzu.'
		},
		{
			heading: 'Każde powołanie mówi, jak zostało sprawdzone',
			body: 'Przy numerach artykułów pojawiają się cztery słowa: sprawdzone w tekście, z autorytatywnego omówienia, niesprawdzone i sporne. Badania, na których to stoi, nie robił prawnik, a strona, która podawałaby numer artykułu jako pewnik, byłaby tu częścią nieuczciwą.'
		}
	],
	noPrizeHeading: 'Co się zmienia w chwili, w której jest nagroda',
	noPrizeBody: [
		'Bez nagrody konkurs jest tutaj zestawem zadań z jury i tabelą wyników. Z nagrodą staje się przyrzeczeniem publicznym — i pięć rzeczy robi się prawdziwych naraz.',
		'Potrzebny jest termin, w którym można ubiegać się o nagrodę, bo inaczej całe przyrzeczenie jest bezskuteczne i nikt go nie wyegzekwuje. Nie można go odwołać wobec osoby, która już wykonała zadanie, a odwołanie musi pójść tym samym kanałem, co ogłoszenie — czyli jeśli ogłoszenie było tutaj, to odwołanie też. Los nie może decydować o niczym. Nagroda jest przychodem, więc ktoś jest płatnikiem podatku od niej. A osoba niepełnoletnia może wziąć udział tylko ze zgodą opiekuna zapisaną przy zgłoszeniu.',
		'Nic z tego nie jest powodem, żeby nie dawać nagrody. To powód, żeby wiedzieć, zanim się ją da, że bierze się na siebie pięć obowiązków — i po to właśnie jest lista kontrolna na stronie własnego konkursu.'
	],
	presetsHeading: 'Dziesięć rodzajów konkursu, bo to nie to samo',
	presetsBody: [
		'Konkurs nauczyciela w jednej szkole, otwarty konkurs internetowy z pulą nagród i kuratoryjny konkurs przedmiotowy, którego laureat jest zwolniony z części egzaminu państwowego, to trzy zupełnie różne zwierzęta prawne. Kreator pyta najpierw, który z nich prowadzisz, a wszystko dalej jest wypełnione na podstawie odpowiedzi.',
		'Dwa z dziesięciu może założyć tylko operator platformy. Fałszywe twierdzenie, że konkurs jest kuratoryjny, szkodzi uczniom, którzy wierzą, że zdobywają zwolnienie z egzaminu, więc te dwa wymagają linku do własnego ogłoszenia kuratora albo komitetu i nie są do założenia przez użytkownika.'
	],
	presets: [
		{
			key: 'challenge',
			name: 'Wyzwanie (bez nagrody)',
			summary:
				'Zestaw zadań z jury i publikowanym rankingiem. Całkowicie poza przepisami o przyrzeczeniu publicznym, hazardzie i podatku. Wariant domyślny.',
			organiser: 'Osoba',
			hasPrize: false
		},
		{
			key: 'school',
			name: 'Konkurs szkolny',
			summary:
				'Uczniowie jednej szkoły, nauczyciel albo szkoła jako organizator, każdy uczestnik niepełnoletni. Zgoda opiekuna przy każdym zgłoszeniu; inicjały na liście wyników.',
			organiser: 'Osoba',
			hasPrize: true
		},
		{
			key: 'staged',
			name: 'Konkurs wieloetapowy',
			summary:
				'Runda kwalifikacyjna online i finał — etapy bez udawania konkursu kuratoryjnego. Awans progiem albo top-N.',
			organiser: 'Osoba',
			hasPrize: true
		},
		{
			key: 'university',
			name: 'Konkurs uczelniany lub wydziałowy',
			summary:
				'Dla studentów. Osobą prawną stojącą za konkursem jest uczelnia, nie wydział — a to rozstrzyga, kto jest płatnikiem i administratorem.',
			organiser: 'Organizacja',
			hasPrize: true
		},
		{
			key: 'student_circle',
			name: 'Konkurs koła naukowego',
			summary:
				'Jak uczelniany, z uczelnią wskazaną jako podmiot stojący za kołem i linią „zatwierdzone przez” dla opiekuna.',
			organiser: 'Organizacja',
			hasPrize: true
		},
		{
			key: 'organization',
			name: 'W imieniu organizacji',
			summary:
				'Organizatorem jest organizacja, którą ten serwis już zna, więc jej tożsamość jest dziedziczona, a nie wpisywana ponownie.',
			organiser: 'Organizacja',
			hasPrize: true
		},
		{
			key: 'open_online',
			name: 'Otwarty konkurs internetowy z nagrodami',
			summary:
				'Każdy może wziąć udział, a nagroda jest przyrzeczona: pełny regulamin, pełny blok podatkowy, wyraźne oświadczenie o braku losowania. Najbardziej ryzykowny rodzaj.',
			organiser: 'Osoba',
			hasPrize: true
		},
		{
			key: 'team',
			name: 'Konkurs zespołowy',
			summary:
				'Zespoły zgłaszają się razem, więc regulamin musi mówić, jak dzieli się nagrodę zespołową — inaczej sporną nagrodę wspólną dzieli sąd.',
			organiser: 'Osoba',
			hasPrize: true
		},
		{
			key: 'kuratorium',
			name: 'Konkurs przedmiotowy kuratoryjny',
			summary:
				'Organizowany przez kuratora oświaty na podstawie rozporządzenia z 2002 r. Laureat jest zwolniony z tej części egzaminu ósmoklasisty.',
			organiser: 'Kurator oświaty',
			hasPrize: true,
			staffOnly: true
		},
		{
			key: 'olympiad',
			name: 'Olimpiada przedmiotowa',
			summary:
				'Trzy stałe etapy, komitet główny przy uczelni, obowiązkowy tryb odwoławczy. Laureat jest zwolniony z matury z tego przedmiotu.',
			organiser: 'Komitet',
			hasPrize: true,
			staffOnly: true
		}
	],
	presetsCaption:
		'Dziesięć wariantów, każdy z informacją, kim jest organizator i czy obiecuje nagrodę. Dwa ostatnie oznaczone jako dostępne tylko dla operatora platformy.',
	lawHeading: 'Pięć reguł, na których zbudowany jest ten moduł',
	lawBody: [
		'To decyzje projektowe wzięte z badań, a nie porada, i każdą z nich właściciel projektu może zmienić. Istotne jest to, że są strukturalne: termin ubiegania się o nagrodę to pole, bez którego konkursu nie da się ogłosić, a losowanie nie jest wyłączonym ustawieniem, lecz rzeczą, pod którą nie ma żadnego kodu.'
	],
	law: [
		{
			citation: 'Kodeks cywilny art. 921 §1',
			marker: 'verified',
			consequence:
				'Bez terminu ubiegania się o nagrodę całe przyrzeczenie jest bezskuteczne. Dlatego konkursu z nagrodą nie da się tu ogłosić, dopóki termin nie jest ustalony, a odmowa mówi, którego pola brakuje.'
		},
		{
			citation: 'Kodeks cywilny art. 919 §2',
			marker: 'verified',
			consequence:
				'Przyrzeczenie bez terminu można swobodnie odwołać, odwołanie musi pójść tym samym kanałem, co ogłoszenie, i nigdy nie działa wobec kogoś, kto już wykonał zadanie. Odwołanie konkursu tutaj publikuje zawiadomienie tam, gdzie było ogłoszenie.'
		},
		{
			citation: 'Kodeks cywilny art. 921 §2',
			marker: 'verified',
			consequence:
				'Ocenia przyrzekający, chyba że regulamin powoła jury. Dlatego szablon regulaminu je powołuje, a konkursu nie da się ogłosić bez minimalnego składu z wariantu — zalecane są trzy osoby.'
		},
		{
			citation: 'Ustawa o grach hazardowych art. 2 ust. 1',
			marker: 'secondary',
			consequence:
				'Jeśli o którymkolwiek etapie decyduje los, jest to gra losowa wymagająca zezwolenia. W tym module nie ma losowania nigdzie, a etap, który je opisuje, zostaje odrzucony.'
		},
		{
			citation: 'PIT art. 21 ust. 1 pkt 68',
			marker: 'disputed',
			consequence:
				'Nagrody do 2 000 zł w konkursach „w dziedzinie nauki” są zwolnione. Drugi człon tego samego przepisu — konkursy ogłaszane w środkach masowego przekazu — jest przy internecie naprawdę sporny, więc blok podatkowy nigdy go nie proponuje.'
		},
		{
			citation: 'RODO art. 8',
			marker: 'verified',
			consequence:
				'Poniżej szesnastu lat zgodę wyraża opiekun — Polska nie obniżyła tego wieku. Osoba niepełnoletnia może wziąć udział w konkursie, którego regulamin to dopuszcza, z tą zgodą zapisaną przy zgłoszeniu, i nie może sama złożyć reklamacji.'
		}
	],
	lawCaption:
		'Sześć reguł, każda z tym, co robi w module, i z informacją, jak dobrze sprawdzono powołanie. Nic tutaj nie jest poradą prawną.',
	createdHeading: 'Co daje samo założenie konkursu',
	createdBody: [
		'Konkurs to dużo administracji i prawie cała ta administracja jest za każdym razem taka sama. Dlatego wybór wariantu nie tylko wypełnia formularz: zapisuje pracę na stronie samego konkursu, przez te same panele, których używa już kurs albo wydarzenie.',
		'Wszystko to można zmienić, usunąć albo zignorować. Moduł, który moderator wyłączył, po prostu nie zostaje zapisany, a raport po założeniu mówi, który — nie udaje.'
	],
	created: [
		{
			module: 'Plan',
			what: 'Kalendarz, krok na fazę: ogłoszenie, otwarcie i zamknięcie zapisów, otwarcie i zamknięcie każdego etapu, ocenianie, wyniki, zamknięcie okna reklamacji, wydanie nagród, zamknięcie. Terminy wyliczone z Twoich własnych dat.'
		},
		{
			module: 'Cel',
			what: 'Definicja ukończenia, linia na warunek — regulamin opublikowany, jury powołane, każdy etap oceniony, wyniki ogłoszone, każda reklamacja z odpowiedzią. Cel jest osiągnięty, kiedy linie są odhaczone, i w żaden inny sposób.'
		},
		{
			module: 'Zadania',
			what: 'Po jednym na pozycję listy kontrolnej, na organizatorze albo sekretarzu zależnie od roli, z terminem zależnym od fazy, każde z artykułem, z którego wynika, z informacją, jak dobrze ten artykuł sprawdzono, i ze zdaniem, że nic z tego nie jest poradą.'
		},
		{
			module: 'Potrzeby',
			what: '„Poszukiwany członek jury” i opiekun etapu stacjonarnego. Otwartą potrzebę widzi każdy, i to jest sens — tak konkurs prosi serwis o pomoc, a nie tylko własnych organizatorów.'
		},
		{
			module: 'Głosowanie',
			what: '„Zatwierdzenie końcowego rankingu”, dla jury, jako wersja robocza. Głos zapisuje zgodę; nie rozstrzyga niczego, czego nie rozstrzygnęły już kryteria.'
		}
	],
	createdCaption:
		'Pięć rzeczy, które wariant zapisuje na stronie nowego konkursu, każda przez moduł, który za nią odpowiada.',
	peopleHeading: 'Ludzie, z którymi już pracujesz',
	peopleBody: [
		'Najtrudniejszą częścią zakładania czegokolwiek tutaj było znalezienie ludzi: w tym serwisie nie ma wyszukiwania po nazwisku, więc posadzenie kogoś w jury wymagało znania numeru jego konta.',
		'Dlatego kreator pyta inaczej. Proponuje osoby, z którymi już dzielisz jakąś listę — współprowadzących kurs, który uczysz, organizatorów wydarzenia, które prowadzisz, członków Twoich organizacji, osoby współtworzące z Tobą materiały — i obok każdej pisze, skąd ta podpowiedź. Wpisanie numeru konta dalej działa, dla kogoś, kogo serwis nigdy z Tobą nie widział.'
	],
	peopleRows: [
		{ label: 'Jury', title: 'Michał Zawadzki', note: 'współprowadzi z Tobą Analizę I' },
		{ label: 'Jury', title: 'Ola Nowakowska', note: 'współorganizuje z Tobą Dzień Otwarty' },
		{ label: 'Sekretarz', title: 'Bartek Lis', note: 'członek Koła Naukowego Matematyki' },
		{ label: 'Opiekun etapu', title: 'po numerze konta', note: 'rozwiązanie dla kogoś nowego' }
	],
	peopleCaption:
		'Wybór osób do roli w kreatorze; przy każdej podpowiedzi lista, z której pochodzi. „Po numerze konta” to rozwiązanie zapasowe.',
	platformHeading: 'Dlaczego EdMat nie bierze w tym udziału',
	platformBody: [
		'Przez ten serwis nie przechodzą żadne pieniądze na nagrody, nie ma opłaty za udział i nigdy nie będzie — moduł nie ma żadnego pola płatności, a wartość nagrody jest zapisywana tylko po to, żeby dało się napisać paragraf podatkowy. EdMat nie sprawdza, czy nagroda istnieje, nie obiecuje, że zostanie wydana, a spór o nią jest między uczestnikiem a organizatorem.',
		'To nie skromność. Finansowanie nagrody, zasiadanie w jury, rozstrzyganie remisów albo dominacja nazwy tego serwisu w ogłoszeniu to dokładnie te okoliczności, w których sąd mógłby uznać EdMat za współorganizatora, związanego przyrzeczeniem razem z osobą, która je złożyła. Trzymanie się z boku jest decyzją strukturalną, a te strony są pod nią zbudowane.',
		'Czego EdMat jest winien, to zadziałać, kiedy ktoś zgłosi konkurs — nagrodę, której nie ma, nazwę użytą bez prawa. Konkurs można zgłosić jak wszystko inne tutaj, a decyzja o nim przychodzi z uzasadnieniem.'
	],
	closing:
		'Badania, na których stoi ta strona, są w pliku CONTESTS-LAW.md w repozytorium, z każdym źródłem i z pytaniami otwartymi ułożonymi według wagi. Nic na tej stronie nie było czytane przez polskiego prawnika, a te fragmenty, które najbardziej go potrzebują, są oznaczone.',
	tryIt: [{ label: 'Przeglądaj konkursy', route: '/contests' }],
	shots: [
		{
			src: '/guide/contests/01-hub.png',
			focus: [136, 1144],
			width: 1280,
			height: 660,
			route: '/contests',
			alt: 'Zrzut ekranu strony konkursów: wyszukiwarka, filtry stanu i rodzaju, zakładki All, I run these, I am judging i I am taking part oraz trzy kafelki konkursów — dwa wyzwania tygodnia bez nagrody, które organizuje Michał Zieliński, i „Konkurs z analizy II — jesień 2026” Kasi Wiśniewskiej, z nagrodą i opublikowanymi wynikami — na każdym data startu i liczba zgłoszonych.',
			caption:
				'Każdy konkurs ma na kafelku swojego organizatora, informację, czy jest nagroda, i to, na jakim jest etapie.'
		},
		{
			src: '/guide/contests/06-kind.png',
			focus: [206, 1074],
			width: 1280,
			height: 706,
			route: '/contests',
			linkLabel: 'Załóż konkurs ze strony konkursów',
			alt: 'Zrzut ekranu pierwszego kroku zakładania konkursu, „What kind of contest is this?”: zaznaczone Challenge (no prize), a pod nim School contest (a teacher runs it), Multi-stage contest (not a kurator’s) i University or faculty contest — przy każdym plakietki z tym, kto organizuje, czy jest nagroda, jaka reguła podatkowa obowiązuje i jakie jest najmniejsze jury.',
			caption:
				'Pierwsze pytanie kreatora brzmi: jaki to rodzaj konkursu. Domyślny nie obiecuje żadnej nagrody.'
		},
		{
			src: '/guide/contests/10-compliance.png',
			focus: [136, 1144],
			width: 1280,
			height: 760,
			alt: 'Zrzut ekranu „What the law asks of the organiser” przy konkursie z nagrodą: zastrzeżenie, że to nie porada prawna, licznik 14 zrobionych, 0 brakujących i 2 do sprawdzenia przez człowieka, podatek od nagrody z przepisami oznaczonymi jako streszczone albo sporne oraz obowiązki oznaczone DONE, każdy z artykułami, na których się opiera.',
			caption:
				'Tę listę widzi tylko organizator: każdy obowiązek, który przyniosła ze sobą nagroda, i to, jak dokładnie sprawdzono każdy przepis.'
		},
		{
			src: '/guide/contests/04-results.png',
			focus: [225, 1054],
			width: 1280,
			height: 378,
			route: '/contests',
			linkLabel: 'Znajdź wyniki konkursu',
			alt: 'Zrzut ekranu opublikowanych wyników „Konkurs z analizy II — jesień 2026”: ranking czworga uczestników podpisanych inicjałami, z punktami na 15 i tytułami — Laureate, Finalist, Distinction, Took part — oraz wiersz czytającej osoby oznaczony „that is you”.',
			caption:
				'Opublikowane wyniki pokazują inicjały, chyba że ktoś osobno zgodził się na pełne imię i nazwisko.'
		}
	]
};

export function contestsShowcaseFor(locale: string): ContestsShowcase {
	return locale === 'pl' ? PL : EN;
}
