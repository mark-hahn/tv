import { WebSocket } from "ws";

const HA_URL = "wss://hahnca.com:8123/api/websocket";
const HA_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIzM2Y2MmI0MWZjYTY0YTE1YWU2MjFlZDg2NGJmM2NmYyIsImlhdCI6MTc3MDc5NjQ0NywiZXhwIjoyMDg2MTU2NDQ3fQ.AoUSLrAjOWEhR2pQVeuuykKYPoXqyrnmecQMQkdrgp8";
const ENTITY_ID = "media_player.bravia_k_65xr70";

const HELP = `Usage: node bravia.js [--help|-h] <command>

Commands:
  status   Print all state and attributes for ${ENTITY_ID}
  on       media_player.turn_on
  off      media_player.turn_off
  up       media_player.volume_up
  down     media_player.volume_down
  mute     media_player.volume_mute (toggle)
  emby     media_player.select_source source="Emby"
  notify   notify.send_message <message>
`;

const arg = process.argv[2];
if (!arg || arg === "--help" || arg === "-h") {
  process.stdout.write(HELP);
  process.exit(0);
}

const COMMANDS = [
  "status",
  "on",
  "off",
  "up",
  "down",
  "mute",
  "emby",
  "notify",
];
if (!COMMANDS.includes(arg)) {
  process.stderr.write(`Unknown command: ${arg}\n${HELP}`);
  process.exit(1);
}

const ws = new WebSocket(HA_URL, { rejectUnauthorized: false });
let cmdId = 0;

ws.on("open", () => {});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === "auth_required") {
    ws.send(JSON.stringify({ type: "auth", access_token: HA_TOKEN }));
    return;
  }

  if (msg.type === "auth_invalid") {
    process.stderr.write("auth_invalid\n");
    process.exit(1);
  }

  if (msg.type === "auth_ok") {
    if (arg === "status") {
      ws.send(JSON.stringify({ id: ++cmdId, type: "get_states" }));
    } else if (arg === "mute") {
      // For mute we need current state first to toggle correctly
      ws.send(JSON.stringify({ id: ++cmdId, type: "get_states" }));
    } else if (arg === "notify") {
      sendCommand();
    } else {
      sendCommand();
    }
    return;
  }

  if (msg.type === "result") {
    if (!msg.success) {
      process.stderr.write(`Error: ${JSON.stringify(msg.error)}\n`);
      process.exit(1);
    }

    if (arg === "status" && Array.isArray(msg.result)) {
      const entity = msg.result.find((s) => s.entity_id === ENTITY_ID);
      if (!entity) {
        process.stderr.write(`Entity ${ENTITY_ID} not found\n`);
        process.exit(1);
      }
      console.log("state:", entity.state);
      for (const [k, v] of Object.entries(entity.attributes ?? {})) {
        console.log(`  ${k}: ${JSON.stringify(v)}`);
      }
      ws.close();
      process.exit(0);
    }

    if (arg === "mute" && Array.isArray(msg.result)) {
      const entity = msg.result.find((s) => s.entity_id === ENTITY_ID);
      const currentMuted = entity?.attributes?.is_volume_muted ?? false;
      ws.send(
        JSON.stringify({
          id: ++cmdId,
          type: "call_service",
          domain: "media_player",
          service: "volume_mute",
          target: { entity_id: ENTITY_ID },
          service_data: { is_volume_muted: !currentMuted },
        }),
      );
      return;
    }

    // Response to a call_service
    console.log("ok");
    ws.close();
    process.exit(0);
  }
});

ws.on("error", (err) => {
  process.stderr.write(`WebSocket error: ${err.message}\n`);
  process.exit(1);
});

function sendCommand() {
  const SERVICE_MAP = {
    on: ["media_player", "turn_on", {}],
    off: ["media_player", "turn_off", {}],
    up: ["media_player", "volume_up", {}],
    down: ["media_player", "volume_down", {}],
    emby: ["media_player", "select_source", { source: "Emby" }],
    notify: [
      "notify",
      "send_message",
      {
        message: process.argv.slice(3).join(" "),
        title: "Notification",
      },
    ],
  };
  const [domain, service, serviceData] = SERVICE_MAP[arg];
  const cmd = {
    id: ++cmdId,
    type: "call_service",
    domain,
    service,
    target: { entity_id: "notify.bravia_k_65xr70" },
  };
  if (Object.keys(serviceData).length > 0) cmd.service_data = serviceData;
  ws.send(JSON.stringify(cmd));
}
