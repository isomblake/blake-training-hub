import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;

webpush.setVapidDetails(
  "mailto:isomblake@gmail.com",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  try {
    const { subscription, title, body, delay_seconds, tag } = await req.json();

    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return new Response(JSON.stringify({ error: "Missing or invalid subscription" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const payload = JSON.stringify({
      title: title || "Training Hub",
      body: body || "Timer alert",
      tag: tag || "rest-timer",
    });

    const pushSub = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    };

    // Delay + send as a background task AFTER responding. Holding the request open for the
    // delay tied execution to the client connection — iOS drops it on backgrounding and the
    // runtime killed the function before the push ever sent.
    const task = async () => {
      if (delay_seconds && delay_seconds > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay_seconds * 1000));
      }
      await webpush.sendNotification(pushSub, payload);
      console.log("Push sent:", tag, "after", delay_seconds || 0, "s");
    };

    // @ts-ignore — EdgeRuntime is provided by the Supabase edge runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(task().catch((e) => console.error("Push send error:", e)));
    } else {
      task().catch((e) => console.error("Push send error:", e));
    }

    return new Response(
      JSON.stringify({ scheduled: true, delay_seconds: delay_seconds || 0 }),
      { status: 202, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  } catch (e) {
    console.error("Push error:", e);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }
});
