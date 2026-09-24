'use strict';
/* Seed 3.5 — sekretariat i administracja: rejestr obwodowy, legitymacje cyfrowe, kody rejestracyjne,
   przykładowa lista dozwolonych adresów IP (sama lista zostaje PUSTA, żeby nie odciąć administratora). */

function seed(db, ctx) {
  const cfg = db.data.config;

  /* --- bezpieczeństwo sieciowe (3.5.12) --------------------------------------------------- */
  cfg.ipAllowlist = [];                                                  // celowo puste: brak ograniczenia = brak ryzyka zablokowania konta admin
  cfg.ipAllowlistExample = ['193.219.28.14', '10.12.0.0/24', '83.16.204.7'];
  cfg.ipAllowlistNote = 'Lista jest pusta — logowania administracyjne nie są ograniczone adresem. Wzorzec wpisów: config.ipAllowlistExample.';

  /* --- retencja logów (3.5.15) ------------------------------------------------------------ */
  cfg.logRetentionYears = cfg.logRetentionYears || 5;
  cfg.logRetentionMinYears = 5;                                          // minimum wynikające z przepisów o rozliczalności
  cfg.gradesArchiveRetentionYears = cfg.gradesArchiveRetentionYears || 50;
  cfg.gradesArchiveRetentionMinYears = 50;
  cfg.auditImmutable = true;                                             // WORM: wpisy audytowe są tylko do odczytu

  /* --- 2FA dla edytujących oceny i frekwencję (3.5.7) ------------------------------------- */
  // config.require2FAForGradeEditors jest w bazowym seedzie włączone — odwzorowujemy to na kontach,
  // żeby tabela stanu 2FA i flaga mustSetup2FA w sesji zgadzały się z polityką od pierwszego uruchomienia.
  if (cfg.require2FAForGradeEditors) for (const u of db.col('users')) if (['teacher', 'principal', 'supportTeacher'].includes(u.role)) { u.totpRequired = true; u.mustSetup2FA = !u.totpEnabled; }

  /* --- pakiet SIO (3.5.3) ----------------------------------------------------------------- */
  cfg.sio = { schemaVersion: '1.0', reportDate: cfg.today, namespace: 'https://sio.men.gov.pl/schemat/1.0' };

  /* --- legitymacja cyfrowa (3.5.2) -------------------------------------------------------- */
  db.col('studentIds');
  db.data.studentIds.push({
    id: 'sid_kowalczyk_anna', studentId: 'st_kowalczyk_anna', code: '9K4T-2M8R-QX57',
    issuedAt: '2026-09-04T09:12:00Z', issuedByUserId: 'u_sekretariat', validTo: '2027-09-30',
    status: 'issued', app: 'mObywatel', createdAt: '2026-09-04T09:12:00Z'
  });

  /* --- kody rejestracyjne dla rodziców klas pierwszych (3.5.11) --------------------------- */
  db.col('registrationCodes');
  db.data.registrationCodes.push({
    id: 'rc_kot_stanislaw', code: '1A-KRQT-3N7W', studentId: 'st_kot_stanisaw', classId: '1a',
    createdAt: '2026-09-02T07:30:00Z', byUserId: 'u_admin', expiresAt: '2027-06-30', usedAt: null, usedByUserId: null
  });

  /* --- duplikaty świadectw (3.5.10) ------------------------------------------------------- */
  db.col('duplicates');

  /* --- rejestr obwodowy: obowiązek przygotowania przedszkolnego (3.5.14) ------------------ */
  const child = (id, first, last, year, address, institution, reported, extra) => db.data.districtChildren.push(Object.assign({
    id, firstName: first, lastName: last, birthYear: year, address,
    institution: institution || null, reported: !!reported, reportedAt: reported ? '2026-09-15' : null,
    reportedByUserId: reported ? 'u_sekretariat' : null, summonedAt: null, note: '', createdAt: '2026-09-01T06:00:00Z'
  }, extra || {}));
  db.data.districtChildren = [];
  child('dc_adamczyk_maja', 'Maja', 'Adamczyk', 2019, 'ul. Lea 114/3, 30-133 Kraków', 'SP nr 12, oddział przedszkolny', true);
  child('dc_baran_filip', 'Filip', 'Baran', 2019, 'ul. Szkolna 8/2, 31-000 Kraków', 'Przedszkole nr 44', true);
  child('dc_cichon_ewa', 'Ewa', 'Cichoń', 2020, 'ul. Lipowa 3, 31-000 Kraków', null, false, { summonedAt: '2026-10-20' });
  child('dc_dudek_szymon', 'Szymon', 'Dudek', 2019, 'ul. Wrzosowa 11, 31-000 Kraków', 'Przedszkole nr 7', true);
  child('dc_grabowska_nina', 'Nina', 'Grabowska', 2020, 'ul. Miodowa 21/5, 31-000 Kraków', null, false, { summonedAt: '2026-10-20' });
  child('dc_jasinski_oskar', 'Oskar', 'Jasiński', 2019, 'ul. Polna 2, 31-000 Kraków', null, false);

  /* --- dane opiekunów dla uczniów z bazowego seeda (używane w księdze i w kopii testowej) -- */
  const guardiansFor = {
    st_kowalczyk_anna: { mother: 'Kowalczyk Marta', father: 'Kowalczyk Tomasz', phone: '600 112 233', email: 'm.kowalczyk@example.org', address: 'ul. Długa 17/4, 31-147 Kraków' },
    st_nowak_jan: { mother: 'Nowak Katarzyna', father: '', phone: '601 445 190', email: 'k.nowak@example.org', address: 'ul. Krowoderska 8/1, 31-141 Kraków' },
    st_kot_stanisaw: { mother: 'Kot Aleksandra', father: 'Kot Damian', phone: '602 771 004', email: 'a.kot@example.org', address: 'ul. Sławkowska 12, 31-014 Kraków' }
  };
  for (const s of db.col('students')) if (guardiansFor[s.id]) { s.guardians = guardiansFor[s.id]; s.address = guardiansFor[s.id].address; }
  for (const s of db.col('students')) { if (!s.guardians) s.guardians = { mother: '', father: '', phone: '', email: '', address: '' }; if (!s.identityKind) s.identityKind = s.pesel ? 'pesel' : 'passport'; }
}

module.exports = { seed };
