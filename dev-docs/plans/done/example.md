---
title: "Implement email delivery layer"
date: 2026-01-22
completed: 2026-01-28
author: agent
id: example
issue: example
research:
  - example
designs:
  - example
realized_design: example
---
# Implement email delivery layer

## Originating Issue

No outbound email delivery, issue id `example`.

## Research Consulted

- Research id `example`: surveyed email delivery approaches; concluded a pluggable transport behind a thin trait is the right starting point.

## Design Referenced

- Design id `example`: email delivery abstraction.

## Developer Feedback

Consulted on two open questions from the design doc:

- **Batch vs single send:** Defer batch to v2. Single-message send is sufficient for transactional volume.
- **Retry policy placement:** Retry belongs in the transport implementation, not the caller.

## Approach

Introduce an `EmailTransport` trait in the notification module. Implement `ApiEmailTransport` wrapping the provider's HTTP API. Wire `EmailTransport[F]` injection at startup. Add structured logging at the transport boundary so delivery failures are never silent.

## Tasks

- [x] Define `EmailTransport[F]` trait and `DeliveryError` ADT
- [x] Implement `ApiEmailTransport` wrapping the provider API
- [x] Define `EmailMessage` domain type with sender, recipient, subject, body
- [x] Wire `EmailTransport[F]` injection at startup
- [x] Add structured logging at the transport boundary
- [x] Update notification module to call `EmailTransport.send` instead of logging only

## Acceptance Tests

- [x] A verification email is accepted by the provider API and a message-id is logged
- [x] A failed delivery produces a structured `DeliveryError` log entry
- [x] No call site outside the transport module references the provider SDK directly

## Deviations

None. Implementation matched the approved plan exactly.
