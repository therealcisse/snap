---
title: "Implement email delivery layer"
date: 2026-01-22
author: agent
id: example
issue: example
research:
  - example
designs:
  - example
---
# Implement email delivery layer

## Originating Issue

No outbound email delivery, issue id `example`.

## Research Consulted

- Research id `example`: surveyed email delivery approaches; concluded a pluggable transport behind a thin trait is the right starting point.

## Design Referenced

- Design id `example`: email delivery abstraction. **Note:** this design is pending human approval.

## Developer Feedback

Consulted on two open questions from the design doc:

- **Batch vs single send:** Defer batch to v2. Single-message send is sufficient for transactional volume.
- **Retry policy placement:** Retry belongs in the transport implementation, not the caller.

## Approach

This is the next plan for issue `example` and is expected to be sufficient for the whole issue. If implementation exposes more work, a later plan should be written after this step is implemented and designed.

Introduce an `EmailTransport` trait in the notification module. Implement `ApiEmailTransport` wrapping the provider's HTTP API. Wire `EmailTransport[F]` injection at startup. Add structured logging at the transport boundary so delivery failures are never silent.

## Tasks

- [ ] Define `EmailTransport[F]` trait and `DeliveryError` ADT
- [ ] Implement `ApiEmailTransport` wrapping the provider API
- [ ] Define `EmailMessage` domain type with sender, recipient, subject, body
- [ ] Wire `EmailTransport[F]` injection at startup
- [ ] Add structured logging at the transport boundary
- [ ] Update notification module to call `EmailTransport.send` instead of logging only

## Acceptance Tests

- A verification email is accepted by the provider API and a message-id is logged
- A failed delivery produces a structured `DeliveryError` log entry
- No call site outside the transport module references the provider SDK directly
