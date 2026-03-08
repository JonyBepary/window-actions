# Changelog

## Unreleased

### Changed

- `GetTitle(winid)` now returns a JSON-encoded string instead of a raw string.
- mutating methods now validate parameter ranges and integer requirements.
- `GetMonitorGeometry(monitor_index)` now validates monitor index bounds.
- `ListOnWorkspace(workspace_index)` now validates workspace index bounds.

### Security

- added explicit session-bus security and privacy documentation
- added per-window rate limiting for `Close()`
- added audit logging for destructive window manipulation methods
- removed the non-useful `display` field from `Details(winid)` output
- added defensive frame-availability checks before geometry serialization
