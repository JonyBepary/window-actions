# DBus API Reference

This document describes the current DBus surface exported by the `window-actions@openalo.local` GNOME Shell extension.

## DBus Coordinates

- Destination: `org.gnome.Shell`
- Object path: `/org/gnome/Shell/Extensions/Windows`
- Interface: `org.gnome.Shell.Extensions.Windows`

## Signals

### `WindowFocusChanged(winid, details_json)`
Emitted when the focused window changes.

Payload:

- `winid`: `u`
- `details_json`: `s`

`details_json` includes:

- `id`
- `title`
- `wm_class`
- `wm_class_instance`
- `pid`
- `x`
- `y`
- `width`
- `height`
- `monitor`
- `workspace`
- `focus`

Desktop Icons NG focus surfaces are intentionally ignored so background desktop-icon windows do not generate noisy focus events for OpenALO.

### `WindowCreated(winid, wm_class, pid)`
Emitted when a window first becomes identifiable and focused.

Payload:

- `winid`: `u`
- `wm_class`: `s`
- `pid`: `u`

This signal is intentionally stricter than raw Mutter window creation so transient popup surfaces do not generate noisy events.

### `WindowClosed(winid, wm_class)`
Emitted when a tracked window closes.

Payload:

- `winid`: `u`
- `wm_class`: `s`

### `WorkspaceChanged(workspace_index)`
Emitted when the active workspace changes.

Payload:

- `workspace_index`: `u`

## Query Methods

### `List()`
Returns all current windows as a JSON array.

### `ListOnWorkspace(workspace_index)`
Returns only windows whose workspace index matches `workspace_index`.

### `GetWindowsByPID(pid)`
Returns only windows belonging to the given process ID.

### `GetFocusedWindow()`
Returns the currently focused window as JSON, or `null` if no focused window is available.

### `GetMonitorGeometry(monitor_index)`
Returns monitor geometry and scale as JSON.

Returned fields:

- `x`
- `y`
- `width`
- `height`
- `scale_factor`
- `is_primary`

### `Details(winid)`
Returns expanded metadata for a specific window.

### `GetTitle(winid)`
Returns the title string for a specific window.

### `GetFrameRect(winid)`
Returns the frame rectangle for a specific window.

### `GetFrameBounds(winid)`
Returns frame bounds for a specific window.

## Control Methods

- `MoveToWorkspace(winid, workspace_num)`
- `MoveResize(winid, x, y, width, height)`
- `Resize(winid, width, height)`
- `Move(winid, x, y)`
- `Maximize(winid)`
- `Minimize(winid)`
- `Unmaximize(winid)`
- `Unminimize(winid)`
- `Activate(winid)`
- `Close(winid)`

## Validation Commands

Introspect the current interface:

```sh
gdbus introspect --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows
```

Monitor signals:

```sh
gdbus monitor --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows
```

Fetch the focused window:

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.GetFocusedWindow
```

Fetch monitor geometry:

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.GetMonitorGeometry 0
```

List windows on workspace 0:

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.ListOnWorkspace 0
```

List windows by PID:

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.GetWindowsByPID 913271
```
