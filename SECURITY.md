# Security Policy

## Supported versions

`minimal-harness` is pre-1.0. Security fixes are applied to the latest `0.x`
release and the `main` branch.

| Version | Supported |
| ------- | --------- |
| `0.1.x` | ✅        |
| `< 0.1` | ❌        |

## Reporting a vulnerability

**Please do not open a public issue for security reports.**

Use GitHub's private vulnerability reporting:
[**Report a vulnerability**](https://github.com/mick-gsk/minimal-harness/security/advisories/new).
This opens a confidential advisory visible only to you and the maintainer.

Please include, where possible:

- affected version or commit,
- a minimal reproduction,
- the impact you observed, and
- any suggested remediation.

You can expect an initial response within a few days. Once a fix is available,
we will coordinate a disclosure timeline with you and credit you in the release
notes unless you prefer to remain anonymous.

## Scope notes

- The library ships with **zero runtime dependencies**, so the dependency attack
  surface is limited to Node.js built-ins and your own tools.
- The Agent Server deliberately delegates **TLS termination and rate limiting to
  your reverse proxy**; do not expose it directly to the public internet.
- Tools you register run with the privileges of the host process. Treat tool
  inputs from a model as untrusted and validate them (the harness validates tool
  arguments against your JSON schema before dispatch).
