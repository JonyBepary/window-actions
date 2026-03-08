# Window Actions DBus API

This document is the authoritative DBus API reference for the `window-actions@openalo.local` GNOME Shell extension.

The extension exposes window discovery, focused-window grounding metadata, lifecycle events, and window control operations over the GNOME Shell session bus for OpenALO.

## Overview

The API is designed around three use cases:

- reactive window awareness via DBus signals
- accurate grounding data for the currently focused window
- direct window enumeration and control without polling the full desktop state more than necessary

The current implementation includes:

- Milestone A: reactive lifecycle signals and focused grounding methods
- Milestone B: server-side filtered enumeration methods
- security hardening for parameter validation, rate limiting, and clearer trust-model documentation

## DBus Coordinates

- Bus: session bus
- Destination: `org.gnome.Shell`
- Object path: `/org/gnome/Shell/Extensions/Windows`
- Interface: `org.gnome.Shell.Extensions.Windows`
- Extension UUID: `window-actions@openalo.local`

## Security Model

> **Warning:** This extension exports its API on the GNOME session bus with no caller authentication.
> Any process running in the same user session can invoke every exported method, including destructive operations such as `Close()`, `Move()`, and `MoveResize()`.
>
> This trust model is intentional for OpenALO integration, but it means the extension must be treated as a trusted-session component, not a multi-tenant control surface.

Implications:

- any same-UID process can enumerate windows and monitor focus changes
- any same-UID process can close, activate, move, resize, or reassign windows to workspaces
- signal payloads may expose sensitive metadata such as window titles, URLs, document names, and process IDs

Recommended deployment assumptions:

- deploy only in controlled user sessions
- do not assume D-Bus caller identity or ownership-based access control exists
- use OS-level confinement such as AppArmor or SELinux if session-bus access needs to be restricted

## Design Notes

### Data Format

Most methods return JSON strings instead of typed DBus structs. This preserves compatibility with the historical extension behavior and simplifies integration with existing consumers.

### Lifecycle Model

The extension does not emit a raw `window-created` event for every transient Mutter surface.

Instead:

- `WindowCreated` is emitted only when a window becomes identifiable and focused
- `WindowClosed` is emitted for windows that were previously announced or have usable cached metadata
- transient popup and menu surfaces are intentionally suppressed to keep lifecycle signals useful for OpenALO

### Focus Filtering

`WindowFocusChanged` intentionally ignores Desktop Icons NG focus surfaces, which otherwise generate noisy focus churn with `wm_class: gjs` and titles like `Desktop Icons 1`.

## Signals

### `WindowFocusChanged(winid, details_json)`
Emitted when the focused window changes to a user-relevant window.

Arguments:

- `winid`: `u`
- `details_json`: `s`

`details_json` schema:

```json
{
  "id": 3655718775,
  "title": "codex",
  "wm_class": "com.github.amezin.ddterm",
  "wm_class_instance": "com.github.amezin.ddterm",
  "pid": 913271,
  "x": 1432,
  "y": 32,
  "width": 1854,
  "height": 724,
  "monitor": 0,
  "workspace": 0,
  "focus": true
}
```

Semantics:

- emitted after the extension resolves the current focused `MetaWindow`
- intended to be the primary trigger for OpenALO grounding refresh
- filtered to avoid Desktop Icons NG noise

> **Privacy Note:** This signal is broadcast to all session-bus listeners without authentication. The payload includes window titles, PIDs, and geometry data. Titles may contain sensitive user information such as URLs, document names, or message subjects.

### `WindowCreated(winid, wm_class, pid)`
Emitted when a newly relevant window becomes identifiable and focused for the first time.

Arguments:

- `winid`: `u`
- `wm_class`: `s`
- `pid`: `u`

Semantics:

- not every low-level Mutter surface generates this signal
- popup menus and transient helper surfaces are intentionally excluded
- used to detect newly actionable windows rather than every raw compositor object

Typical uses:

- detect the main window after launching an application
- trigger one-time initialization for a newly focused app window

> **Privacy Note:** This signal is broadcast to all session-bus listeners without authentication. Even without a title field, `wm_class` and `pid` still reveal application identity and process correlation data.

### `WindowClosed(winid, wm_class)`
Emitted when a tracked window closes.

Arguments:

- `winid`: `u`
- `wm_class`: `s`

Semantics:

- emitted when the extension can associate the closing window with prior metadata
- uses cached metadata so the class is still available during teardown

> **Privacy Note:** This signal is broadcast to all session-bus listeners without authentication. The `wm_class` field reveals which application window closed.

### `WorkspaceChanged(workspace_index)`
Emitted when the active GNOME workspace changes.

Arguments:

- `workspace_index`: `u`

Typical use:

- invalidate cached workspace-scoped window views
- refresh OpenALO context when workspace changes affect visible windows

> **Privacy Note:** This signal is broadcast to all session-bus listeners without authentication. While it does not expose titles, it still reveals user navigation behavior across workspaces.

## Query Methods

### `List()`
Returns all current windows as a JSON array.

Signature:

- output: `s`

Example call:

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.List
```

Example item shape:

```json
{
  "wm_class": "brave-browser",
  "wm_class_instance": "brave-browser",
  "title": "New Tab - Brave",
  "pid": 929623,
  "id": 3655718774,
  "frame_type": 0,
  "window_type": 0,
  "width": 1854,
  "height": 1048,
  "x": 1432,
  "y": 32,
  "focus": true,
  "in_current_workspace": true,
  "workspace": 0,
  "monitor": 0
}
```

### `ListOnWorkspace(workspace_index)`
Returns only windows assigned to the specified workspace.

Signature:

- input: `workspace_index` `i`
- output: `windows` `s`

Valid parameter range:

- `workspace_index` must be an integer in the range `0 <= workspace_index < global.workspace_manager.get_n_workspaces()`

Behavior:

- reuses the same JSON item shape as `List()`
- performs filtering inside the extension before returning the payload
- throws an error for out-of-range workspace indices

### `GetWindowsByPID(pid)`
Returns only windows associated with a specific process ID.

Signature:

- input: `pid` `u`
- output: `windows` `s`

Behavior:

- reuses the same JSON item shape as `List()`
- returns an empty JSON array when no window matches the PID

Typical use:

- correlate launched processes with visible windows
- narrow a multi-window application down to one process origin

### `GetFocusedWindow()`
Returns the currently focused window as JSON.

Signature:

- output: `s`

Behavior:

- returns JSON `null` if no focused window is available
- intended to replace `List()` plus client-side focus filtering for the common grounding path

Returned shape:

```json
{
  "id": 3655718775,
  "title": "codex",
  "wm_class": "com.github.amezin.ddterm",
  "wm_class_instance": "com.github.amezin.ddterm",
  "pid": 913271,
  "x": 1432,
  "y": 32,
  "width": 1854,
  "height": 724,
  "monitor": 0,
  "workspace": 0,
  "focus": true
}
```

### `GetMonitorGeometry(monitor_index)`
Returns monitor geometry and scale metadata as JSON.

Signature:

- input: `monitor_index` `i`
- output: `geometry` `s`

Valid parameter range:

- `monitor_index` must be an integer in the range `0 <= monitor_index < global.display.get_n_monitors()`

Returned shape:

```json
{
  "x": 1366,
  "y": 0,
  "width": 1920,
  "height": 1080,
  "scale_factor": 1,
  "is_primary": true
}
```

Typical use:

- apply HiDPI-aware coordinate correction
- determine per-monitor offsets in multi-monitor layouts

### `Details(winid)`
Returns expanded metadata for a single window.

Signature:

- input: `winid` `u`
- output: `win` `s`

Fields include:

- identity: `id`, `pid`, `title`, `wm_class`, `wm_class_instance`, `role`
- geometry: `x`, `y`, `width`, `height`, `monitor`
- state: `focus`, `maximized`, `frame_type`, `window_type`, `layer`
- capabilities: `moveable`, `resizeable`, `canclose`, `canmaximize`, `canminimize`, `canshade`
- work areas: `area`, `area_all`, `area_cust`

Notes:

- the legacy `display` field was intentionally removed because it serialized an opaque `Meta.Display` object into useless output

### `GetTitle(winid)`
Returns a JSON-encoded title string.

Signature:

- input: `winid` `u`
- output: `win` `s`

Important behavior:

- this method now returns `JSON.stringify(title)` for consistency with the rest of the API
- consumers expecting a raw string must decode the JSON string first
- titles may contain arbitrary Unicode, newlines, and special characters sourced from the owning application

### `GetFrameRect(winid)`
Returns the frame rectangle for a window as JSON.

Signature:

- input: `winid` `u`
- output: `frameRect` `s`

Returned shape:

```json
{
  "x": 1432,
  "y": 32,
  "width": 1854,
  "height": 1048
}
```

Notes:

- throws `Frame unavailable` if GNOME Shell cannot resolve a frame rectangle for the target window

### `GetFrameBounds(winid)`
Returns frame bounds for a window as JSON.

Signature:

- input: `winid` `u`
- output: `frameBounds` `s`

## Control Methods

### `MoveToWorkspace(winid, workspace_num)`
Moves a window to a target workspace.

Parameter rules:

- `workspace_num` must be an integer in the valid workspace range

### `MoveResize(winid, x, y, width, height)`
Moves and resizes a window in a single operation.

Parameter rules:

- `x` and `y` must be integers
- `width` and `height` must be positive integers

Audit behavior:

- requests are logged to GNOME Shell logs for forensic visibility

### `Resize(winid, width, height)`
Resizes a window.

Parameter rules:

- `width` and `height` must be positive integers

### `Move(winid, x, y)`
Moves a window.

Parameter rules:

- `x` and `y` must be integers

Audit behavior:

- requests are logged to GNOME Shell logs for forensic visibility

### `Maximize(winid)`
Maximizes a window.

### `Minimize(winid)`
Minimizes a window.

### `Unmaximize(winid)`
Restores a maximized window.

### `Unminimize(winid)`
Restores a minimized window.

### `Activate(winid)`
Activates a window, switching workspace if needed.

### `Close(winid)`
Requests window deletion using the current GNOME Shell timestamp.

Behavior:

- per-window close requests are rate-limited to one request per 100 ms
- close requests are logged to GNOME Shell logs for forensic visibility

## Error Behavior

Methods addressing a specific window ID throw `Not found` when the target window cannot be resolved.

Examples:

- `Details(winid)`
- `GetTitle(winid)`
- `GetFrameRect(winid)`
- `Move(winid, x, y)`
- `Close(winid)`

Additional method-specific errors:

- `Invalid workspaceIndex: ...`
- `Invalid monitorIndex: ...`
- `Invalid width: must be a positive integer`
- `Invalid x: must be an integer`
- `Frame unavailable`
- `Rate limited`

Collection methods return empty JSON arrays where appropriate instead of throwing.

## OpenALO Grounding Pattern

The intended focused grounding flow is:

1. subscribe to `WindowFocusChanged`
2. call `GetFocusedWindow()` if full state refresh is needed
3. call `GetMonitorGeometry(focused['monitor'])`
4. combine AT-SPI relative coordinates with frame offset and monitor scale

Reference formula:

```python
focused = ext.GetFocusedWindow()
monitor = ext.GetMonitorGeometry(focused['monitor'])
scale = monitor['scale_factor']
screen_x = (atspi_x + focused['x']) * scale
screen_y = (atspi_y + focused['y']) * scale
```

## Validation Commands

### Introspection

```sh
gdbus introspect --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows
```

### Signal Monitoring

```sh
gdbus monitor --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows
```

### Focused Window

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.GetFocusedWindow
```

### Monitor Geometry

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.GetMonitorGeometry 0
```

### Workspace Filter

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.ListOnWorkspace 0
```

### PID Filter

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.GetWindowsByPID 973721
```

### Title Query

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.GetTitle 973721
```

## Compatibility Notes

- the API keeps JSON-string method outputs for backward compatibility with the original extension style
- `WindowCreated` semantics are intentionally stricter than raw GNOME compositor lifecycle events
- `GetTitle()` now returns a JSON-encoded string instead of a raw string
- on Wayland, GNOME Shell sometimes requires a full logout/login before DBus interface shape changes become visible after local extension edits
