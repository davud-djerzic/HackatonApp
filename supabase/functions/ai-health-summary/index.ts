import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fallbackSummary() {
  return {
    summary: "Dosije sadrzi arhivirane nalaze i aktivnu terapiju. Nastavite redovne kontrole prema uputama ljekara.",
    alerts: ["Provjerite da li su svi nalazi iz zadnjih 6 mjeseci ucitani u dosije."],
    trends: ["Podaci ukazuju na kontinuirano pracenje bez novih upozorenja u demo modu."],
    suggestions: ["Zakazite kontrolni pregled kod izabrane klinike."],
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { patientData } = await request.json() as { patientData?: unknown };
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    const geminiKey = Deno.env.get("GEMINI_API_KEY");

    // If GEMINI_API_KEY is present, try Google Generative API first
    if (geminiKey) {
      try {
        const gUrl = `https://generativelanguage.googleapis.com/v1beta2/models/chat-bison-001:generate?key=${encodeURIComponent(geminiKey)}`;
        const gResp = await fetch(gUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: { text: `Analiziraj podatke:\n${JSON.stringify(patientData)}\n\nOdgovori iskljucivo validnim JSON objektom sa poljima: summary (string), alerts (string[]), trends (string[]), suggestions (string[]). Pisi na bosanskom. Ne postavljaj dijagnoze.` },
            temperature: 0.2,
            maxOutputTokens: 800,
          }),
        });
        if (gResp.ok) {
          const gPayload = await gResp.json() as any;
          const text = gPayload?.candidates?.[0]?.content || gPayload?.output?.[0]?.content || gPayload?.candidates?.[0]?.text || "";
          if (text) {
            try {
              const parsed = JSON.parse(text) as Record<string, unknown>;
              return json({
                summary: String(parsed.summary ?? fallbackSummary().summary),
                alerts: Array.isArray(parsed.alerts) ? parsed.alerts.map(String) : fallbackSummary().alerts,
                trends: Array.isArray(parsed.trends) ? parsed.trends.map(String) : fallbackSummary().trends,
                suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : fallbackSummary().suggestions,
              });
            } catch (e) {
              console.error("Failed to parse Gemini response JSON", e);
            }
          }
        } else {
          console.error("Gemini API error", await gResp.text());
        }
      } catch (e) {
        console.error("Gemini API call failed", e);
      }
    }

    // Fallback to Anthropic (existing behaviour) if available
    if (!anthropicKey) {
      return json(fallbackSummary());
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: `Ti si medicinski asistent. Odgovaraj SAMO validnim JSON objektom s poljima: summary (string), alerts (string[]), trends (string[]), suggestions (string[]). Pisi na bosanskom. Ne postavljaj dijagnoze.`,
        messages: [{
          role: "user",
          content: `Analiziraj podatke:\n${JSON.stringify(patientData)}`,
        }],
      }),
    });

    if (!response.ok) {
      console.error(await response.text());
      return json(fallbackSummary());
    }

    const payload = await response.json() as { content?: { text?: string }[] };
    const text = payload.content?.[0]?.text ?? "";
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return json({
      summary: String(parsed.summary ?? fallbackSummary().summary),
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts.map(String) : fallbackSummary().alerts,
      trends: Array.isArray(parsed.trends) ? parsed.trends.map(String) : fallbackSummary().trends,
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : fallbackSummary().suggestions,
    });
  } catch (e) {
    console.error(e);
    return json(fallbackSummary());
  }
});
