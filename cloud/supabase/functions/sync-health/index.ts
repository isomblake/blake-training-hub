import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  try {
    // SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { readings } = await req.json();

    if (!Array.isArray(readings) || readings.length === 0) {
      return new Response(JSON.stringify({ error: "readings must be a non-empty array" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Group by date — last reading per day wins (handles multiple Weight Guru entries)
    const byDate: Record<string, { weight_kg?: number; body_fat_pct?: number }> = {};

    for (const r of readings) {
      if (!r.date) continue;
      const date = String(r.date).slice(0, 10); // ensure YYYY-MM-DD
      if (!byDate[date]) byDate[date] = {};

      // Accept lbs (US Shortcuts default) or kg
      if (r.weight_lb != null) {
        byDate[date].weight_kg = Math.round((r.weight_lb / 2.20462) * 100) / 100;
      } else if (r.weight_kg != null) {
        byDate[date].weight_kg = r.weight_kg;
      }

      if (r.body_fat_pct != null) {
        byDate[date].body_fat_pct = r.body_fat_pct;
      }
    }

    const rows = Object.entries(byDate)
      .filter(([, data]) => data.weight_kg != null || data.body_fat_pct != null)
      .map(([date, data]) => ({ date, ...data, source: "apple_health_shortcut" }));

    if (rows.length === 0) {
      return new Response(JSON.stringify({ upserted: 0 }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Upsert: only updates the columns in each row object — other columns (steps, HRV, etc.)
    // are left untouched on conflict because they aren't included in the row objects.
    const { error } = await supabase
      .from("health_daily")
      .upsert(rows, { onConflict: "date" });

    if (error) throw error;

    return new Response(JSON.stringify({ upserted: rows.length }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sync-health error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
