# CareTrace React + Supabase + SendGrid

CareTrace cuva medicinske dokumente u privatnom Supabase Storage bucketu.
Doktor salje PDF kroz aplikaciju, pacijent dobija sigurnu email obavijest, a
dokument ostaje u njegovom dosijeu. Medicinski PDF se ne salje kao email
attachment.

## Produkcijski tok

1. Doktor se prijavi kroz Supabase Auth i odabere povezanog pacijenta.
2. `send-patient-report` Edge Function provjeri JWT, ulogu doktora i aktivnu
   vezu u `doctor_patient_access`.
3. PDF se sprema u privatni `medical-documents` Storage bucket.
4. Baza dobija dokument, obavijest i audit zapis email isporuke.
5. SendGrid Mail Send API salje pacijentu email sa linkom na CareTrace login.
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

Za rucno kreiranje test korisnika kroz Supabase Dashboard koristite metadata
vrijednosti:

```json
{ "full_name": "Dr. Amila M.", "role": "doctor" }
```

```json
{ "full_name": "Emir Hadzic", "role": "patient" }
```

6. Povezite doktora i pacijenta u SQL Editoru koristeci njihove Auth UUID-e:

```sql
insert into public.doctor_patient_access (doctor_id, patient_id)
values ('DOCTOR_AUTH_UUID', 'PATIENT_AUTH_UUID');
```

## SendGrid

1. Kreirajte SendGrid API key sa dozvolom za slanje emaila.
2. Verificirajte sender adresu ili domenu u SendGrid konzoli.
3. Postavite Supabase Edge Function secrets:

```powershell
supabase secrets set SENDGRID_API_KEY=SG.your_key
supabase secrets set SENDGRID_FROM_EMAIL=verified-sender@example.com
supabase secrets set APP_URL=https://your-caretrace-app.example.com
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
