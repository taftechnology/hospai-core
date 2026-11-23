# Internal operations tooling for a multi-tenant hotel PMS ("control plane")

Researched 2026-11-22. Scope: the staff-side tooling a multi-tenant B2B SaaS, and a hotel PMS vendor in particular, uses to see, support and operate all customers. The bias is towards practices that fit a small team on Cloudflare Workers and Durable Objects. Vendor evidence is thin where vendors publish little. Gaps are stated, not filled.

## 1. Internal admin / back-office console: what it shows, what it can do, how access is controlled

### Takeaway
The public guidance (AWS SaaS Lens, Microsoft multitenant guidance) frames the staff console as a tenant-aware operations view: health, activity and consumption by tenant and by tier, plus onboarding and lifecycle actions. No PMS vendor publishes the contents of its internal console. The access-control pattern is consistent across the evidence: no standing access, scoped and time-boxed elevation, reason codes, and dual-identity audit records.

### Cited Findings
- AWS SaaS Lens: SaaS providers "need to be able to view system activity and health through the lens of individual tenants and tenant tiers", to diagnose trends and patterns of activity and consumption per tenant — [AWS SaaS Lens, Tenant-Aware Operations](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/tenant-aware-operations.html)
- SaaS Lens OPS 1: an operations dashboard should show health through the lens of tenants and tenant tiers, so operations can respond to issues "that might not be entirely apparent to a tenant". Tools should aggregate logs so the team can inspect the health and activity of the system, of individual tenants and of tiers. QuickSight or third-party BI is suggested for tenant-aware dashboards — [AWS Well-Architected SaaS OPS 1](https://wa.aws.amazon.com/saas.question.OPS_1.en.html); [SaaS Lens Operate](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/operate.html)
- SaaS Lens REL 2 asks "How do you proactively detect and maintain tenant health?", which treats per-tenant health as a reliability concern, not only a customer-success one — [AWS Well-Architected SaaS REL 2](https://wa.aws.amazon.com/saas.question.REL_2.en.html)
- AWS APN describes operations teams onboarding tenants through a "SaaS admin portal". Each onboarding microservice emits tenant-aware logs and metrics during the flow — [AWS APN blog, tenant onboarding best practices](https://aws.amazon.com/blogs/apn/tenant-onboarding-best-practices-in-saas-with-the-aws-well-architected-saas-lens)
- AWS ISV guidance: use tenant cost-allocation tags to track spend by tenant. Per-tenant cost is a standard console field — [AWS ISV, 5 multi-tenant SaaS architecture best practices](https://aws.amazon.com/isv/resources/5-multi-tenant-saas-architecture/)
- The Microsoft multitenant checklist says to measure per-tenant consumption and correlate it with infrastructure cost — [Azure multitenant checklist](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/checklist)
- Internal-tool access practice (vendor and practitioner sources, not standards):
  - Opal: least privilege for internal admin tools, read-only by default, access requests capped at about 4 hours — [Opal blog](https://OPAL.DEV/blog-post/internal-admin-tools)
  - AppMaster: limit privileged actions to specific roles, mask sensitive fields, use short-lived sessions with reason codes — [AppMaster blog](https://appmaster.io/blog/secure-admin-impersonation-controls-audit-scope)
- GitHub's audit-log event catalog includes actions "performed manually by GitHub staff" (for example a Copilot seat cancelled by staff). Staff actions on a tenant show up in that tenant's own audit log — [GitHub Enterprise audit log events](https://docs.github.com/en/enterprise-server@3.14/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/audit-log-events-for-your-organization)
- Mews runs an early-access process in which staff enable a feature in a hotel's live environment after an eligibility check. This shows per-tenant feature toggling is a back-office action at a PMS vendor — [Mews Help Center](https://help.mews.com/s/article/How-to-enable-a-new-Mews-feature-in-the-live-environment)

### Inferences
- A minimal console for a small Workers/DO team, built from the AWS/Microsoft framing:
  - **Read side:** tenant list with plan or entitlements, lifecycle state (trial, active, suspended, cancelled, purge pending), per-property usage (rooms, reservations per day, API calls), last night-audit result and business date, recent error rate, outbox or queue backlog, users and roles, and config diff from defaults.
  - **Write side:** provision, suspend (kill-switch), change plan or entitlements, extend trial, re-run a failed job, and toggle per-tenant flags.
  - Every write goes through the same audited command path as customer writes, not direct SQL.
- Console writes should be commands with a `staff` actor type. Recording both the staff identity and the tenant affected in the tenant-visible audit log matches the GitHub pattern and the DPDP "visibility on the accessing" requirement (section 2).
- Just-in-time elevation (request, reason, approver, expiry) can be built cheaply in front of the console with Cloudflare Access plus a short-lived signed grant. No vendor product is needed at small scale.

### Gaps
- No PMS vendor (Mews, Cloudbeds, Apaleo, Stayntouch, Oracle) publicly describes its internal admin console's fields or actions.
- The search found no Stripe, Shopify, Slack or Atlassian engineering blog post specifically about the design of their internal admin consoles (2023–2026). The Stack Overflow 2020 post on impersonation tooling is the closest well-known engineering source, and it is older than the requested window.

## 2. Support access to customer data: impersonation versus consented, time-boxed access; customer-visible audit; GDPR, DPDP, PCI

### Takeaway
Mature vendors have moved from silent "log in as" to consent-gated, scoped, time-limited grants. These grants notify the customer, appear in the customer's own activity log and can be revoked at once (Atlassian, Microsoft Customer Lockbox, Shopify collaborator codes). India's DPDP Rules 2025 make access logging, one-year log retention and processor contract terms explicit legal minimums. PCI DSS 4.0 requires MFA on administrative access and 12 months of audit logs.

### Cited Findings
- **Atlassian (Statuspage):**
  - An admin must contact support before support can view or alter data, and contacting support counts as consent for 7 days unless the customer declines.
  - Support can create an Access Grant to a specific page that lasts 24 hours.
  - Each grant emails the requesting admin and the account owner and writes an Activity log entry.
  — [Atlassian Statuspage, customer data access grants](https://support.atlassian.com/statuspage/docs/customer-data-access-grants-information/)
- **Atlassian Cloud:**
  - The support form has a checkbox that grants data access for that ticket.
  - With Atlassian Guard "Support access restrictions", every data-access grant must also be approved by a Guard admin.
  - The customer can revoke access at any time and the engineer loses access immediately.
  - Support data access does not extend to Rovo (AI) conversation history.
  — [Atlassian Cloud support data access request FAQ](https://support.atlassian.com/atlassian-cloud/kb/atlassian-cloud-support-data-access-request-faq/)
- **Microsoft Customer Lockbox:**
  - Engineers have no standing access. They first request elevation through a just-in-time service, which may need internal approvers.
  - Access to customer content needs the customer's approval as the final step.
  - Unapproved requests expire after 4 days. Approved access lasts at most 4 hours, then is revoked automatically.
  - All access is logged and auditable.
  — [Microsoft Learn, Customer Lockbox for Azure](https://learn.microsoft.com/azure/security/fundamentals/customer-lockbox-overview); [Microsoft 365 service engineer access control](https://docs.microsoft.com/en-us/compliance/assurance/assurance-microsoft-365-service-engineer-access-control)
- **Shopify:**
  - Partner access to a merchant store requires the merchant to approve a collaborator request.
  - Since December 2023 a 4-digit collaborator request code is on by default. The merchant sets the collaborator's permissions exactly as for staff.
  - Only the owner or staff with "Manage collaborator requests" can approve.
  — [Shopify Help, collaborator accounts](https://help.shopify.com/en/manual/your-account/staff-accounts/collaborator-accounts); [Shopify dev changelog, collaborator request code required](https://shopify.dev/changelog/collaborator-request-code-now-required-to-initiate-request-for-store-access)
- **Okta:** logs every support impersonation event, and impersonation cannot happen without explicit approval from a customer Super Admin — [Okta support article](https://support.okta.com/help/s/article/read-only-impersonation-access-system-logs-audit-events)
- **Impersonation design (practitioner sources):**
  - Ory argues for permission-level delegated access, where agents keep their own identity, over identity-level impersonation. Its reasons are the 2020 Twitter admin-tool breach and the difficulty of proving in SOC 2 which staff touched which accounts — [Ory blog](https://www.ory.com/blog/identity-level-impersonation)
  - An impersonation token should carry both the target user (for authorization) and the real admin (for audit) — [OneUptime blog](https://oneuptime.com/blog/post/2026-01-30-impersonation-implementation/view); [Appwrite](https://appwrite.io/blog/post/announcing-user-impersonation)
  - WorkOS documents side effects of impersonation, such as actions that look as if the user did them — [WorkOS blog](https://workos.com/blog/user-impersonation-side-effects)
  - Stack Overflow argues that removing impersonation is the only control that stops every attack, including social engineering — [Stack Overflow blog, 2020](https://stackoverflow.blog/2020/07/24/the-perils-of-impersonation-tooling/)
- **India DPDP Rules 2025, Rule 6 (reasonable security safeguards):** the minimum safeguards, which also cover processing done by a Data Processor, include:
  - (a) encryption, obfuscation, masking or virtual tokens
  - (b) access control to computer resources
  - (c) "visibility on the accessing of such personal data, through appropriate logs, monitoring and review"
  - (d) continued processing, for example "by way of data-backups"
  - (e) retaining "such logs and personal data for a period of one year" unless another law requires otherwise
  - (f) a contract clause with the Data Processor on safeguards

  — [DPDP Rules 2025, Gazette text (dpdpa.com mirror)](https://dpdpa.com/DPDP_Rules_2025_English_only.pdf)
- **DPDP Rule 7 (breach intimation):** affected Data Principals are told "without delay". The Board gets an initial description without delay, then a detailed report "within seventy-two hours of becoming aware of the breach" (extendable by the Board on written request). The report covers causes, mitigation, findings about who caused the breach, and a report on the notices sent to individuals — [DPDP Rules 2025 Gazette text](https://dpdpa.com/DPDP_Rules_2025_English_only.pdf). The EY summary of 72 hours agrees with the Gazette — [EY](https://www.ey.com/en_in/insights/cybersecurity/transforming-data-privacy-digital-personal-data-protection-rules-2025).
- **DPDP Rule 8(3):** the fiduciary must retain personal data, traffic data and processing logs for at least one year from processing, including logs held by its processor. The Rule's own example is a cloud provider hosting customer records — [DPDP Rules 2025 Gazette text](https://dpdpa.com/DPDP_Rules_2025_English_only.pdf)
- **DPDP commencement:** Rules 1, 2 and 17–21 apply from publication. Rule 4 applies after one year. Rules 3, 5–16, 22 and 23 (including security safeguards and breach intimation) apply 18 months after publication — [DPDP Rules 2025 Gazette text](https://dpdpa.com/DPDP_Rules_2025_English_only.pdf). The rules were notified in mid-November 2025 — [PIB notice](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf).
- **PCI DSS v4.0.x:**
  - 8.4.1 requires MFA for non-console administrative access into the cardholder data environment (CDE).
  - 8.4.2 requires MFA for all access into the CDE, mandatory from 31 March 2025.
  - 10.5.1 requires 12 months of audit-log retention, with 3 months immediately available.
  — [BDO, PCI DSS 4.0 MFA](https://www.bdo.com/insights/digital/pci-dss-version-4-0-multi-factor-authentication); [ManageEngine PCI DSS mapping](https://download.manageengine.com/log-management/3-key-updates-in-pcidss.pdf). Some secondary sources mislabel 8.4.1 and 8.4.2 — [SecurityMetrics](https://www.securitymetrics.com/blog/a-guide-to-new-requirements-in-pci-dss-4-0-1). This was not verified against the PCI SSC primary text.
- Cloudbeds' public security page claims "PCI DSS level 1 & 2 certified", "IAM with least privilege", 24/7 monitoring and a "24/7/365 incident response team". It says nothing specific about employee access to customer data — [Cloudbeds Security](https://www.cloudbeds.com/security/)

### Inferences
- The defensible pattern for a small PMS combines Atlassian-style consent with Lockbox-style expiry:
  1. The hotel owner or admin grants "support access" from Settings, scoped to a property and to read-only or read-write, for N hours (24h default).
  2. Staff act under their own identity with a `support_grant_id`. There is no "become the user" session.
  3. Each grant and each staff action appears in the hotel's own audit log and emails the owner.
  4. The owner can revoke the grant at once.

  This satisfies DPDP Rule 6(c) and the GDPR processor role, and it keeps staff out of card data entirely.
- If card data stays tokenized at the PSP, PCI scope for support staff shrinks a great deal. MFA on staff console access (8.4.1) and 12-month audit retention are still cheap to meet.
- One-year retention of access logs (DPDP Rule 6(e) and 8(3)) is longer than Workers Logs' 7 days (section 4). The audit trail of staff access must live in durable storage (DO SQLite, R2 via Logpush, or the OrgDO audit log), not only in Workers Logs.

### Gaps
- No public documentation from Mews, Cloudbeds, Apaleo, Stayntouch or Oracle Hospitality on how their support staff access a hotel's data (impersonation versus consent grant), or whether hotels can see that access.
- The PCI DSS clause numbers were not verified against the PCI SSC primary document.
- How DPDP processor obligations are allocated contractually between a PMS (processor) and a hotel (fiduciary) was not researched. That belongs with legal or DPA research.

## 3. Customer health and product analytics

### Takeaway
Customer-success platforms (Gainsight, Vitally, ChurnZero, Planhat) combine product usage, support load, sentiment and relationship signals into a weighted per-account score. Product-analytics tools (PostHog, Mixpanel, Amplitude) supply company-level usage through "group" analytics. PostHog publishes its own internal health model (out of 10, refreshed daily). Weights are always vendor-chosen examples, not standards.

### Cited Findings
- Gainsight recommends a weighted mix of usage, support, sentiment and engagement. Its illustrative split is usage 40%, support 25%, sentiment 20% and executive engagement 15%. A scorecard holds "measures", one signal each. Group measures include Company, Sentiment, Support, Implementation and Product Usage Risk. Rules-based scoring example: red if a flagged support CTA is open — [Gainsight, customer health scores guide](https://www.gainsight.com/guides/customer-health-scores/); [Gainsight, balanced scorecard](https://www.gainsight.com/blog/creating-a-balanced-scorecard-in-gainsight/)
- Vitally is described as a no-code health-score engine that builds rules from metrics, traits, activities and events, pulling in usage, communication, subscription and support data. It leans more on product events than Gainsight does. These are vendor and comparison sources — [Vitally blog 2026](https://www.vitally.io/post/the-best-customer-health-tracking-software); [Rework comparison](https://resources.rework.com/tools/customer-success/vitally-vs-gainsight-vs-churnzero)
- PostHog group analytics adds a "company" group type so teams can calculate daily active companies, company churn rate and feature adoption by company. Setup calls `posthog.group()`. B2B mode needs the group analytics add-on — [PostHog docs, group analytics](https://posthog.com/docs/product-analytics/group-analytics); [PostHog B2B mode](https://posthog.com/docs/customer-analytics/b2b-mode.md)
- PostHog's internal model gives each paying or trialing account a health score out of 10, refreshed every 24 hours, weighted 0.40 product engagement, 0.25 stickiness and 0.35 customer relationship — [PostHog handbook, customer health tracking](https://posthog.com/handbook/customer-success/health-tracking)
- GitLab publishes its health-scoring methodology, which builds scores from use-case adoption based on product usage data — [GitLab handbook, health scoring](https://handbook.gitlab.com/handbook/customer-success/customer-health-scoring/); [GitLab use-case adoption](https://handbook.gitlab.com/handbook/customer-experience/product-usage-data/use-case-adoption/)
- Mixpanel suggests storing a company health score as a group property updated from activity data — [Mixpanel company analytics docs](https://mintlify.com/mixpanel/docs/quickstart/company-analytics)
- Cloudflare positions Workers Analytics Engine for per-tenant usage (request counts, latency, bytes by tenant ID). It can drive usage-based billing and help find high-load or high-error tenants — [Cloudflare, SaaS usage analytics](https://developers.cloudflare.com/use-cases/saas/usage-analytics/)

### Inferences
- For a PMS, the meaningful "usage" signals are operational, not clicks:
  - share of arrivals checked in through the system
  - night audit run on time
  - folios closed at zero
  - channel-manager sync errors
  - number of active desk users per property
  - support tickets per 100 rooms

  These come from the domain event or outbox stream, so a server-side health score avoids most browser-analytics privacy problems.
- Privacy limit, inferred from the DPDP and GDPR rules in section 2: product analytics should carry tenant and property ids and staff pseudonymous ids, never guest PII. This is consistent with the repo's existing rule that events carry `guest_ref` and not names.
- At small scale, a health score computed nightly into Analytics Engine or a D1/DO table and shown in the staff console is enough. A CS platform (Gainsight/Vitally/Planhat/ChurnZero) is worth paying for when there is a CS team.

### Gaps
- No public evidence on which CS or product-analytics tools Mews, Cloudbeds, Apaleo or Stayntouch use internally, or on their churn models.
- No primary-source documentation was gathered for ChurnZero, Planhat or Amplitude.
- No source was found on PMS-specific health metrics. The list above is inference.

## 4. Observability per tenant (with Cloudflare Workers / Durable Objects specifics)

### Takeaway
The standard is to tag every log, metric and trace with a tenant id, keep a per-tenant baseline, and alert on spikes and on "victim" tenants (noisy neighbour). On Cloudflare, the building blocks are:
- **Workers Logs:** structured JSON, auto-indexed fields, 7-day retention on Paid.
- **Workers Analytics Engine:** high-cardinality per-tenant metrics, 1 index per data point, 3-month retention.
- **Tail Workers:** custom processing of logs.
- **Logpush:** long-term archive.
- **OpenTelemetry export:** traces and logs to Grafana, Honeycomb, Datadog, Sentry, Axiom and others (Paid plan).

### Cited Findings
- Microsoft's Noisy Neighbor antipattern guidance:
  - Track resource consumption by tenant, understand the normal baseline, and alert on spikes.
  - Failures for a tenant that is not consuming much capacity can mark a "victim" tenant.
  - Mitigate with throttling or rate limiting.
  - The problem can arise from the collective load of many small tenants, not only one large one.
  — [Azure Architecture Center, Noisy Neighbor antipattern](https://learn.microsoft.com/en-us/azure/architecture/antipatterns/noisy-neighbor); [Azure multitenant storage guidance](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches/storage-data)
- New Relic recommends being able to facet all telemetry by tenant id to debug noisy-neighbour problems — [New Relic blog](https://newrelic.com/de/blog/apm/monitoring-multi-tenant-saas-applications)
- **Workers Logs:**
  - Retention is 3 days on Free and 7 days on Paid.
  - Paid includes 20 million log events per month, then +$0.60 per million. Workers Logs moves to "Cloudflare Observability pricing" from 1 December 2026.
  - The account limit is 5 billion logs per day; past that, a 1% head sample applies for the rest of the day. Maximum log size is 256 KB.
  - `head_sampling_rate` ranges from 0 to 1.
  - Fields from structured JSON logs are extracted and indexed automatically, so a key such as `tenant_id` can be filtered directly.
  - Invocation logs cover Fetch, Alarm, Queue, Cron, Tail, RPC and WebSocket handlers.

  — [Cloudflare docs, Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- **Workers Analytics Engine limits:**
  - Per data point: up to 20 blobs, up to 20 doubles and 1 index. The index must be 96 bytes or less, and all blobs together must not exceed 16 KB.
  - A Worker invocation can write up to 250 data points.
  - Data is kept for three months.

  — [Cloudflare docs, Analytics Engine limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/)
- **Tail Workers** can count errors by endpoint, track response times by customer and write the aggregates to Analytics Engine. Cloudflare notes that if you only need to forward logs to Sentry, Grafana or Honeycomb, Tail Workers may be unnecessary — [Cloudflare docs, Tail Workers](https://developers.cloudflare.com/workers/observability/logs/tail-workers/)
- **OpenTelemetry export:**
  - Destinations (Traces or Logs, with an OTLP endpoint) are created in the dashboard and referenced by name in the Wrangler `observability` block.
  - Documented providers include Honeycomb, Grafana Cloud, Axiom, Datadog, New Relic, Sentry and Splunk.
  - Per-signal head sampling is available. `persist = false` exports without keeping a copy in Cloudflare.
  - Exporting traces needs Workers Paid.

  — [Cloudflare docs, exporting OpenTelemetry data](https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data); [Grafana blog, Dec 2025](https://grafana.com/blog/2025/12/04/send-opentelemetry-traces-and-logs-from-cloudflare-workers-to-grafana-cloud/); [Cloudflare blog, Workers tracing open beta](https://blog.cloudflare.com/workers-tracing-now-in-open-beta/)
- **Logpush** streams logs to external destinations (a SIEM or data warehouse) for audit trails and compliance — [Cloudflare, SaaS usage analytics](https://developers.cloudflare.com/use-cases/saas/usage-analytics/)
- **Workers for Platforms:** Cloudflare advises scoping every Observability API query to the specific user Worker so one tenant cannot read another tenant's telemetry — [Cloudflare docs, Workers for Platforms observability](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/observability/)
- Cloudflare announced a unified Workers Observability view (logs, metrics and queries in one place) — [Cloudflare blog](https://blog.cloudflare.com/introducing-workers-observability-logs-metrics-and-queries-all-in-one-place)

### Inferences
- With one Durable Object per property, the DO id is the tenant key, so the "noisy neighbour" in compute terms is mostly isolated by design. The shared choke points remain: the router Worker, OrgDO, queues, KV and third-party APIs (channel manager, PSP).
- Per-tenant SLOs are cheap to build. Write one Analytics Engine data point per request:
  - index = propertyId
  - blobs = routeId, status class, commandId
  - doubles = latency, CPU

  Query it with SQL for per-property error rate and p95. Treat the index-as-sampling-key behaviour as something to verify in the docs; it was not confirmed in this research.
- Retention mismatch:
  - Workers Logs keeps 7 days and Analytics Engine about 3 months.
  - Incident review and the DPDP/PCI needs (1 year and 12 months) need Logpush to R2, or OTLP export to a vendor with longer retention.
- The Cloudflare outage on 2025-12-05, which Mews itself suffered (section 5), shows the external monitor and status page should not run solely on the same provider.

### Gaps
- Pricing for Analytics Engine and Tail Workers, and the new "Cloudflare Observability pricing" from 1 Dec 2026, were not retrieved.
- Durable Object-specific observability (per-DO storage size, alarm failures, eviction metrics) was not researched in depth.
- The beta or GA status of OTel export as of Nov 2026 was not confirmed.

## 5. Uptime SLAs, status pages, service credits, post-mortems, on-call (PMS vendors)

### Takeaway
PMS SLAs cluster at 99.9%. Mews measures monthly against status.mews.com; Stayntouch measures quarterly with a tiered credit table. Credits are small, on-request and the "sole remedy". Mews publishes incident root causes on its Statuspage-style page, and recent root causes include a WAF misconfiguration, an expired certificate and upstream Cloudflare and Azure incidents. Cloudbeds publishes only a marketing ">99.99% uptime" claim. Apaleo runs status.apaleo.com, seen here only through aggregators.

### Cited Findings
- **Mews SLA v1.5 (effective 20 March 2024):**
  - "Guarantees 99.9% monthly uptime", calculated as 1 − downtime minutes ÷ total monthly minutes, and visible on status.mews.com. Downtime may affect some properties and not others.
  - Mews says it has never needed scheduled downtime because of zero-downtime updates. If needed, it gives at least 48 hours' notice, and scheduled downtime is excluded.
  - Credit = (99.9 − actual uptime) × 5% of the Monthly Fee, capped at 100%, claimed through the Account Manager by the 15th of the following month. Credits are the "sole and exclusive remedy".
  - Exclusions: slowness in reports, search or background jobs; third-party or channel-manager downtime; ISP problems; Kiosk, Connector and native apps.
  - Support response/resolution:

    | Priority | Standard | Premium |
    |---|---|---|
    | Critical | 4h / 6h | 2h / 6h |
    | High | 8h | 4h |
    | General | 24h | 12h |

    HelpDesk runs 24/7, in English only.

  — [Mews SLA v1.5](https://www.mews.com/en/service-level-agreement)
- Mews' 2019 SLA used a 99.8% target and a Spanish page still shows 99.8%. The 2024 English and German versions say 99.9% — [Mews SLA May 2019](https://www.mews.com/en/legal/service-level-agreement-may-2019); [Mews SLA v1.4 July 2022](https://www.mews.com/en/legal/service-level-agreement-july-2022)
- **Stayntouch SLA:**
  - 99.90% availability, measured quarterly: A = (T − M − D)/(T − M), where M is maintenance time.
  - The SLA applies after a stabilization period or 90 days from provisioning.
  - Planned downtime gets at least 48 hours' notice, preventive maintenance runs in low-peak hours, and emergency maintenance may happen without notice.
  - Credits per affected hotel: 1% (99.5–99.9%), 2% (99.0–99.5%), 5% (<99.0%), with a header that appears to cap credits at $100 per month per property. Claims need a ticket within 24 hours and a written claim within 5 business days.
  - Support response:

    | Priority | Example | Response | Coverage |
    |---|---|---|---|
    | P1 Critical | Platform down, check-in/out or booking impossible | 1h | 24x7 |
    | P2 High | Some functions not working | 4h | Mon–Fri 8am–8pm local |
    | P3 Low | Questions, enhancement requests | 24h | Mon–Fri 8am–8pm local |

    The target counts as met if 90% of cases are answered in time.

  — [Stayntouch Service Level Agreement](https://www.stayntouch.com/service)
- **Oracle:**
  - Oracle's general SaaS policy gives credits of 2% of monthly fees for every 0.1% below target, starting with the second month the target is missed in a 6-month period.
  - Some Oracle SaaS services state RTO 12h / RPO 1h, and others RTO 30 min / RPO 15 min.
  - The OPERA-specific figures sit in "Oracle Hospitality Hotel Cloud Service Descriptions" (last updated 16 July 2026), which returned HTTP 403 to fetch.

  — [Oracle SaaS Public Cloud Services Pillar](https://oracle.com/assets/saas-public-cloud-services-pillar-3610529.pdf); [Oracle GBU Cloud Services Pillar](https://oracle.com/contracts/docs/gbu_cloud_services_pillar_0618_4492732.pdf); [Oracle Hospitality Hotel Cloud Service Descriptions](https://www.oracle.com/contracts/docs/hosp_retail_cloud_service_2511377.pdf)
- **Cloudbeds:** the security page claims "Industry-leading > 99.99% uptime" with no measurement period or SLA terms, and says Cloudbeds runs on AWS. No Cloudbeds status page was found in search — [Cloudbeds Security](https://www.cloudbeds.com/security/); [Cloudbeds IT Managers](https://www.cloudbeds.com/it-managers/)
- **Apaleo:** aggregators list the official page as status.apaleo.com, with 7 monitored components. Recent incidents:
  - "Intermittent Latency Spikes and Request Timeouts" on 2026-11-06
  - "DB infrastructure upgrade", 1h 31m, on 2026-09-15
  - 5 incidents in 90 days; aggregators disagree on whether one was major

  — [OpenStatus](https://www.openstatus.dev/status/apaleo.md); [IsDown](https://isdown.app/status/apaleo); [Pulsetic](https://pulsetic.com/status/apaleo/); [StatusGator](https://statusgator.com/services/apaleo)
- **Mews public post-mortems on status.mews.com:**

  | Date | Root cause |
  |---|---|
  | 30 Oct 2024 | Misconfigured WAF ruleset made app.mews.com unreachable for all users for about 4 min, then about 15 min degraded |
  | 27 May 2025 | Third-party provider interruption |
  | 25 Sep 2025 | Expired certificate in an internal service |
  | 5 Dec 2025 | Widespread Cloudflare outage |
  | 31 Dec 2025 – 3 Jan 2026 | Azure-related slowness; Mews said the root cause was not fully addressed and could recur |
  | Feb 2026 | 47-min outage; web service instances that stopped functioning overnight |
  | 17 Nov 2024 | Database replication issue |

  Incident titles are phrased in hotel terms ("Properties may be unable to check in guests") — [status.mews.com incident list](https://status.mews.com); [Unplanned Outage – Cloudflare issues](https://status.mews.com/incidents/hd85j348htjm); [Mews down due to database replication issues](https://status.mews.com/incidents/nxjq8sjgcz2k); [Properties may be unable to check in guests](https://status.mews.com/incidents/7d49ng5c70gd); [Slower performance and errors](https://status.mews.com/incidents/y44zxg0dps1m)
- Hotel-tech status pages in October and November 2025 show shared-infrastructure blast radius:
  - Beds24: AWS DNS outage of 20 Oct 2025
  - Hospitable: AWS (21 Oct 2025) and Cloudflare (18 Nov 2025)

  — [Beds24 forum](https://forum.beds24.com/viewtopic.php?p=6791); [Hospitable status](https://status.hospitable.com/incidents/2025-09/2025-11)

### Inferences
- A defensible SLA for a small PMS is 99.9% monthly, with scheduled downtime excluded and announced 48 hours ahead. Credits should be on request, capped, and the sole remedy. Response times should be tiered, with a 24/7 P1 for "cannot check in, check out or book". Mews and Stayntouch converge on this.
- Status-page component design should follow how hotels experience failure: Desk (check-in/out), Reservations/booking engine, Channel manager sync, Payments, Night audit, Reports, API/webhooks.
- Mews' own outages show that a status page on the same edge provider is fragile. Host the status page on a separate provider, such as a hosted Statuspage or Instatus, or a page served outside the main Cloudflare account.

### Gaps
- No public Cloudbeds SLA or status page was found. Apaleo's SLA percentage and credits were not found.
- OPERA Cloud's specific availability target, RTO/RPO and maintenance windows are in a PDF that returned 403. Use the contract or the service description PDF.
- No PMS vendor's on-call structure (rotations, tooling such as PagerDuty or Opsgenie) was found publicly.

## 6. Release management: per-tenant flags, staged rollouts, early access, release notes, maintenance windows

### Takeaway
PMS vendors ship continuously, with zero-downtime deploys (Mews claims it has never needed scheduled downtime). They use per-hotel early access that staff enable after a demo-environment trial, plus a public release-notes site with "Coming soon" posts. On Cloudflare, Workers versions and gradual deployments give percentage traffic splits with version affinity and one-command rollback across the 100 most recent versions. Because hotels run 24/7 and night audit falls around local midnight, rollouts should be timed per property timezone and away from the audit window.

### Cited Findings
- **Mews early access:** the hotel tests the feature in the demo environment, then requests early access through the CSM or a support ticket. Mews checks eligibility, enables the feature in the live environment and shares early-access documentation. After public release, the feature stays on as live configuration — [Mews Help Center](https://help.mews.com/s/article/How-to-enable-a-new-Mews-feature-in-the-live-environment)
- **Mews release notes:**
  - releases.mews.com posts carry tags such as "Coming Soon" and "new feature".
  - Separate developer changelogs exist for the booking engine and channel-manager APIs.
  - A community thread says the notes are mostly user-facing, technical and API changes are sometimes missing, and an "Upcoming" section was removed.

  — [Mews release notes](https://releases.mews.com/en/welcome-to-the-future-of-mews-release-notes); [Mews community, keeping up with updates](https://community.mews.com/community-library-94/keeping-up-with-mews-updates-221); [Mews Q3 2025 releases overview](https://community.mews.com/mews-updates-38/releases-overview-q3-2025-2618); [Mews booking engine changelog](https://docs.mews.com/booking-engine-guide/changelog)
- Mews SLA: zero-downtime updates, no scheduled downtime so far, and 48h notice if ever needed — [Mews SLA v1.5](https://www.mews.com/en/service-level-agreement). Stayntouch: preventive maintenance "during low-peak hours", 48h notice — [Stayntouch SLA](https://www.stayntouch.com/service)
- **Cloudflare Workers gradual deployments:**
  - A deployment can split traffic between two versions, for example `wrangler versions deploy <a>@70 <b>@30`. The usual start is the new version at 0% and the old one at 100%.
  - Version affinity pins users to one version during the rollout.
  - Rollback sets a single version to 100% from the dashboard or with `wrangler rollback`. Since September 2025 the rollback limit is 100 recent versions, up from 10.

  — [Cloudflare docs, gradual deployments](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/); [version affinity](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/version-affinity/); [rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/); [changelog 2025-09-11](https://developers.cloudflare.com/changelog/2025-09-11-increased-version-rollback-limit)
- Cloudflare's changelog lists "release flows" with Workers metrics (2026-09-25) and version overrides, which pin specific requests to a version for testing — [Cloudflare changelog 2026-09-25](https://developers.cloudflare.com/changelog/post/2026-09-25-release-flows-workers-metrics/); [version overrides](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/index.md)

### Inferences
- Gradual deployments split by request, not by tenant. Version affinity keeps a user on one version, but there is no built-in "canary these 3 hotels". Per-tenant staging therefore needs one of two approaches:
  - application-level flags (an entitlement or config key read inside the DO), or
  - a version-override header set by the router for canary properties.

  Durable Objects run the code version of the Worker that instantiated them, so DO schema migrations must stay backward-compatible across a split rollout. This needs verification against DO docs; it was not researched here.
- Night audit near local midnight, and hotels being 24/7, mean the only "quiet" window is per timezone. A global deploy is never quiet for every property, so the defence is small, reversible, flag-gated changes rather than maintenance windows. This matches Mews' zero-downtime claim.
- Release notes to hotels: one public changelog with "Coming soon / New / Improved" tags, plus an API changelog for integrators. That is the Mews shape and the cheapest one.

### Gaps
- No public evidence on whether Mews, Cloudbeds, Apaleo or Stayntouch use a feature-flag service (LaunchDarkly, Unleash, Flagsmith) or ring-based or canary rollouts.
- Cloudflare's own feature-flag product, if any exists by Nov 2026, was not researched.
- No source was found on PMS vendors avoiding deploys around night audit. That point is inference.

## 7. Backups, disaster recovery, RPO/RTO for hotel data

### Takeaway
PMS vendors rarely publish RPO/RTO. None of the Mews SLA, the Stayntouch SLA or the Cloudbeds security page states them. Oracle publishes figures per SaaS service (for example RTO 12h / RPO 1h, or RTO 30 min / RPO 15 min) but the OPERA figures were not retrievable. On Cloudflare, SQLite-backed Durable Objects offer 30-day point-in-time recovery through bookmarks, and D1 Time Travel gives 30 days on Paid. That is the platform-level basis for an RPO commitment. India's DPDP Rule 6(d) names data backups as a minimum safeguard.

### Cited Findings
- **Durable Objects (SQLite-backed):**
  - PITR restores the embedded SQLite database to any point in the past 30 days.
  - `ctx.storage.getCurrentBookmark()` and `getBookmarkForTime(ts)` return bookmarks. `onNextSessionRestoreBookmark(bookmark)` followed by a restart (for example `ctx.abort()`) performs the restore.
  - The call returns a bookmark for the moment just before recovery, so a recovery can be undone.
  - Only SQLite-backed classes have this.

  — [Cloudflare docs, SQLite-backed Durable Object Storage](https://developers.cloudflare.com/durable-objects/api/transactional-storage-api); [Access Durable Objects storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/); [SQLite in DOs GA, 2025-04-07](https://developers.cloudflare.com/changelog/2025-04-07-sqlite-in-durable-objects-ga)
- D1 Time Travel uses similar bookmarks: 30 days on Workers Paid, 7 days on Free — [Cloudflare D1 Time Travel](https://docs-durable-objects-instance-replaced-errors.previews.developers.cloudflare.com/d1/reference/time-travel/index.md). This is a preview mirror; confirm on the main docs site.
- Cloudflare is restricting new KV-backed Durable Object namespaces (2026-07-09 changelog), so SQLite-backed storage with PITR is the default path — [Cloudflare changelog](https://developers.cloudflare.com/changelog/post/2026-07-09-restrict-new-kv-backed-namespaces/)
- **Oracle SaaS:** RTO and RPO are stated per service (examples above). Where none is stated, Oracle recovers "from the most recent available backup made prior to the onset of the disaster" — [Oracle SaaS Public Cloud Services Pillar](https://oracle.com/assets/saas-public-cloud-services-pillar-3610529.pdf)
- OPERA Cloud hosting has redundant internet circuits and data centres able to provide "full geographic failover if required". No time objective is given — [Oracle OPERA Cloud network/architecture docs](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.2/ocsnc/network.pdf)
- Neither the Mews SLA v1.5 nor the Stayntouch SLA states backup, RPO or RTO terms — [Mews SLA](https://www.mews.com/en/service-level-agreement); [Stayntouch SLA](https://www.stayntouch.com/service). The Cloudbeds security page does not either — [Cloudbeds Security](https://www.cloudbeds.com/security/)
- DPDP Rule 6(d) requires "reasonable measures for continued processing … such as by way of data-backups". Rule 6(e) and 8(3) require keeping logs and personal data for one year — [DPDP Rules 2025 Gazette text](https://dpdpa.com/DPDP_Rules_2025_English_only.pdf)

### Inferences
- DO PITR protects against logical corruption (a bad migration, a bad bulk command) within 30 days, per object. It is not an off-platform backup. Region or provider loss, account compromise, and the one-year DPDP retention need periodic exports, for example nightly per-property SQL dumps or event logs to R2, ideally in a separate account or with object lock.
- A defensible public commitment for a small Workers/DO PMS:
  - RPO ≤ 1 hour for logical restore, which is effectively near-zero through PITR.
  - RTO of a few hours for a single property restore, and a stated longer RTO for platform-wide loss.
  - Restores tested quarterly per a runbook.

  These are design suggestions, not observed vendor figures.
- Purge and erasure interact with backups. Any off-platform export must be covered by the existing purge and crypto-shredding design (per-org keys), so erased guests do not reappear from backups.

### Gaps
- No published RPO/RTO for Mews, Cloudbeds, Apaleo, Stayntouch or OPERA Cloud specifically. The Oracle hotel service description PDF returned 403.
- Durable Objects PITR plan limits, cost and multi-region replication behaviour were not confirmed in this research.
- No source on how PMS vendors handle "offline mode" or desk continuity during an outage (printed arrivals lists, local cache) was gathered. Searching for it is worthwhile.
