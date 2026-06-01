import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { EventWebhook } from "npm:@sendgrid/eventwebhook";

type SendGridEvent = {
  delivery_id?: string;
  event?: string;
  reason?: string;
  response?: string;
  sg_event_id?: string;
  timestamp?: number;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const signature = request.headers.get("X-Twilio-Email-Event-Webhook-Signature");
    const timestamp = request.headers.get("X-Twilio-Email-Event-Webhook-Timestamp");
    const publicKey = Deno.env.get("SENDGRID_WEBHOOK_PUBLIC_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!signature || !timestamp || !publicKey || !supabaseUrl || !serviceRoleKey) {
      return json({ error: "Webhook security configuration is missing." }, 401);
    }

    const rawPayload = await request.text();
    const verifier = new EventWebhook();
    const ecPublicKey = verifier.convertPublicKeyToECDSA(publicKey);
    if (!verifier.verifySignature(ecPublicKey, rawPayload, signature, timestamp)) {
      return json({ error: "Invalid webhook signature." }, 401);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const events = JSON.parse(rawPayload) as SendGridEvent[];
    for (const event of events) {
      if (!event.delivery_id || !event.sg_event_id || !event.event) continue;

      await admin.from("email_delivery_events").upsert({
        delivery_id: event.delivery_id,
        provider_event_id: event.sg_event_id,
        event_type: event.event,
        reason: (event.reason || event.response || "").slice(0, 1000),
        occurred_at: event.timestamp ? new Date(event.timestamp * 1000).toISOString() : null,
      }, { onConflict: "provider_event_id", ignoreDuplicates: true });

      if (event.event === "delivered") {
        await admin.from("email_deliveries").update({ status: "delivered" }).eq("id", event.delivery_id);
      }
      if (event.event === "bounce" || event.event === "dropped") {
        await admin.from("email_deliveries").update({
          status: "failed",
          error_message: (event.reason || event.response || event.event).slice(0, 1000),
        }).eq("id", event.delivery_id);
      }
    }

    return json({ accepted: true });
  } catch (error) {
    console.error(error);
    return json({ error: "Webhook processing failed." }, 500);
  }
});
