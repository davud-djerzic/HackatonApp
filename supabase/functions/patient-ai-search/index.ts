import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

type LabRow = {
  document_id: string | null;
  parameter_name: string;
  result_date: string;
  measured_value: number;
  unit: string;
  reference_low: number | null;
  reference_high: number | null;
};

type Metric = {
  source_document_id: string | null;
  parameter: string;
  date: string;
  value: number;
  unit: string;
  reference_low: number | null;
  reference_high: number | null;
  status: "CRITICAL_LOW" | "CRITICAL_HIGH" | "NORMAL";
};

type ExtractedMedicalDocument = {
  id: string;
  title: string;
  category: string;
  created_at: string;
  extracted_document_text: string | null;
  extracted_document_json: unknown;
};

type SourceReference = {
  document_id: string | null;
  title: string;
  category: string;
  date: string;
  excerpt: string;
  evidence_type: "pdf_excerpt" | "structured_lab_result" | "database_record";
};

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

function normalize(value: string) {
  return value.toLocaleLowerCase("bs")
    .replace(/\u0111/g, "dj")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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

function safeGeminiError(error: unknown) {
  if (!(error instanceof Error)) return "Unknown AI service error.";
  const message = error.message.replace(/AIza[\w-]+/g, "[API KEY REMOVED]");
  if (message.includes("GEMINI_API_KEY")) return "The Gemini API key is not configured in Supabase secrets.";
  if (message.includes("Gemini HTTP 429")) return "The Gemini API limit has been temporarily exhausted. Try again in a few minutes.";
  if (message.includes("Gemini HTTP 401") || message.includes("Gemini HTTP 403")) return "The Gemini API key was rejected. Check GEMINI_API_KEY in Supabase secrets.";
  if (message.includes("Gemini HTTP 404")) return "The configured Gemini model is unavailable. Check GEMINI_MODEL in Supabase secrets.";
  if (/Gemini HTTP 5\d\d/.test(message)) return "The Gemini service is temporarily unavailable. Try again.";
  if (message.includes("JSON") || message.includes("Unexpected")) return "Gemini returned an invalid JSON response. Try again.";
  return message.slice(0, 500);
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function generateGeminiJson(prompt: string) {
  const apiKey = requiredSecret("GEMINI_API_KEY");
  const configuredModel = Deno.env.get("GEMINI_MODEL")?.trim();
  const models = [...new Set([configuredModel, "gemini-2.5-flash-lite", "gemini-2.5-flash"].filter((model): model is string => Boolean(model)))];
  let lastError: Error = new Error("The Gemini request was not executed");

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      });
      if (response.ok) {
        const body = await response.json();
        const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("The Gemini response is empty");
        return parseJsonObject(text);
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

function commonPrefixLength(left: string, right: string) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function matchesParameter(question: string, parameterName: string) {
  const normalizedName = normalize(parameterName);
  if (question.includes(normalizedName)) return true;
  return question.split(/[^a-z0-9]+/).some((word) => (
    word.length >= 5
    && normalizedName.length >= 5
    && commonPrefixLength(word, normalizedName) >= 5
  ));
}

function statusFor(row: LabRow): Metric["status"] {
  if (row.reference_low !== null && row.measured_value < row.reference_low) return "CRITICAL_LOW";
  if (row.reference_high !== null && row.measured_value > row.reference_high) return "CRITICAL_HIGH";
  return "NORMAL";
}

function toMetric(row: LabRow): Metric {
  return {
    source_document_id: row.document_id,
    parameter: row.parameter_name,
    date: row.result_date,
    value: Number(row.measured_value),
    unit: row.unit,
    reference_low: row.reference_low === null ? null : Number(row.reference_low),
    reference_high: row.reference_high === null ? null : Number(row.reference_high),
    status: statusFor(row),
  };
}

function queryTerms(question: string) {
  const ignored = new Set(["about", "after", "before", "from", "have", "history", "last", "list", "patient", "please", "report", "reports", "show", "through", "trend", "value", "values", "what", "which", "with"]);
  return normalize(question).split(/[^a-z0-9]+/).filter((term) => term.length >= 4 && !ignored.has(term));
}

function excerptAround(text: string | null, terms: string[], fallback: string) {
  if (!text?.trim()) return fallback;
  const normalizedText = normalize(text);
  const positions = terms.map((term) => normalizedText.indexOf(term)).filter((position) => position >= 0);
  const matchPosition = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, matchPosition - 180);
  const end = Math.min(text.length, matchPosition + 420);
  return `${start > 0 ? "..." : ""}${text.slice(start, end).trim()}${end < text.length ? "..." : ""}`;
}

function selectRelevantDocuments(question: string, documents: ExtractedMedicalDocument[]) {
  const terms = queryTerms(question);
  const scored = documents.map((document) => {
    const searchable = normalize(`${document.title} ${document.category} ${document.extracted_document_text ?? ""}`);
    return { document, score: terms.filter((term) => searchable.includes(term)).length };
  });
  const matching = scored.filter(({ score }) => score > 0).sort((left, right) => right.score - left.score);
  return (matching.length ? matching : scored).slice(0, 8).map(({ document }) => document);
}

function sourceReferences(question: string, metrics: Metric[], documents: ExtractedMedicalDocument[]): SourceReference[] {
  const terms = queryTerms(question);
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const sources = new Map<string, SourceReference>();
  for (const metric of metrics) {
    const sourceDocument = metric.source_document_id ? documentById.get(metric.source_document_id) : null;
    const key = sourceDocument?.id ?? `database:${metric.parameter}:${metric.date}`;
    if (sources.has(key)) continue;
    const labEvidence = `${metric.parameter}: ${metric.value} ${metric.unit} on ${metric.date}. Recorded reference range: ${metric.reference_low ?? "not recorded"} - ${metric.reference_high ?? "not recorded"}.`;
    sources.set(key, {
      document_id: sourceDocument?.id ?? null,
      title: sourceDocument?.title ?? "Structured laboratory record without a linked PDF",
      category: sourceDocument?.category ?? "Laboratory",
      date: sourceDocument?.created_at ?? metric.date,
      excerpt: excerptAround(sourceDocument?.extracted_document_text ?? null, [normalize(metric.parameter), ...terms], labEvidence),
      evidence_type: sourceDocument ? "structured_lab_result" : "database_record",
    });
  }
  for (const document of selectRelevantDocuments(question, documents)) {
    if (sources.has(document.id)) continue;
    sources.set(document.id, {
      document_id: document.id,
      title: document.title,
      category: document.category,
      date: document.created_at,
      excerpt: excerptAround(document.extracted_document_text, terms, "This PDF is indexed, but no readable excerpt was stored."),
      evidence_type: "pdf_excerpt",
    });
  }
  return [...sources.values()].slice(0, 12);
}

function selectRelevantMetrics(question: string, rows: LabRow[]) {
  const normalizedQuestion = normalize(question);
  const parameterNames = [...new Set(rows.map((row) => row.parameter_name))];
  const requestedParameter = parameterNames.find((name) => matchesParameter(normalizedQuestion, name));
  const asksForTrend = /(trend|history|histor|change|last|kretanj|promjen|zadnj)/.test(normalizedQuestion);
  const asksForTriage = /(critical|abnormal|elevated|low|outside reference|kritic|anomal|povisen|snizen|van referent)/.test(normalizedQuestion);

  if (requestedParameter) return rows.filter((row) => row.parameter_name === requestedParameter).map(toMetric);
  if (asksForTrend) return [];
  if (asksForTriage) return rows.map(toMetric).filter((metric) => metric.status !== "NORMAL");
  return rows.map(toMetric);
}

function localSummary(metrics: Metric[], documents: ExtractedMedicalDocument[], question: string) {
  if (!metrics.length && /(trend|history|histor|change|last|kretanj|promjen|zadnj)/.test(normalize(question))) {
    return `The parameter requested in the query was not found in this patient's report history: "${question}".`;
  }
  if (!metrics.length && !documents.length) return `No structured data matching the query was found: "${question}".`;
  if (!metrics.length) return `${documents.length} text-indexed medical documents were found. The AI service can use them to search report content.`;
  const abnormal = metrics.filter((metric) => metric.status !== "NORMAL");
  if (!abnormal.length) return `${metrics.length} laboratory values were found. All displayed values are within their recorded reference ranges.`;
  return `${metrics.length} values were found. ${abnormal.length} values are outside their recorded reference ranges and require a doctor's review.`;
}

async function geminiSummary(question: string, metrics: Metric[], documents: ExtractedMedicalDocument[]) {
  return await generateGeminiJson(`You are an evidence search assistant for medical records, not a diagnostic tool. Use only anonymized data from metrics and documents. Respond only with facts stored in the database: values, dates, recorded conclusions, and trend descriptions. Do not invent information, diagnose, create a differential list, or recommend therapy. Use ai_recommendation only to remind the doctor to review the source reports and clinical context. If data is missing, say that it was not found. text_summary must contain at most 3 short, readable sentences. Place the most important trend or deviation first.

Doctor question: ${question}
metrics=${JSON.stringify(metrics)}
documents=${JSON.stringify(documents)}

Return only a JSON object:
{
  "text_summary": "short professional answer based only on stored data",
  "ai_recommendation": "note reminding the doctor to review the source reports and clinical context"
}`);
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
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userError } = await userClient.auth.getUser(accessToken);
    if (userError || !user) return json({ error: "Your session has expired." }, 401);

    const { patientId, question } = await request.json();
    if (!patientId || !question?.trim()) return json({ error: "Patient and question are required." }, 400);

    const { data: share, error: shareError } = await admin.from("patient_record_shares").select("id")
      .eq("doctor_id", user.id).eq("patient_id", patientId).eq("status", "active")
      .gt("access_expires_at", new Date().toISOString()).order("claimed_at", { ascending: false })
      .limit(1).maybeSingle();
    if (shareError) throw shareError;
    if (!share) return json({ error: "Temporary record access is not active." }, 403);

    const { data, error } = await admin.from("lab_results")
      .select("document_id, parameter_name, result_date, measured_value, unit, reference_low, reference_high")
      .eq("patient_id", patientId).order("result_date", { ascending: true });
    if (error) throw error;

    const { data: documents, error: documentsError } = await admin.from("medical_documents")
      .select("id, title, category, created_at, extracted_document_text, extracted_document_json")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (documentsError) throw documentsError;

    const metrics = selectRelevantMetrics(question.trim(), data as LabRow[]);
    const extractedDocuments = (documents as ExtractedMedicalDocument[]).map((document) => ({
      ...document,
      extracted_document_text: document.extracted_document_text?.slice(0, 12_000) ?? null,
    }));
    const indexedDocuments = extractedDocuments.filter((document) => document.extracted_document_text);
    const relevantDocuments = selectRelevantDocuments(question.trim(), indexedDocuments);
    const sources = sourceReferences(question.trim(), metrics, extractedDocuments);
    let summary = localSummary(metrics, indexedDocuments, question.trim());
    let recommendation = "Review the source report and evaluate the data in the patient's clinical context.";
    let aiWarning: string | null = null;
    try {
      const ai = await geminiSummary(question.trim(), metrics, relevantDocuments);
      summary = ai.text_summary;
      recommendation = ai.ai_recommendation;
    } catch (error) {
      console.error(error);
      aiWarning = `The Gemini summary is currently unavailable. ${safeGeminiError(error)} Locally computed database results are displayed.`;
    }

    return json({
      text_summary: summary,
      extracted_metrics: metrics,
      sources,
      ai_recommendation: recommendation,
      ai_warning: aiWarning,
    });
  } catch (error) {
    console.error(error);
    return json({ error: "The connection to the database or AI service was interrupted." }, 500);
  }
});
