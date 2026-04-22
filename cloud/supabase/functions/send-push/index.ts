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

    // Server-side delay — not affected by iOS backgrounding
    if (delay_seconds && delay_seconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay_seconds * 1000));
    }

    // Send the push notification
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

    await webpush.sendNotification(pushSub, payload);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  } catch (e) {
    console.error("Push error:", e);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }
});
