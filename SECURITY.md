# Security Policy

## Reporting a vulnerability

Report privately through GitHub's [private vulnerability reporting](https://github.com/bassotov/deck/security/advisories/new): the **Security** tab on the repository, then **Report a vulnerability**. That channel is private, so a report does not become a public zero-day the moment it is filed.

Please do not open a public issue for a security problem.

What helps: what you did, what happened, what you expected, and the version (`deck --version`). A proof of concept is welcome but not required.

**Response:** an acknowledgement within 7 days, and an assessment within 30. Fixes ship in a normal release, and the advisory is published once a fix is available. Credit is given unless you would rather stay anonymous.

## Supported versions

The latest release. deck is a local tool with no server component, so there is no deployment to patch. Updating means installing the current release.

## What the threat model is

deck runs entirely on your machine. It has no backend, no account, and makes no outbound network requests. Understanding what it does touch is most of the security picture:

- **The viewer binds to `127.0.0.1`** by default, so it is reachable only from your own machine. `--host` overrides this and exposes it on your network; that is a deliberate choice with consequences you own.
- **The viewer has no authentication.** It does not need any while bound to localhost, and it is not built to be exposed. Do not put it on a public interface.
- **File access is bounded by the decks folder.** Requests for assets reject any path containing `..`, in raw or percent-encoded form, and a resolved file must sit under the configured asset root. Deck slugs are validated against `^[a-z0-9][a-z0-9._-]*$`, so a slug can never traverse a directory.
- **`ASSET_ROOT` widens reads only.** It is honoured only when it is a parent of the decks folder, and nothing is ever written outside the decks folder.
- **Nothing deletes a deck.** No code path in the app, the CLI or the MCP server removes a `.md`.

## MCP-specific notes

When deck runs as an MCP server, an assistant can read and write markdown files in the folder you configured. That is the point of it, but it is worth stating plainly:

- Tools are annotated so a client can distinguish reads from writes. `write_deck` is marked destructive, because with `overwrite: true` it replaces a file wholesale.
- `write_deck` refuses to overwrite an existing deck unless explicitly told to.
- **Deck contents are untrusted input.** A deck is a file that an assistant may later read back, so treat it the way you would any other document you did not write. deck does not execute anything it reads.
