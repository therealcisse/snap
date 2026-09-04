---
title: "Email delivery approaches"
date: 2026-01-15
author: agent
id: example
---
# Email delivery approaches

## Motivation

The notification service needs outbound email for transactional messages (welcome, verification, password reset). This research surveys viable delivery approaches.

## Candidates

### Direct SMTP relay

Connect to an SMTP relay (e.g., the hosting provider's built-in relay or a self-hosted Postfix). Application sends raw SMTP.

**Pros:** No third-party dependency, full control over delivery pipeline.
**Cons:** Deliverability management (SPF, DKIM, DMARC, bounce handling) falls on the operator. Operational burden scales with volume.

### Transactional email API (e.g., SES, Mailgun, Postmark)

Send via a provider's HTTP API. Provider handles deliverability, bounce processing, and reputation.

**Pros:** High deliverability out of the box, built-in analytics and bounce webhooks, minimal operational overhead.
**Cons:** Introduces a third-party dependency. Pricing scales with volume.

### Message queue + worker

Application enqueues a delivery task. A background worker dequeues and sends via SMTP or API. Retries and dead-letter handling are built into the queue.

**Pros:** Decouples send latency from request path. Natural retry and backoff. Works with either SMTP or API as the transport.
**Cons:** Additional infrastructure (queue). More moving parts.

## Conclusion

A pluggable transport behind a thin trait is the right starting point. A direct API implementation covers initial needs. The queue can be introduced later without changing call sites.

## References

- RFC 5321 (SMTP)
- AWS SES documentation
- Mailgun API reference
