import { demoEvents } from "../data/demo";
import type { ClinicalEvent } from "../types";
import { supabase } from "./supabase";

type ClinicalEventRow = {
  event_date: string;
  event_type: string;
  title: string;
  detail: string;
  tags: string[];
};

export async function loadClinicalEvents(): Promise<{
  events: ClinicalEvent[];
  source: "demo" | "supabase";
}> {
  if (!supabase) return { events: demoEvents, source: "demo" };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { events: demoEvents, source: "demo" };

  const { data, error } = await supabase
    .from("clinical_events")
    .select("event_date, event_type, title, detail, tags")
    .order("event_date", { ascending: false });

  if (error || !data?.length) return { events: demoEvents, source: "demo" };

  return {
    source: "supabase",
    events: (data as ClinicalEventRow[]).map((event) => ({
      date: new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(event.event_date)),
      type: event.event_type,
      title: event.title,
      detail: event.detail,
      tags: event.tags,
    })),
  };
}
