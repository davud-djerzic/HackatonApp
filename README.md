# HOPE React + Supabase + SendGrid

HOPE cuva medicinske dokumente u privatnom Supabase Storage bucketu.
Doktor salje PDF kroz aplikaciju, pacijent dobija sigurnu email obavijest, a
dokument ostaje u njegovom dosijeu. Medicinski PDF se ne salje kao email
attachment.

## Produkcijski tok

1. Doktor se prijavi kroz Supabase Auth i unese email registrovanog pacijenta.
2. `send-patient-report` Edge Function provjeri JWT, ulogu doktora i pronadje
   HOPE pacijenta prema email adresi.
3. PDF se sprema u privatni `medical-documents` Storage bucket.
4. Baza dobija dokument, obavijest i audit zapis email isporuke.
5. SendGrid Mail Send API salje pacijentu email sa linkom na HOPE login.
6. Opcionalni potpisani SendGrid Event Webhook upisuje `delivered`, `bounce` i
   `dropped` dogadjaje bez medicinskih podataka.

## Lokalni frontend

```powershell
Copy-Item .env.example .env.local
npm.cmd install
npm.cmd run dev
```

Unesite URL i publishable key vaseg Supabase projekta u `.env.local`.

## Postavljanje baze

1. Kreirajte Supabase projekt.
2. U SQL Editoru pokrenite `supabase/schema.sql`.
3. Pokrenite frontend i otvorite ekran **Registracija**.
4. Kreirajte jedan nalog kao doktor i jedan kao pacijent. Aplikacija salje
   `full_name` i `role`, a SQL trigger automatski kreira odgovarajuci zapis u
   tabeli `profiles`.
5. Za hackathon tok bez email potvrde otvorite Supabase Dashboard i idite na
   `Authentication > Providers > Email`. Iskljucite `Confirm email`. Novi
   korisnik ce odmah nakon registracije dobiti aktivnu sesiju.

Ako je Auth korisnik kreiran prije SQL triggera i aplikacija prikaze da profil
nije ucitan, pokrenite `supabase/repair-profiles.sql` u SQL Editoru.

Za rucno kreiranje test korisnika kroz Supabase Dashboard koristite metadata
vrijednosti:

```json
{ "full_name": "Dr. Amila M.", "role": "doctor" }
```

```json
{ "full_name": "Emir Hadzic", "role": "patient" }
```

Tabela `doctor_patient_access` ostaje dostupna za buduci tok u kojem pacijent
moze odobriti doktoru pregled prethodnih nalaza. Trenutno slanje novog PDF nalaza
na email registrovanog pacijenta ne zahtijeva trajnu vezu.

## Privremeni pristup nalazima kodom

Za hackathon tok pokrenite jos i `supabase/share-code-flow.sql` u Supabase SQL
Editoru. Nije potreban deploy frontenda: aplikacija moze ostati na
`http://localhost:5173`.

1. Pacijent se prijavi i klikne **Generisi kod**.
2. Kod vrijedi 10 minuta i moze se iskoristiti samo jednom.
3. Doktor se prijavi, unese kod i odmah dobije pregled svih nalaza pacijenta.
4. Pristup doktora automatski istice nakon 60 minuta.
5. Otvaranje PDF previewa se biljezi u tabeli `document_access_log`.

PDF ostaje u privatnom Supabase Storage bucketu. Doktor ga cita samo kroz
privremeni pristup; fajl se ne kopira u njegov profil i ne salje emailom.

## AI pretraga laboratorijskih nalaza

AI chat u doktorovom portalu radi samo dok doktor ima aktivan privremeni pristup
pacijentu. Backend prvo cita stvarne vrijednosti iz tabele `lab_results`, lokalno
racuna `NORMAL`, `CRITICAL_LOW` i `CRITICAL_HIGH`, a zatim Gemini dobija samo
anonimizirane medicinske nizove za strukturirani sazeti odgovor.

Za hackathon postavljanje:

1. U Supabase SQL Editoru pokrenite `supabase/ai-search-flow.sql`.
2. U Google AI Studio kreirajte Gemini API key.
3. Postavite secret i deployajte novu Edge Function:

```powershell
npx.cmd supabase secrets set GEMINI_API_KEY=your_key GEMINI_MODEL=gemini-2.5-flash
npx.cmd supabase functions deploy extract-medical-document --no-verify-jwt
npx.cmd supabase functions deploy patient-ai-search --no-verify-jwt
```

4. Dodajte testne laboratorijske vrijednosti prema komentarisanim primjerima na
   dnu `supabase/ai-search-flow.sql`.

Ako Gemini nije konfigurisan ili privremeno ne radi, frontend i dalje prikazuje
lokalno izracunate podatke iz baze i jasnu fallback napomenu.

Kada doktor kroz aplikaciju posalje PDF, `send-patient-report` Edge Function
brzo arhivira dokument i u pozadini pokrece `extract-medical-document` worker.
Worker pokusava izdvojiti anonimizirani tekst, sekcije dokumenta i sve
laboratorijske vrijednosti iz PDF-a koristeci Gemini PDF document processing.
Tekst i strukturirani JSON se cuvaju uz dokument, a validirani laboratorijski
rezultati se vezuju za pacijenta i konkretni dokument u tabeli `lab_results`.
Ako ekstrakcija nije dostupna, PDF se i dalje sigurno arhivira i email tok se
nastavlja.

Status ekstrakcije ostaje zapisan uz dokument u kolonama
`lab_extraction_status`, `lab_extraction_count` i `lab_extraction_error`.

## Simptomi i diferencijalna procjena

Pacijent moze dodati trenutne simptome. Doktor ih vidi samo dok ima aktivan
privremeni pristup dosijeu. Postojeci **Pitaj AI** ostaje evidencijska pretraga
koja ne donosi dijagnosticke zakljucke.

Odvojena **Diferencijalna procjena** koristi spremljene simptome, laboratorijske
vrijednosti i anonimizirani sadrzaj nalaza za listu hipoteza koje ljekar treba
potvrditi ili iskljuciti. Prikazani `match_score` je relativna podudarnost unutar
liste, nije medicinska vjerovatnoca niti dijagnoza.

Doktorov portal prikazuje odvojene tabove `Dosije`, `Pitaj AI` i
`Diferencijalna procjena`. Procjena koristi cetiri nivoa hitnosti:

- `Hitno`: moguce zivotno ugrozavajuci simptomi;
- `Visoka`: akutno, dijagnostika u roku od 24 sata;
- `Srednja`: dijagnostika u nekoliko dana;
- `Niska`: benigni ili hronicni obrasci bez znakova hitnosti.

Za postavljanje pokrenite `supabase/symptom-assessment-flow.sql` u SQL Editoru i
deployajte funkciju:

```powershell
npx.cmd supabase functions deploy differential-assessment --no-verify-jwt
```

## SendGrid

1. Kreirajte SendGrid API key sa dozvolom za slanje emaila.
2. Verificirajte sender adresu ili domenu u SendGrid konzoli.
3. Postavite Supabase Edge Function secrets:

```powershell
supabase secrets set SENDGRID_API_KEY=SG.your_key
supabase secrets set SENDGRID_FROM_EMAIL=verified-sender@example.com
supabase secrets set APP_URL=https://your-hope-app.example.com
```

4. Deploy funkcije za slanje:

```powershell
supabase functions deploy send-patient-report
```

## SendGrid Event Webhook

Za pracenje stvarne isporuke kreirajte Event Webhook u SendGrid konzoli:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/sendgrid-events
```

Ukljucite `delivered`, `bounce`, `dropped` i **Signed Event Webhook**. Kopirajte
generisani javni kljuc i deployajte webhook funkciju:

```powershell
supabase secrets set SENDGRID_WEBHOOK_PUBLIC_KEY=your_public_key
supabase functions deploy sendgrid-events --no-verify-jwt
```

`supabase/config.toml` takodjer biljezi ove JWT postavke. `sendgrid-events`
rucno provjerava SendGrid ECDSA potpis. Funkcija mora biti
javna jer je poziva SendGrid, ali odbija zahtjeve bez validnog potpisa.

## Provjera

```powershell
npm.cmd run lint
npm.cmd run build
```

Za lokalno pokretanje Edge Functions koristite Supabase CLI i Docker:

```powershell
supabase start
supabase functions serve --env-file supabase/functions/.env
```

## Sigurnost

- `SUPABASE_SERVICE_ROLE_KEY` i `SENDGRID_API_KEY` postoje samo kao Supabase
  secrets. Nikada ih ne stavljajte u `.env.local` ili browser kod.
- Storage bucket je privatan. Pacijent moze citati samo fajlove unutar svog
  UUID foldera.
- SendGrid email ne sadrzi naziv nalaza, dijagnozu ni PDF attachment.
- `delivery_id` u SendGrid `custom_args` je interni audit UUID bez PII podataka.
- Za obradu stvarnih medicinskih podataka provjerite lokalne propise, ugovore o
  obradi podataka, retention pravila i incident-response proceduru.

## Sluzbena dokumentacija

- Supabase Edge Functions: https://supabase.com/docs/guides/functions
- Supabase CORS za Edge Functions: https://supabase.com/docs/guides/functions/cors
- SendGrid Mail Send API: https://www.twilio.com/docs/sendgrid/api-reference/mail-send
- SendGrid Signed Event Webhook: https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features
