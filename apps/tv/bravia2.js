import { WebSocket } from "ws";

const HA_URL = "wss://hahnca.com:8123/api/websocket";
const HA_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIzM2Y2MmI0MWZjYTY0YTE1YWU2MjFlZDg2NGJmM2NmYyIsImlhdCI6MTc3MDc5NjQ0NywiZXhwIjoyMDg2MTU2NDQ3fQ.AoUSLrAjOWEhR2pQVeuuykKYPoXqyrnmecQMQkdrgp8";
const ENTITY_ID = "media_player.bravia_k_65xr70";

function ts() {
  return new Date()
    .toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
    .replace(",", "");
}

const ws = new WebSocket(HA_URL, { rejectUnauthorized: false });

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === "auth_required") {
    ws.send(JSON.stringify({ type: "auth", access_token: HA_TOKEN }));
    return;
  }

  if (msg.type === "auth_invalid") {
    console.error("auth_invalid");
    process.exit(1);
  }

  if (msg.type === "auth_ok") {
    ws.send(
      JSON.stringify({
        id: 1,
        type: "subscribe_events",
        event_type: "state_changed",
      }),
    );
    console.log(`[${ts()}] subscribed — waiting for ${ENTITY_ID} changes...`);
    return;
  }

  if (msg.type === "event" && msg.event?.event_type === "state_changed") {
    const d = msg.event.data;
    if (d?.new_state?.entity_id !== ENTITY_ID) return;
    const s = d.new_state;
    const prev = d.old_state?.state ?? "?";
    const attrs = s.attributes ?? {};
    const parts = [
      `state: ${prev} -> ${s.state}`,
      `media_title: ${attrs.media_title ?? "null"}`,
      `media_content_type: ${attrs.media_content_type ?? "null"}`,
      `is_volume_muted: ${attrs.is_volume_muted ?? "null"}`,
    ];
    console.log(`[${ts()}] ${parts.join("  |  ")}`);
  }
});

ws.on("error", (err) => {
  console.error("error:", err.message);
  process.exit(1);
});
