# Player Management API

All player-related endpoints under `/api/server/players`. The backend determines how to apply changes based on server state:

- **Server ONLINE** — changes are sent via RCON to the running Minecraft server.
- **Server OFFLINE** — changes are written directly to the Minecraft JSON files (`ops.json`, `whitelist.json`, `banned-players.json`). The player must exist in `usercache.json` for UUID resolution; if not found, a `400` is returned.
- **Server STARTING** — all write operations return `409 Conflict`.

---

## GET /api/server/players

Returns all known players from `usercache.json`, enriched with their op/whitelist/ban status. Always succeeds.

### Response `200`

```json
{
  "players": [
    {
      "name": "Notch",
      "uuid": "069a79f4-44e9-4726-a5be-fca90e38aaf5",
      "op": true,
      "op_level": 4,
      "whitelisted": true,
      "banned": false
    }
  ]
}
```

If `usercache.json` is missing or empty, `players` is an empty array.

---

## GET /api/server/players/online

Returns currently online players via RCON `list` command.

### Response `200`

Returns a JSON array of online player names:

```json
["Notch", "Jeb", "Herobrine"]
```

### Error `409`

Server is not `ONLINE`.

---

## POST /api/server/players/ban

Bans a player.

### Request body

```json
{
  "player": "Notch",
  "reason": "Griefing the spawn area"
}
```

- `player` — required, trimmed of whitespace. Must be non-empty.
- `reason` — optional. Ignored if empty or whitespace-only.

### Response `200`

```json
{
  "status": "ok",
  "method": "rcon",
  "message": "Banned Notch"
}
```

`method` is `"rcon"` when sent via RCON, `"file"` when written to `banned-players.json`. If already banned, returns `"message": "{player} is already banned"`.

### Errors

| Code | Reason |
|------|--------|
| `400` | Empty player name, or player not found in `usercache.json` (offline mode) |
| `409` | Server is `STARTING` |
| `502` | RCON command failed (online mode) |

---

## POST /api/server/players/unban

Unbans a player.

### Request body

```json
{
  "player": "Notch"
}
```

### Response `200`

```json
{
  "status": "ok",
  "method": "rcon",
  "message": "Unbanned Notch"
}
```

### Errors

| Code | Reason |
|------|--------|
| `400` | Empty player name |
| `404` | Player not found in `banned-players.json` (offline mode) |
| `409` | Server is `STARTING` |
| `502` | RCON command failed (online mode) |

---

## POST /api/server/players/whitelist

Adds a player to the whitelist.

### Request body

```json
{
  "player": "Notch"
}
```

### Response `200`

```json
{
  "status": "ok",
  "method": "rcon",
  "message": "Added Notch to whitelist"
}
```

If already whitelisted, returns `"message": "{player} is already whitelisted"`.

### Errors

| Code | Reason |
|------|--------|
| `400` | Empty player name, or player not found in `usercache.json` (offline mode) |
| `409` | Server is `STARTING` |
| `502` | RCON command failed (online mode) |

---

## POST /api/server/players/dewhitelist

Removes a player from the whitelist.

### Request body

```json
{
  "player": "Notch"
}
```

### Response `200`

```json
{
  "status": "ok",
  "method": "rcon",
  "message": "Removed Notch from whitelist"
}
```

### Errors

| Code | Reason |
|------|--------|
| `400` | Empty player name |
| `404` | Player not found in `whitelist.json` (offline mode) |
| `409` | Server is `STARTING` |
| `502` | RCON command failed (online mode) |

---

## POST /api/server/players/op

Gives a player operator status (op level 4).

### Request body

```json
{
  "player": "Notch"
}
```

### Response `200`

```json
{
  "status": "ok",
  "method": "rcon",
  "message": "Opped Notch"
}
```

If already an operator, returns `"message": "{player} is already op"`.

### Errors

| Code | Reason |
|------|--------|
| `400` | Empty player name, or player not found in `usercache.json` (offline mode) |
| `409` | Server is `STARTING` |
| `502` | RCON command failed (online mode) |

---

## POST /api/server/players/deop

Removes a player's operator status.

### Request body

```json
{
  "player": "Notch"
}
```

### Response `200`

```json
{
  "status": "ok",
  "method": "rcon",
  "message": "Deopped Notch"
}
```

### Errors

| Code | Reason |
|------|--------|
| `400` | Empty player name |
| `404` | Player not found in `ops.json` (offline mode) |
| `409` | Server is `STARTING` |
| `502` | RCON command failed (online mode) |

---

## Common response shape

All write endpoints return the same envelope:

```json
{
  "status": "ok",
  "method": "rcon | file",
  "message": "Human-readable result"
}
```

- `status` is always `"ok"` on success.
- `method` indicates how the change was applied: `"rcon"` (server running) or `"file"` (server stopped).

## Common error shape

Errors are returned as HTTP status codes with no body (standard Axum behavior). Check the response status code to determine error type.
