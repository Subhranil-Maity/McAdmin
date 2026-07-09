# File Management API

All file endpoints are under `/api/files`. All paths are relative to the server home directory (`HOME_DIR` from `.env`). The root path `/` maps to `HOME_DIR`.

Path traversal attacks (`..`, absolute paths, symlink escapes) are blocked at every endpoint. Read operations additionally canonicalize the resolved path to catch symlink-based escapes.

---

## GET /api/files

Lists files and directories at a given path.

### Query parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `path` | `string` | `/` | Relative directory path. Use `/` for root. |

### Response `200`

```json
{
  "path": "/plugins",
  "entries": [
    {
      "name": "Essentials",
      "size": 0,
      "modified": "2024-07-09T12:00:00+00:00",
      "type": "dir"
    },
    {
      "name": "config.yml",
      "size": 4096,
      "modified": "2024-07-09T12:00:00+00:00",
      "type": "file"
    },
    {
      "name": "world_link",
      "size": 0,
      "modified": "2024-07-09T12:00:00+00:00",
      "type": "symlink"
    }
  ]
}
```

- `path` — normalized request path (always starts with `/`)
- `entries` — sorted: directories first, then files/symlinks, alphabetically within each group. Hidden entries (names starting with `.`) are excluded.
- `type` — one of `"file"`, `"dir"`, `"symlink"`

### Errors

| Code | Reason |
|------|--------|
| `400` | Path is not a directory, or path traversal detected |
| `404` | Path does not exist |

---

## GET /api/files/content

Returns the content of a text file for preview. Applies binary detection before returning.

### Query parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `path` | `string` | yes | Relative file path |

### Binary detection (`is_likely_text`)

Files are checked in this order:

1. **ZIP/JAR header** — If the first 4 bytes are `50 4B 03 04` (PK\0x03\0x04), the file is a ZIP/JAR archive. Blocked.
2. **Null byte scan** — If a null byte (0x00) is found within the first 512 bytes, the file is binary. Blocked.
3. **Pass** — Everything else is treated as text.

File extensions are never checked — only content analysis is used.

### Response `200`

```json
{
  "path": "/server.properties",
  "size": 4096,
  "content": "motd=A Minecraft Server\nmax-players=20\n"
}
```

### Errors

| Code | Reason |
|------|--------|
| `400` | Path is a directory, path traversal detected, or file is binary (fails `is_likely_text`) |
| `404` | File does not exist |
| `413` | File exceeds 5MB maximum preview size |

---

## POST /api/files/write

Writes a text file to the server directory. Content is provided inline as a JSON body.

The write flow is:

```
JSON body → write to {server_dir}/.tmp/{timestamp}_{filename} → fs::rename to destination
```

The `.tmp/` directory is automatically created if needed. Parent directories of the destination are also created automatically.

### Request body

```json
{
  "path": "plugins/Essentials/config.yml",
  "content": "# Config file\nenabled: true\n",
  "force": false
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `path` | `string` | yes | — | Relative destination path |
| `content` | `string` | yes | — | File content |
| `force` | `bool` | no | `false` | If `true`, overwrites existing files without error |

### Response `200`

```json
{
  "status": "ok",
  "path": "/plugins/Essentials/config.yml"
}
```

### Errors

| Code | Reason |
|------|--------|
| `400` | Path traversal detected |
| `409` | File already exists and `force` is `false` |

**No text validation is performed on the content.** The file is written as-is.

---

## POST /api/files/upload

Uploads a file via multipart form data. For large files or binary files that shouldn't be embedded in JSON.

The write flow is identical to `POST /api/files/write`:

```
multipart stream → write to {server_dir}/.tmp/{timestamp}_{filename} → fs::rename to destination
```

### Multipart fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `text` | yes | Relative destination path |
| `file` | `file` | yes | File content (any size) |
| `force` | `text` | no | Set to `"true"` or `"1"` to overwrite existing files |

### Response `200`

```json
{
  "status": "ok",
  "path": "/plugins/MyPlugin.jar"
}
```

### Errors

| Code | Reason |
|------|--------|
| `400` | Missing required field (`path` or `file`), or path traversal detected |
| `409` | File already exists and `force` is not `"true"` |

**No text validation is performed on upload.** Any file type is accepted.

---

## Common behaviors

### Path validation

All path parameters (`path` query, `path` field in body/multipart) are validated:

1. Leading `/` is stripped
2. Each path component must be `Normal` — `..`, absolute roots, and Windows drive prefixes (`C:`) are rejected
3. The resolved path is verified to be a descendant of `HOME_DIR`

For read operations (`GET /api/files`, `GET /api/files/content`), the path is additionally canonicalized and re-checked against the canonical `HOME_DIR` to catch symlink-based escapes.

### Temp file strategy (`write_file_inner`)

All write operations use an atomic rename pattern:

1. Content is written to `{server_dir}/.tmp/{timestamp}_{original_name}`
2. The temp file is renamed (moved) to the final destination via `tokio::fs::rename`
3. If rename fails, the temp file is cleaned up and an error is returned

Renames are atomic on the same filesystem, preventing partial/corrupt files on disk.

### Maximum preview size

`MAX_FILE_PREVIEW_SIZE = 5 MB (5 * 1024 * 1024 bytes)`

This only applies to `GET /api/files/content` — the upload endpoint has no size limit.

### Hidden files

Entries starting with `.` (dotfiles) are excluded from directory listings.
