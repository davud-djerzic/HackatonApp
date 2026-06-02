import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

type ExtractedLabResult = {
  result_date: string;
  parameter_name: string;
  measured_value: number;
  unit: string;
  reference_low?: number | null;
  reference_high?: number | null;
};

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
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

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 32_768;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function redactIdentifiers(value: string) {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL REMOVED]")
    .replace(/\b(?:\+?\d[\s./-]?){8,15}\b/g, "[NUMBER REMOVED]")
    .replace(/\b\d{13}\b/g, "[IDENTIFIER REMOVED]");
}

function cleanText(value: unknown) {
  return typeof value === "string" ? redactIdentifiers(value.trim()) : "";
}

function cleanTextArray(value: unknown) {
  return Array.isArray(value) ? value.map(cleanText).filter(Boolean) : [];
}

function normalizeDate(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const localDate = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})\.?$/);
  if (!localDate) return null;
  return `${localDate[3]}-${localDate[2].padStart(2, "0")}-${localDate[1].padStart(2, "0")}`;
}

function normalizeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLabResult(value: unknown, fallbackDate: string | null): ExtractedLabResult | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Record<string, unknown>;
  const resultDate = normalizeDate(result.result_date) ?? fallbackDate;
  const measuredValue = normalizeNumber(result.measured_value);
  if (!resultDate || measuredValue === null || typeof result.parameter_name !== "string" || !result.parameter_name.trim()) return null;
  return {
    result_date: resultDate,
    parameter_name: result.parameter_name.trim(),
    measured_value: measuredValue,
    unit: typeof result.unit === "string" ? result.unit.trim() : "",
    reference_low: normalizeNumber(result.reference_low),
    reference_high: normalizeNumber(result.reference_high),
  };
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

async function extractDocument(file: Blob) {
  const apiKey = requiredSecret("GEMINI_API_KEY");
  const configuredModel = Deno.env.get("GEMINI_MODEL")?.trim();
  const models = [...new Set([configuredModel, "gemini-2.5-flash-lite", "gemini-2.5-flash"].filter((model): model is string => Boolean(model)))];
  const data = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
  const contents = [{
    parts: [
      { inline_data: { mime_type: "application/pdf", data } },
      { text: `You are a precise parser for medical PDF documents. Your task is not diagnosis or summarization, but faithful structured extraction.

RULES:
1. Read the entire PDF, including all pages, tables, and text sections.
2. Store all reliably readable medical content in document_text in the original document order. Do not shorten the text.
3. Separately extract anamnesis, findings, doctor opinion, conclusion, recommendation, diagnoses, and therapies only when explicitly written.
4. Extract EVERY laboratory row from all tables into results. Do not select only abnormal values.
5. Use JSON numbers without units for measured_value, reference_low, and reference_high. Convert decimal commas to decimal points.
6. If a reference boundary is not written, use null. If an individual result date is not written, use the document date.
7. Do not invent, complete, or interpret data.
8. Remove names, email addresses, home addresses, phone numbers, national identifiers, and insurance numbers from text fields.
9. Return only a JSON object without a markdown code fence.

REQUIRED FORMAT:
{
  "document_text": "all anonymized medical text",
  "document_type": "document type",
  "document_date": "YYYY-MM-DD or null",
  "anamnesis": "",
  "findings": "",
  "doctor_opinion": "",
  "conclusion": "",
  "recommendation": "",
  "diagnoses": [],
  "therapies": [],
  "sections": [{ "title": "Title", "content": "Content" }],
  "results": [{
    "result_date": "YYYY-MM-DD",
    "parameter_name": "Hemoglobin",
    "measured_value": 118,
    "unit": "g/L",
    "reference_low": 120,
    "reference_high": 160
  }]
}` },
    ],
  }];
  let body: GeminiResponse | null = null;
  let lastError = new Error("The Gemini extraction request was not executed");
  for (const model of models) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents, generationConfig: { responseMimeType: "application/json" } }),
    });
    if (response.ok) {
      body = await response.json();
      break;
    }
    lastError = new Error(`Gemini HTTP ${response.status}: ${(await response.text()).slice(0, 600)}`);
    if (![404, 429, 500, 502, 503, 504].includes(response.status)) throw lastError;
  }
  if (!body) throw lastError;
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("The Gemini extraction response is empty");
  const parsed = parseJsonObject(text);
  const documentDate = normalizeDate(parsed.document_date);
  const sections = Array.isArray(parsed.sections) ? parsed.sections.filter((section: unknown) => {
    if (!section || typeof section !== "object") return false;
    const candidate = section as Record<string, unknown>;
    return typeof candidate.title === "string" && typeof candidate.content === "string";
  }).map((section: { title: string; content: string }) => ({
    title: cleanText(section.title),
    content: cleanText(section.content),
  })) : [];
  const clinicalFields = {
    anamnesis: cleanText(parsed.anamnesis),
    findings: cleanText(parsed.findings),
    doctor_opinion: cleanText(parsed.doctor_opinion),
    conclusion: cleanText(parsed.conclusion),
    recommendation: cleanText(parsed.recommendation),
    diagnoses: cleanTextArray(parsed.diagnoses),
    therapies: cleanTextArray(parsed.therapies),
  };
  return {
    document_text: cleanText(parsed.document_text) || [
      ...sections.map((section: { title: string; content: string }) => `${section.title}: ${section.content}`),
      ...Object.values(clinicalFields).flat(),
    ].filter(Boolean).join("\n"),
    document_type: cleanText(parsed.document_type) || "Medical document",
    document_date: documentDate,
    ...clinicalFields,
    sections,
    results: Array.isArray(parsed.results) ? parsed.results.map((result: unknown) => normalizeLabResult(result, documentDate)).filter((result: ExtractedLabResult | null): result is ExtractedLabResult => result !== null) : [],
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = requiredSecret("SUPABASE_URL");
  const serviceRoleKey = requiredSecret("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (authorization !== `Bearer ${serviceRoleKey}`) return json({ error: "Forbidden" }, 403);
  const admin = createClient(supabaseUrl, serviceRoleKey);
  let documentId: string | null = null;

  try {
    ({ documentId } = await request.json());
    if (!documentId) return json({ error: "documentId is required." }, 400);
    const { data: document, error: documentError } = await admin.from("medical_documents")
      .select("id, patient_id, storage_path").eq("id", documentId).single();
    if (documentError) throw documentError;
    const { data: file, error: downloadError } = await admin.storage.from("medical-documents").download(document.storage_path);
    if (downloadError) throw downloadError;
    const extracted = await extractDocument(file);

    await admin.from("lab_results").delete().eq("document_id", document.id);
    if (extracted.results.length) {
      const { error: labError } = await admin.from("lab_results").insert(extracted.results.map((result: ExtractedLabResult) => ({
        patient_id: document.patient_id,
        document_id: document.id,
        result_date: result.result_date,
        parameter_name: result.parameter_name.trim(),
        measured_value: result.measured_value,
        unit: result.unit.trim(),
        reference_low: result.reference_low ?? null,
        reference_high: result.reference_high ?? null,
      })));
      if (labError) throw labError;
    }
    await admin.from("medical_documents").update({
      extracted_document_text: extracted.document_text,
      extracted_document_json: extracted,
      lab_extraction_status: extracted.results.length ? "completed" : "no_results",
      lab_extraction_count: extracted.results.length,
      lab_extraction_error: null,
    }).eq("id", document.id);
    return json({ documentId: document.id, extractedLabResults: extracted.results.length });
  } catch (error) {
    console.error(error);
    if (documentId) {
      await admin.from("medical_documents").update({
        lab_extraction_status: Deno.env.get("GEMINI_API_KEY") ? "failed" : "not_configured",
        lab_extraction_error: error instanceof Error ? error.message.slice(0, 900) : "Unknown extraction error",
      }).eq("id", documentId);
    }
    return json({ error: "Document extraction failed." }, 500);
  }
});
