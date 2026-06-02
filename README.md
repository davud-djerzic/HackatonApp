# CareTrace React + Supabase + SendGrid

CareTrace je mobilno prilagodjena web aplikacija za pacijente. Pacijent se
registruje i prijavljuje emailom i lozinkom, cuva nalaze u privatnom Supabase
Storage bucketu i moze resetovati lozinku putem 6-cifrenog sigurnosnog koda
poslanog na email (SendGrid Edge Function).

## Pacijentski tok

1. Pocetna stranica: **Prijava** ili **Registracija** (samo pacijent).
2. Nakon prijave pacijent vidi svoj dosije, uploaduje dokumente i pregleda PDF.
3. **Zaboravili ste lozinku?** — unos emaila, 6-cifreni kod na email, nova lozinka.

## Lokalni frontend

```powershell
Copy-Item .env.example .env.local
npm.cmd install
npm.cmd run dev
```

Unesite URL i publishable key vaseg Supabase projekta u `.env.local`.

## Hackathon mock (brzo testiranje bez produkcijske konfiguracije)

Za hackathon možete brzo testirati aplikaciju koristeći demo tokove i lokalne mockove:

1. Kopirajte `.env.example` u `.env.local` i podesite sledeće vrednosti (ili ih ostavite prazne za demo):

```bash
cp .env.example .env.local
```

2. Uverite se da je `VITE_DEMO_LOGIN=true` u `.env.local` (omogućava prijavu sa bilo kojim emailom).

3. Pokrenite frontend:

```bash
npm install
npm run dev
```

4. Otvorite `http://localhost:5173` na telefonu za pacijenta (mobile-first). Napravite demo nalog bilo kojim emailom i prijavite se.

5. U aplikaciji, idite na sekciju `Pristup` i generišite pristupni kod.

6. Na računaru otvorite `http://localhost:5173/#pristupdoktora` i unesite generisani kod da biste pristupili doktorskog prikazu (desktop view).

7. AI funkcionalnost: nije potreban stvarni AI ključ za rad mock-a — aplikacija koristi fallback tekst. Ako želite testirati Google Gemini, postavite `GEMINI_API_KEY` u `supabase/functions/.env` ili u deployment secrets.

Napomena: Nemojte pohranjivati privatne ključeve u git; koristite `.env.local` i dodajte ga u `.gitignore`.

## Postavljanje baze

1. Kreirajte Supabase projekt.
2. U SQL Editoru pokrenite `supabase/schema.sql`.
3. Pokrenite frontend — pocetni ekran je **Registracija / Prijava**.
4. Kreirajte pacijentski nalog. SQL trigger automatski kreira `profiles` zapis
   sa ulogom `patient`.
5. Za testiranje bez email potvrde: Supabase Dashboard →
   `Authentication > Providers > Email` → iskljucite `Confirm email`.

Metadata za rucno kreiranje test pacijenta:

```json
{ "full_name": "Emir Hadzic", "role": "patient" }
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

4. Deploy funkcija:

```powershell
supabase functions deploy send-password-reset-code
supabase functions deploy confirm-password-reset
supabase functions deploy send-patient-report
```

### Reset lozinke (sigurnosni kod)

1. U SQL Editoru pokrenite `supabase/migrations/20260602120000_patient_only_password_reset.sql`
   (ili cijeli `schema.sql` koji sada ukljucuje `password_reset_codes`).
2. Deployajte `send-password-reset-code` i `confirm-password-reset`.
3. U aplikaciji: Prijava → **Zaboravili ste lozinku?** → email → kod iz emaila → nova lozinka.
4. Ako Edge Functions nisu deployane, aplikacija koristi Supabase Auth OTP fallback
   (potrebno ukljuciti email OTP u Auth postavkama projekta).

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
