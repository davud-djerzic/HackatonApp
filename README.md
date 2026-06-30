# HOPE – Healthcare Document Platform

HOPE is a hackathon healthcare platform built to improve how patients and doctors share, store, and review medical documents.

The application allows doctors to upload PDF medical reports, patients to keep their records in one secure place, and doctors to access patient documents through temporary permission-based access. It also includes AI-assisted laboratory report analysis and differential assessment features to help doctors review existing medical data more efficiently.

> **Important:** HOPE is a prototype created for educational and hackathon purposes. It is not a replacement for professional medical judgment, diagnosis, or treatment.

---

## Main Idea

In many healthcare systems, patients often keep medical reports across different clinics, emails, printed papers, and PDF files. This makes it harder for doctors to quickly understand the patient’s medical history.

HOPE solves this by creating a centralized patient medical record system where:

* patients have their own digital medical file,
* doctors can securely send PDF reports,
* medical documents are stored in a private Supabase Storage bucket,
* doctors can temporarily access patient records using a secure code,
* AI can help summarize and search laboratory results,
* sensitive medical PDFs are not sent directly as email attachments.

---

## Features

### Patient Features

* Register and log in as a patient
* View medical documents in one place
* Receive email notifications when a doctor uploads a new report
* Generate a temporary access code for a doctor
* Add current symptoms for doctor review
* Keep medical documents inside a private digital record

### Doctor Features

* Register and log in as a doctor
* Upload PDF reports for registered patients
* Send secure email notifications through SendGrid
* Access patient documents using a temporary code
* Preview medical PDFs through controlled access
* Review patient symptoms, laboratory results, and previous findings
* Use AI-assisted search and differential assessment tools

### Secure Document Flow

1. A doctor logs in and enters the email of a registered patient.
2. The doctor uploads a PDF medical report.
3. The report is stored in a private Supabase Storage bucket.
4. The database stores the document record, notification, and audit information.
5. The patient receives a secure email notification.
6. The medical PDF is not attached to the email.
7. The patient can access the document after logging into HOPE.

### Temporary Doctor Access

HOPE includes a temporary patient-doctor access flow:

1. The patient generates an access code.
2. The code is valid for 10 minutes.
3. The doctor enters the code inside the application.
4. The doctor receives temporary access to the patient’s medical records.
5. The doctor’s access automatically expires after 60 minutes.
6. PDF preview activity is logged in the database.

This approach allows doctors to access patient data only when the patient explicitly allows it.

---

## AI Features

### AI Laboratory Report Search

HOPE includes an AI-assisted search feature for laboratory results.

The system first reads actual stored values from the database, calculates local status indicators such as:

* `NORMAL`
* `CRITICAL_LOW`
* `CRITICAL_HIGH`

Then, Gemini AI is used to generate a structured summary based on anonymized medical data.

If Gemini is not configured or temporarily unavailable, the frontend still displays locally calculated medical data from the database with a fallback message.

### Medical Document Extraction

When a doctor uploads a PDF report, the system can trigger a background extraction process.

The extraction worker attempts to:

* extract anonymized text from the PDF,
* identify document sections,
* detect laboratory values,
* store structured JSON data,
* connect validated lab results with the patient and document.

If extraction is unavailable, the PDF is still safely archived and the email notification flow continues.

### Differential Assessment

HOPE includes a separate differential assessment feature that uses:

* patient symptoms,
* stored laboratory values,
* anonymized report content,
* previously stored patient data.

The output is a list of possible medical hypotheses that a doctor should confirm or exclude.

The displayed `match_score` is a relative match inside the generated list. It is not a medical probability and it is not a diagnosis.

Urgency levels used by the system:

* `Urgent` – potentially life-threatening symptoms
* `High` – acute condition, recommended evaluation within 24 hours
* `Medium` – recommended evaluation within several days
* `Low` – mild, chronic, or non-urgent patterns

---

## Tech Stack

### Frontend

* React
* TypeScript
* Vite
* Supabase JavaScript Client
* CSS
* ESLint

### Backend / Serverless

* Supabase Auth
* Supabase Database
* Supabase Storage
* Supabase Edge Functions
* PostgreSQL / PLpgSQL

### External Services

* SendGrid Mail Send API
* SendGrid Event Webhook
* Gemini API for AI-assisted medical document processing and analysis

---

## Project Structure

```text
HackatonApp/
│
├── public/
│
├── src/
│   ├── components/
│   ├── pages/
│   ├── services/
│   ├── styles/
│   └── main.tsx
│
├── supabase/
│   ├── functions/
│   │   ├── send-patient-report/
│   │   ├── sendgrid-events/
│   │   ├── extract-medical-document/
│   │   ├── patient-ai-search/
│   │   └── differential-assessment/
│   │
│   ├── schema.sql
│   ├── share-code-flow.sql
│   ├── ai-search-flow.sql
│   ├── symptom-assessment-flow.sql
│   └── config.toml
│
├── .env.example
├── package.json
├── vite.config.ts
└── README.md
```

---

## Getting Started

### Prerequisites

Make sure you have installed:

* Node.js
* npm
* Supabase CLI
* Docker, required for local Supabase Edge Functions
* A Supabase project
* A SendGrid account
* A Gemini API key

---

## Frontend Setup

Clone the repository:

```bash
git clone https://github.com/davud-djerzic/HackatonApp.git
cd HackatonApp
```

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env.local
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Update `.env.local` with your Supabase project values:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
VITE_APP_URL=http://localhost:5173
```

Start the development server:

```bash
npm run dev
```

The frontend will run on:

```text
http://localhost:5173
```

---

## Database Setup

1. Create a new Supabase project.
2. Open the Supabase SQL Editor.
3. Run the database setup script:

```text
supabase/schema.sql
```

4. Register one doctor account and one patient account through the application.
5. For hackathon testing without email confirmation, go to:

```text
Authentication > Providers > Email
```

and disable email confirmation.

The application sends `full_name` and `role` metadata during registration, and the SQL trigger creates the corresponding profile record automatically.

If a user was created before the SQL trigger and the profile is missing, run:

```text
supabase/repair-profiles.sql
```

---

## Temporary Access Code Setup

To enable temporary doctor access to patient records, run:

```text
supabase/share-code-flow.sql
```

This enables the flow where:

* the patient generates a code,
* the doctor uses the code,
* access is temporary,
* PDF preview access is logged.

---

## AI Search Setup

To enable AI-assisted laboratory result search, run:

```text
supabase/ai-search-flow.sql
```

Then create a Gemini API key in Google AI Studio and set Supabase secrets:

```bash
npx supabase secrets set GEMINI_API_KEY=your_key GEMINI_MODEL=gemini-2.5-flash
```

Deploy the required Edge Functions:

```bash
npx supabase functions deploy extract-medical-document --no-verify-jwt
npx supabase functions deploy patient-ai-search --no-verify-jwt
```

You can add test laboratory values using the commented examples at the bottom of:

```text
supabase/ai-search-flow.sql
```

---

## Differential Assessment Setup

To enable symptoms and differential assessment, run:

```text
supabase/symptom-assessment-flow.sql
```

Then deploy the function:

```bash
npx supabase functions deploy differential-assessment --no-verify-jwt
```

---

## SendGrid Setup

1. Create a SendGrid API key with permission to send emails.
2. Verify a sender email address or domain in SendGrid.
3. Set Supabase secrets:

```bash
supabase secrets set SENDGRID_API_KEY=SG.your_key
supabase secrets set SENDGRID_FROM_EMAIL=verified-sender@example.com
supabase secrets set APP_URL=https://your-hope-app.example.com
```

4. Deploy the email function:

```bash
supabase functions deploy send-patient-report
```

---

## SendGrid Event Webhook

To track email delivery events, create a SendGrid Event Webhook with:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/sendgrid-events
```

Enable events such as:

* `delivered`
* `bounce`
* `dropped`

Then set the webhook public key and deploy the webhook function:

```bash
supabase secrets set SENDGRID_WEBHOOK_PUBLIC_KEY=your_public_key
supabase functions deploy sendgrid-events --no-verify-jwt
```

The webhook function verifies the SendGrid ECDSA signature and rejects invalid requests.

---

## Running Checks

Run linting:

```bash
npm run lint
```

Build the project:

```bash
npm run build
```

Preview production build:

```bash
npm run preview
```

---

## Security Notes

* Medical PDFs are stored in a private Supabase Storage bucket.
* PDFs are not sent as email attachments.
* SendGrid emails do not include medical document contents.
* Service role keys and API keys must only be stored as Supabase secrets.
* Sensitive keys must never be committed to the repository.
* Doctor access to patient files is temporary and controlled by patient-generated codes.
* Document access is logged for audit purposes.
* AI processing should use anonymized or minimized medical data whenever possible.

For production use, additional legal, security, privacy, and compliance reviews would be required.

---

## Future Improvements

* Add a full deployment guide
* Add Docker setup for local development
* Add screenshots and demo video
* Add automated tests
* Improve responsive design
* Add more detailed audit logs
* Add document categorization
* Add advanced patient timeline view
* Add role-based admin dashboard
* Improve AI prompt safety and validation
* Add multilingual support

---


## Disclaimer

This project is a hackathon prototype and is not intended for real clinical use without proper security, privacy, regulatory, and medical validation. AI-generated outputs are only assistance for reviewing existing data and must not be treated as medical diagnosis.

---

## License

This project is currently not licensed. Add a license file if you want to define how others may use, modify, or contribute to the project.
