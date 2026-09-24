'use strict';
/**
 * Pilotaż: jeden realistyczny tydzień szkolny od pustej instalacji do piątkowego eksportu,
 * rozegrany wyłącznie przez publiczne API (`scripts/pilot.js`, `npm run pilot`).
 *
 * Ten test nie powtarza asercji poszczególnych historyjek — sprawdza to, czego żaden test
 * pojedynczej trasy nie sprawdza: **inwarianty międzyrolowe**. To, co zapisał nauczyciel, musi być
 * dokładnie tym, co widzi uczeń, oboje opiekunów (w tym opiekun z zakresem „info”), wychowawca
 * i dyrektor; średnie i procenty frekwencji muszą się zgadzać we wszystkich widokach, które je
 * pokazują; liczniki na pulpitach muszą równać się wierszom, które za nimi stoją; powiadomienia
 * mają docierać dokładnie do tych osób, których dotyczą; każdy zapis ma zostawić wiersz audytu
 * ze stanem przed i po; wydruk ma nieść te same liczby, co API; nic nie może odpowiedzieć 5xx.
 *
 * Przebieg trwa ~15 s na wolnej maszynie; budżet to dwie minuty. `EDMAT_SKIP_PILOT=1` go pomija
 * (np. w bardzo obciążonym CI) — wtedy i tylko wtedy test jest oznaczony jako pominięty.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { runPilot, printReport } = require('../scripts/pilot');

const BUDGET_MS = 120000;

test('[pilot] jeden tydzień szkolny przez publiczne API: inwarianty międzyrolowe trzymają', { skip: process.env.EDMAT_SKIP_PILOT === '1' ? 'EDMAT_SKIP_PILOT=1' : false, timeout: BUDGET_MS + 30000 }, async () => {
  const R = await runPilot({ quiet: true });

  // Pełny raport trafia do wyjścia testu tylko wtedy, gdy coś poszło nie tak — inaczej TAP tonie w tekście.
  if (R.violations.length) process.stderr.write(printReport(R) + '\n');

  const failed = R.violations.map((v) => `${v.id || v.kind}: ${v.name || ''}${v.detail ? ' — ' + v.detail : ''}`);
  assert.deepEqual(failed, [], 'pilotaż zgłosił naruszenia inwariantów');

  assert.equal(R.steps.filter((s) => s.error).length, 0, 'żaden krok tygodnia nie przerwał się błędem');
  assert.ok(R.steps.length >= 30, 'tydzień ma wszystkie kroki: ' + R.steps.length);
  assert.ok(R.invariants.length >= 200, 'sprawdzono komplet inwariantów: ' + R.invariants.length);
  assert.ok(R.calls >= 400, 'tydzień rozegrany przez API, nie na obiekcie magazynu: ' + R.calls);
  assert.deepEqual(R.serverErrors, [], 'żadna odpowiedź nie była nieoczekiwanym błędem serwera');
  assert.ok(R.ms < BUDGET_MS, `pilotaż zmieścił się w dwóch minutach (${R.ms} ms)`);

  /* Luki produktowe: wszystkie siedem (GAP-1…GAP-7) jest zamkniętych — pilotaż rozgrywa cały
     tydzień, łącznie z zakładaniem kadry, podstawy programowej, kont stołówkowych, stanu
     biblioteki, opłat, flag ucznia i zakresu dostępu opiekuna, **przez publiczne API**. Gdy
     którakolwiek wróci (albo dojdzie nowa), ta asercja przypomni o docs/PILOT.md §4. */
  assert.deepEqual(R.gaps.map((g) => g.id).sort(), [], 'pusta instalacja uruchamia się samą aplikacją — docs/PILOT.md §4');
});
