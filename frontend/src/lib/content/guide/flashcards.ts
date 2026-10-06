/**
 * Chapter: flashcards — a PLACEHOLDER for this cycle.
 *
 * The flashcards app is step A of the learning cycle (`prompts/02-flashcards.md`) and is built on
 * its own branch. This chapter is written last, after that branch has merged and the screens exist
 * to photograph; until then it says so and sends the reader to the design showcase at
 * `/about/flashcards`, which draws the same screens from sample data.
 *
 * **Replacing it** is a self-contained job: add the steps here in both languages, take the
 * pictures by adding a `chapters.flashcards` block to `frontend/e2e/guide-screenshots.mjs`
 * (`static/guide/flashcards/`), and drop `pending` from the entry in `index.ts`. Nothing else
 * changes — the hub and the route already handle it.
 */
import type { GuideChapterDoc } from './types';

const EN: GuideChapterDoc = {
	title: 'Flashcards',
	lead: [
		'Not written yet. Decks of cards made from exercises, from a concept or from a set you saved, with a review schedule that brings a card back on the day you are about to forget it, are being built now; this chapter is written once they are real enough to photograph.',
		'In the meantime the design is drawn, with sample data, at /about/flashcards.'
	],
	steps: [],
	note: 'A chapter in this manual is only written against screens that exist. A page of promises is how a manual stops being worth reading.'
};

const PL: GuideChapterDoc = {
	title: 'Fiszki',
	lead: [
		'Jeszcze nienapisane. Talie fiszek robione z zadań, z pojęcia albo z zapisanego zestawu, wraz z harmonogramem powtórek, który podsuwa kartę w dniu, w którym masz ją zapomnieć, właśnie powstają; ten rozdział powstanie, kiedy będzie co sfotografować.',
		'Na razie projekt jest narysowany, na danych przykładowych, pod adresem /about/flashcards.'
	],
	steps: [],
	note: 'Rozdział tego podręcznika powstaje wyłącznie na podstawie ekranów, które istnieją. Strona obietnic to sposób, w jaki podręcznik przestaje być wart czytania.'
};

export function flashcardsChapterFor(locale: string): GuideChapterDoc {
	return locale === 'en' ? EN : PL;
}
