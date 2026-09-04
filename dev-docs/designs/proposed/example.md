---
title: "Email delivery abstraction"
date: 2026-01-20
author: agent
id: example
---
# Email delivery abstraction

## Related Plan

This design supports plan id `example`, the next planned step for issue id `example`.

## Overview

The notification module needs a transport-agnostic email delivery interface. The initial implementation targets a transactional email API, but the abstraction must not leak provider-specific concerns into call sites.

## Design

A trait `EmailTransport` defines the delivery contract:

```
trait EmailTransport[F[_]]:
  def send(message: EmailMessage): F[Either[DeliveryError, Unit]]
```

A single concrete implementation, `ApiEmailTransport`, wraps the provider's HTTP API. Call sites depend on `EmailTransport[F]`, injected at startup. No call site references the provider directly.

## Error Handling

`DeliveryError` covers: connection failure, timeout, non-2xx API response (with status code and body), and rate limit exceeded. Each variant maps to a structured error that the notification module can log or surface.

## Alternatives Considered

- **Direct provider SDK everywhere:** Rejected. Hard-codes the provider into every call site. Switching providers requires touching all callers.
- **SMTP-first with API later:** Rejected. SMTP requires more operational setup (DKIM, SPF) for less benefit. Starting with the API is simpler.

## Open Questions

- Should `EmailTransport` support batch send, or is one-at-a-time sufficient for v1?
- Retry policy: should it live in the transport or in the caller?
