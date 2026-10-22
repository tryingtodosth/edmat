// The example file `/submit/bulk` offers for download (built in the browser from this string — no
// request). It is the format reference's own shape (`.claude/skills/import-exercises/reference/
// format.md`): a whole exercise with a hint, an answer and a solution, then one part. Kept in
// Polish because the corpus and the section headings are; the English headings work too.
export const BULK_UPLOAD_EXAMPLE = `---
title: Pochodna złożenia
difficulty: średnie
tags: [pochodna]
source:
  type: Ćwiczenia
  name: Seria 3, zadanie 2
---
## Treść
Policz pochodną funkcji \\(f(x)=\\sin(x^2)\\).

## Wskazówka
Skorzystaj z reguły łańcuchowej.

## Odpowiedź
\\(f'(x)=2x\\cos(x^2)\\)

## Rozwiązanie
Z reguły łańcuchowej:

\\[
f'(x)=\\cos(x^2)\\cdot(x^2)'=2x\\cos(x^2).
\\]

## Podpunkt a

## Treść
Policz \\(f'(0)\\).

## Odpowiedź
\\(f'(0)=0\\)
`;
