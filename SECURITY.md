# Security Policy

## Trust Model

`window-actions` exposes a DBus API on the GNOME session bus from within the `gnome-shell` process.

This means:

- the API is available to any process running in the same user session
- there is no caller authentication at the extension layer
- destructive methods such as `Close()`, `Move()`, and `MoveResize()` are intentionally available to trusted OpenALO components

This is an accepted design tradeoff for low-latency local automation, not a secure multi-tenant control model.

## Accepted Risks

The following risks are currently accepted as part of the extension design:

- any same-UID process can invoke exported DBus methods
- window titles, process IDs, and geometry may be observable through query methods and DBus signals
- window control operations can be abused by untrusted co-processes in the same session

## Hardening Recommendations

If this extension must run in a higher-risk environment:

- deploy only in controlled user sessions
- use AppArmor or SELinux policy to restrict which processes can access the session bus
- avoid running untrusted desktop applications in the same session as OpenALO
- monitor GNOME Shell logs for destructive operation audit messages emitted by the extension

## Reporting Security Issues

If you discover a security issue:

- include a clear reproduction path
- include affected GNOME Shell version and extension commit hash if available
- include whether the issue is session-bus only, local same-user, or broader in scope

Until a dedicated security contact exists, report issues through the project repository used to maintain this extension.
