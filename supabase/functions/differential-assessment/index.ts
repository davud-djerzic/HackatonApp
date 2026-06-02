import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requiredSecret(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server secret: ${name}`);
  return value;
}

function parseJsonObject(value: string) {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  if (start === -1) throw new Error("The Gemini response does not contain a JSON object");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth === 0) return JSON.parse(trimmed.slice(start, index + 1));
  }
  throw new Error("The Gemini JSON object is incomplete");
}

function textArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeHypothesis(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.name !== "string" || !candidate.name.trim()) return null;
  const rawScore = typeof candidate.match_score === "number" ? candidate.match_score : Number(candidate.match_score);
  const urgency = candidate.urgency === "Urgent"
    || candidate.urgency === "High"
    || candidate.urgency === "Medium"
    ? candidate.urgency
    : "Low";
  return {
    name: candidate.name.trim(),
    match_score: Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0,
    rationale: typeof candidate.rationale === "string" ? candidate.rationale : "",
    evidence_for: textArray(candidate.evidence_for),
    evidence_against_or_missing: textArray(candidate.evidence_against_or_missing),
    next_checks: textArray(candidate.next_checks),
    urgency,
  };
}

function safeErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "Unknown server error.";
  const message = error.message.replace(/AIza[\w-]+/g, "[API KEY REMOVED]");
  if (message.includes("patient_symptoms")) return "The patient_symptoms table is not installed. Run supabase/symptom-assessment-flow.sql in the SQL Editor.";
  if (message.includes("GEMINI_API_KEY")) return "The Gemini API key is not configured in Supabase secrets.";
  if (message.includes("Gemini HTTP 429")) return "The Gemini API limit has been temporarily exhausted. Try again later.";
  if (message.includes("Gemini HTTP")) return message.slice(0, 700);
  if (message.includes("JSON") || message.includes("Unexpected")) return `Gemini returned an invalid JSON response: ${message.slice(0, 500)}`;
  return message.slice(0, 700);
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const differentialResponseSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    hypotheses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          match_score: { type: "integer" },
          rationale: { type: "string" },
          evidence_for: { type: "array", items: { type: "string" } },
          evidence_against_or_missing: { type: "array", items: { type: "string" } },
          next_checks: { type: "array", items: { type: "string" } },
          urgency: { type: "string", enum: ["Low", "Medium", "High", "Urgent"] },
        },
        required: ["name", "match_score", "rationale", "evidence_for", "evidence_against_or_missing", "next_checks", "urgency"],
      },
    },
    red_flags: { type: "array", items: { type: "string" } },
    missing_data: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "hypotheses", "red_flags", "missing_data"],
};

async function generateGeminiJson(prompt: string, apiKey: string) {
  const configuredModel = Deno.env.get("GEMINI_MODEL")?.trim();
  const models = [...new Set([configuredModel, "gemini-2.5-flash-lite", "gemini-2.5-flash"].filter((model): model is string => Boolean(model)))];
  let lastError: Error = new Error("The Gemini request was not executed");

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: attempt === 0 ? prompt : `${prompt}\n\nTHE RESPONSE MUST BE SHORT, COMPLETE JSON. Shorten text fields and close every JSON bracket.` }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: differentialResponseSchema,
            maxOutputTokens: 4096,
            temperature: 0.1,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      });
      if (response.ok) {
        const body = await response.json();
        const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("The Gemini response is empty");
        try {
          return parseJsonObject(text);
        } catch (error) {
          const finishReason = body.candidates?.[0]?.finishReason ?? "UNKNOWN";
          lastError = new Error(`${error instanceof Error ? error.message : "Gemini JSON error"}; finishReason=${finishReason}`);
          if (attempt === 1) throw lastError;
          await sleep(350);
          continue;
        }
      }

      lastError = new Error(`Gemini HTTP ${response.status}: ${(await response.text()).slice(0, 600)}`);
      if (response.status === 404) break;
      if (![429, 500, 502, 503, 504].includes(response.status)) throw lastError;
      if (attempt === 1) break;
      await sleep(700);
    }
  }
  throw lastError;
}

function abnormalLabCount(labs: Array<Record<string, unknown>>) {
  return labs.filter((lab) => {
    const measured = Number(lab.measured_value);
    const low = lab.reference_low === null ? null : Number(lab.reference_low);
    const high = lab.reference_high === null ? null : Number(lab.reference_high);
    return Number.isFinite(measured)
      && ((low !== null && Number.isFinite(low) && measured < low)
        || (high !== null && Number.isFinite(high) && measured > high));
  }).length;
}

function compactDocument(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const document = value as Record<string, unknown>;
  const extracted = document.extracted_document_json;
  if (!extracted || typeof extracted !== "object") return document;
  const details = extracted as Record<string, unknown>;
  return {
    title: document.title,
    category: document.category,
    created_at: document.created_at,
    document_type: details.document_type,
    document_date: details.document_date,
    anamnesis: details.anamnesis,
    findings: details.findings,
    doctor_opinion: details.doctor_opinion,
    conclusion: details.conclusion,
    recommendation: details.recommendation,
    diagnoses: details.diagnoses,
    therapies: details.therapies,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return json({ error: "Authentication is required." }, 401);
    const accessToken = authorization.replace(/^Bearer\s+/i, "");
    if (!accessToken || accessToken === authorization) return json({ error: "Authentication is invalid." }, 401);

    const supabaseUrl = requiredSecret("SUPABASE_URL");
    const anonKey = requiredSecret("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredSecret("SUPABASE_SERVICE_ROLE_KEY");
    const apiKey = requiredSecret("GEMINI_API_KEY");
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userError } = await userClient.auth.getUser(accessToken);
    if (userError || !user) return json({ error: "Your session has expired." }, 401);

    const { patientId, clinicalQuestion } = await request.json();
    if (!patientId) return json({ error: "Patient is required." }, 400);

    const { data: share, error: shareError } = await admin.from("patient_record_shares").select("id")
      .eq("doctor_id", user.id).eq("patient_id", patientId).eq("status", "active")
      .gt("access_expires_at", new Date().toISOString()).order("claimed_at", { ascending: false })
      .limit(1).maybeSingle();
    if (shareError) throw shareError;
    if (!share) return json({ error: "Temporary record access is not active." }, 403);

    const [symptomsResult, labsResult, documentsResult] = await Promise.all([
      admin.from("patient_symptoms").select("symptom_name, severity, started_at, notes, active, created_at")
        .eq("patient_id", patientId).order("created_at", { ascending: false }).limit(50),
      admin.from("lab_results").select("parameter_name, result_date, measured_value, unit, reference_low, reference_high")
        .eq("patient_id", patientId).order("result_date", { ascending: true }),
      admin.from("medical_documents").select("title, category, created_at, extracted_document_json")
        .eq("patient_id", patientId).not("extracted_document_json", "is", null)
        .order("created_at", { ascending: false }).limit(20),
    ]);
    if (symptomsResult.error) throw symptomsResult.error;
    if (labsResult.error) throw labsResult.error;
    if (documentsResult.error) throw documentsResult.error;

    const compactDocuments = (documentsResult.data ?? []).map(compactDocument).filter(Boolean);
    const prompt = `You are a clinical decision support tool for a doctor's differential assessment. You do not diagnose and you do not replace a clinical examination.

Use ONLY anonymized data from symptoms, labs, and documents. Do not invent data, diseases, percentages, or guidelines. Return at most 3 short hypotheses for the doctor to consider.

FORMAT FOR QUICK REVIEW:
- summary: at most 3 short sentences;
- rationale: at most 2 short sentences;
- each list: at most 3 short, concrete items;
- include dates and values only when stored in the database;
- avoid repeating the same information across fields unless necessary.

match_score is a relative match level from 0 to 100 within this list. It is NOT a statistical probability and must NOT be described as the chance that the patient has a disease.

For each hypothesis include:
- evidence_for: concrete database records that support considering the hypothesis;
- evidence_against_or_missing: missing or contradictory data;
- next_checks: checks the doctor may consider to confirm or rule out the hypothesis;
- urgency: use exactly one value: "Low", "Medium", "High", or "Urgent".

URGENCY RULES:
- "Urgent": only for saved data indicating a potentially life-threatening condition or symptoms requiring immediate assessment.
- "High": acute pattern for which the doctor should consider diagnostic review within 24 hours.
- "Medium": pattern for which the doctor should consider diagnostic review within several days.
- "Low": benign or chronic pattern without stored evidence indicating urgency.

Do not use "Urgent" without a specific saved item in evidence_for. If data is insufficient to assess urgency, use "Low" and state what is missing.

If the data is insufficient, return an empty hypotheses list and explain what is missing. Include red_flags only when supported by saved data.

clinical_question=${clinicalQuestion || "Which differential hypotheses should be considered?"}
symptoms=${JSON.stringify(symptomsResult.data)}
labs=${JSON.stringify(labsResult.data)}
documents=${JSON.stringify(compactDocuments)}

Return only JSON:
{
  "summary": "short explanation of limitations and findings",
  "hypotheses": [{
    "name": "hypothesis name",
    "match_score": 0,
    "rationale": "why it should be considered",
    "evidence_for": ["concrete saved record"],
    "evidence_against_or_missing": ["missing or contradictory data"],
    "next_checks": ["checks the doctor may consider"],
    "urgency": "Low"
  }],
  "red_flags": [],
  "missing_data": []
}`;

    try {
      const parsed = await generateGeminiJson(prompt, apiKey);
      return json({
        disclaimer: "This is not a diagnosis or a calculation of medical probability. The result is a supporting differential list for review and confirmation by a doctor.",
        summary: typeof parsed.summary === "string" ? parsed.summary : "Review the available data and hypotheses.",
        hypotheses: Array.isArray(parsed.hypotheses) ? parsed.hypotheses.map(normalizeHypothesis).filter(Boolean).slice(0, 5) : [],
        red_flags: textArray(parsed.red_flags),
        missing_data: textArray(parsed.missing_data),
        ai_warning: null,
      });
    } catch (error) {
      console.error(error);
      const symptoms = symptomsResult.data ?? [];
      const labs = labsResult.data ?? [];
      const documents = documentsResult.data ?? [];
      const aiError = safeErrorMessage(error);
      return json({
        disclaimer: "This is not a diagnosis or a calculation of medical probability. The result is a supporting differential list for review and confirmation by a doctor.",
        summary: `Gemini assessment is currently unavailable. The database contains ${symptoms.length} symptoms, ${labs.length} laboratory values, and ${documents.length} indexed documents. ${abnormalLabCount(labs)} laboratory values are outside their recorded reference ranges. Review the patient record and try the AI assessment again.`,
        hypotheses: [],
        red_flags: [],
        missing_data: [`AI service: ${aiError}`],
        ai_warning: `Gemini assessment is currently unavailable. ${aiError}`,
      });
    }
  } catch (error) {
    console.error(error);
    return json({ error: `Differential assessment is currently unavailable. ${safeErrorMessage(error)}` }, 500);
  }
});
