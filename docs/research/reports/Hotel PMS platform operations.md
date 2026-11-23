# Build the missing operations plane first

HospAI's tenant core is already as good as what the leading cloud PMS vendors publish, and in places better: structural isolation per hotel, a working entitlement plane, crypto-shredding with purge certificates, and honest residency rules. What it lacks is the layer every vendor uses to *run* its customers. There is no operator console, no metrics or paging, no support-access path, no billing, no tested restore, no repeatable data import, and no runtime way for one deployed web app to serve more than one hotel. None of this blocks the India pilot if it is handled as runbooks and configuration. The short list before the first paying hotel is: a production deploy, alerting on the signals ARCHITECTURE.md already names, log retention that meets India's CERT-In rules, one restore drill, a written provisioning and kill-switch procedure, a consent-based way for support to see the hotel's data, a processor agreement and breach runbook, a decision on the BluePMS import, and a check on the foreign-guest form. Before ten hotels, the product itself has to change: runtime tenant selection in the SPA, a read-only operator console with audited plan changes and per-tenant suspend, per-property metrics, GST-correct billing, the importer, and an exit export. Before selling to groups, HospAI needs a portfolio layer above the org, SSO/SCIM, consolidated reporting from the warehouse, SOC 2 Type 2 or ISO 27001, documented hosting per region, and a public API with a deprecation policy. One compliance finding needs follow-up now: India appears to have replaced "Form C" with "Form III" under a 2025 Act, which may affect the Form C tracker HospAI has just shipped.

## One legal finding needs checking before go-live: Form C may now be Form III

The compliance research reports that India's **Immigration and Foreigners Act 2025 came into force on 1 September 2025**. Its Rules 2025 (Rule 17) require accommodation providers to submit **Form III (formerly Form C)** electronically within **24 hours of arrival**, and to report **departure details within 24 hours**. The Rules were reportedly amended on 1 June 2026 ([Sentinel Assam](https://www.sentinelassam.com/topheadlines/new-immigration-rules-ease-timelines-for-foreigners-mandate-24-hour-reporting-and-online-appeals); [Immigration and Foreigners Rules 2025 PDF](https://www.thc.nic.in/Central%20Governmental%20Rules/Immigration%20and%20Foreigners%20Rules,%202025..pdf); [Eastern Mirror](https://www.easternmirrornagaland.com/immigration-act-2025-dimapur-police-direct-24-hour-reporting-of-foreigners-by-hotels-hospitals); [GKToday](https://www.gktoday.in/government-revises-immigration-and-foreigners-rules-2025/)).

**Evidence level: moderate.** The sources are one copy of the Rules text, hosted on a government `nic.in` website, plus three secondary news outlets. They have not been checked against the Gazette of India or the Bureau of Immigration filing portal. The research did not find the Rules' retention period for these records.

HospAI's shipped tracker is specified as "Form C" throughout. That covers its UI copy, its commands and the night-audit check id `form_c_overdue`. The spec cites the 24-hour arrival duty but names no legal instrument. It puts "departure updates beyond what the portal requires" out of scope ([Form C tracker spec](../../../docs/superpowers/specs/2026-11-22-form-c-tracker-design.md); [AGENTS.md pins](../../../AGENTS.md)). A repo search finds no mention of "Form III" or the 2025 Act.

If the research is right, two things change, and one does not. The 24-hour arrival deadline (D5 in the spec) still holds. The **departure report is a separate legal duty**, and the tracker does not cover it. The **operator-facing name** is out of date. The fields Form III asks for may also differ from Form C's.

The spec already says an advisor confirms the duty and the retention period at go-live, so that is where this belongs. AGENTS.md forbids renaming command and route ids, so a fix would change operator copy ("Form III, formerly Form C") and leave the ids alone. The departure duty would go through the normal spec process.

The Rules also strengthen a design point. A delinquent or suspended hotel must still be able to meet this duty. That matches the `gateExempt: 'legal_duty'` pattern the repo already uses for queue consumers ([AGENTS.md §3](../../../AGENTS.md)).

## HospAI's tenant core is ahead; its operating layer is mostly absent

Comparing HospAI's code with what vendors publish gives a clear split. The data model and compliance design are at or above the market. The tooling for running the business is mostly missing.

| Area | What the market does | HospAI today | Verdict |
|---|---|---|---|
| Tenant model | A group container over independent properties: Cloudbeds Organization, Mews portfolio and chain, OPERA chain and hub | Org → Property, one Durable Object per tenant, Platform D1 registry ([ARCHITECTURE.md §2](../../../ARCHITECTURE.md)) | Ahead on isolation |
| Groups | One login, a property switcher and per-property roles as standard. SSO/SCIM, central rates and BI cost extra | Per-property roles exist. No group scope. The SPA is bound to one property at build time ([tenant.ts](../../../apps/web-pms/src/config/tenant.ts)) | Behind |
| Onboarding | Sales-led sale, guided setup, an audit before go-live, then hypercare | API bootstrap and provisioning. No runbook. Demo seed works locally only ([provision.ts](../../../apps/pms-core/src/provision.ts)) | Gap |
| Migration | Imports of future reservations and profiles, a test import, then a delta import | R4.8 deferred. This conflicts with the go-live list ([roadmap](../../../docs/roadmap.md)) | Must resolve |
| Billing | Price per room-month with a floor per property, add-ons, payments margin | Catalog and entitlements built. No billing. `base_price` seeded 0 ([0002_entitlements.sql](../../../migrations/d1-platform/0002_entitlements.sql)) | Ready to wire |
| Console and support access | No standing access, time-boxed grants the customer consents to | Designed in §4.9, not built ([ARCHITECTURE.md §4.9](../../../ARCHITECTURE.md)) | Gap |
| Observability | Every signal tagged by tenant, per-tenant metrics, paging | Logs carry tenant tags. No metrics, alerts or retention config ([observability spec](../../../docs/superpowers/specs/2026-07-28-observability-design.md)) | Largest gap |
| SLA and status | 99.9% monthly uptime, public status page, tiered response times | None found | Gap |
| Releases | Continuous zero-downtime deploys, per-hotel early access | CI gates and a manual staging deploy. No production workflow, no flags ([staging-deploy.yml](../../../.github/workflows/staging-deploy.yml)) | Gap |
| Backups | Platform point-in-time recovery. Recovery targets rarely published | Platform PITR only. No restore runbook ([ARCHITECTURE.md §12](../../../ARCHITECTURE.md)) | Gap |
| Partner API | REST/OAuth, sandbox, certification, deprecation policy | First-party `/v1` only. Public API is planned for R5.3 | Not needed yet |
| Compliance | Data processing agreement (DPA), PCI scope kept small through the PSP, SOC 2/ISO for groups | Crypto-shredding, purge certificates, legal-retention exemptions ([purge-workflow.ts](../../../apps/pms-core/src/purge-workflow.ts)) | Ahead in design. Contracts and paperwork not reviewed |

The pattern matters for sequencing. HospAI's risk is not that it lacks features. A small team will end up running real hotels from `wrangler` and raw D1 SQL, with no record of who changed a plan or why, and no alert when a night audit halts at 2 a.m. The rest of this report takes each area in turn and ends with the ordered gap list.

## Groups buy a portfolio layer HospAI has not designed yet

Every vendor treats a group as a container of properties that otherwise stay independent. Cloudbeds turns grouped properties into an "Organization" that only Cloudbeds Support can create. One user there "can have the same or different roles in each property" ([Cloudbeds Organizations](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/1260803386269-Organizations-Everything-you-need-to-know); [Cloudbeds Organizations FAQ](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/4403591508123-Organizations-FAQ)).

Mews makes the sharpest distinction. A **portfolio** is the scope for central management. A **chain** "define[s] legal relationships between enterprises and [is] used for sharing certain data such as customer profiles". A portfolio access token reaches every property in scope ([Mews Connector API: Multi-property](https://docs.mews.com/connector-api/concepts/multi-property)). That split lets a management company run hotels for different owners without pooling their guests.

HospAI's guest profiles are org-wide in OrgDO, so today **the org is both the billing boundary and the data-sharing boundary**. Nothing sits above it ([ARCHITECTURE.md §2, §4.3](../../../ARCHITECTURE.md)). The architecture mentions a "property-group" role scope and a GroupAvailabilityDO. Neither exists in contracts, pms-core or migrations ([permissions.ts](../../../packages/contracts/src/permissions.ts)). (Inference) A management company with three owners would have to choose: one org, which pools billing and guest data, or three unlinked orgs, which give no portfolio view. The groups design should start from the Mews split: a management tier above orgs, with guest data still bounded by the legal entity.

The market splits clearly into what everyone has and what costs extra. Every vendor offers one login, a property switcher and per-property roles. HospAI already has per-property roles (`property_member`) and an org property list. The missing piece is the R4.4 switcher. Worse, the SPA reads `VITE_ORG_ID` and `VITE_PROPERTY_ID` at **build time** ([tenant.ts](../../../apps/web-pms/src/config/tenant.ts)). (Inference) That means a separate build per property. It is a problem for ten independent hotels, not only for groups, and it comes back in the gap list.

The paid tier at Mews (the Portfolio plan) bundles several things into one package ([Mews Portfolio plan](https://help.mews.com/s/article/Understanding-the-Portfolio-pricing-plan)):

- SSO and SCIM
- central rate groups
- cross-property dashboards
- a multi-property booking engine

OPERA has the most explicit template model. Configuration copied from a hub is "distributed and upserted" into linked properties ([OPERA Cloud: copying configuration](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.2/ocsuh/t_copying_configurations_to_multiple_properties.htm); [Oracle Enterprise Management](https://docs.oracle.com/en/industries/hospitality/enterprise-management/ecmug/ch_getting_started.htm)).

HospAI's Group plan already reserves `pms.multi_property` and `sso.saml` for groups of 3–10 properties ([ARCHITECTURE.md §6.7](../../../ARCHITECTURE.md)). That matches how Mews packages it.

Three findings should shape the R5.7 design.

First, **profile sharing is an explicit, often irreversible choice at chain level**. OPERA needs a PIN to turn on Shared Profiles, and "the option cannot be disabled once enabled" ([OPERA Cloud: Configuring Chain](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.3/ocsuh/t_admin_configuring_chain.htm)).

Second, **finance stays per property everywhere**. OPERA distributes AR accounts from a hub, but each hotel keeps its own billing ([OPERA 18.3: distribute AR accounts](https://docs.oracle.com/cd/E81346_01/doc.183/e81527/t_cashiering_finance_copying_accounts_to_other_properties.htm)). That fits HospAI's lock that folio transfer is within one stay and that consolidation happens in the accounting export.

Third, **no vendor documents a group-level night-audit status view**. (Inference) That is open ground, and HospAI's per-property night-audit state and HALTED signal make it cheap to build. To respect the rule that no OLTP report fans out across properties ([ARCHITECTURE.md §7.8](../../../ARCHITECTURE.md)), each property's audit state should be pushed into a projection, not read live from every PropertyDO.

## Indian hotels expect vendor-done onboarding in days, not a self-serve wizard

None of the nine vendors offers credit-card self-signup for the full PMS. Everyone sells through a demo or a quote. "Self-serve" means only that the hotel does the configuration itself ([Mews pricing](https://www.mews.com/pricing); [Cloudbeds pricing](https://cloudbeds.com/property-management-system/pricing); [Djubo](https://www.djubo.com/llms-full.txt)).

That puts HospAI's recorded decision to keep the authenticated `POST /v1/orgs` bootstrap in context. Any Clerk user can create an org and gets a Starter subscription seeded automatically ([registry.ts](../../../apps/pms-core/src/registry.ts); [AGENTS.md](../../../AGENTS.md)). That is fine as an API primitive. In a sales-led market, though, real customers will be provisioned by HospAI staff. (Inference) The operator console should therefore list bootstrapped orgs that never provisioned a property, so stray Starter orgs are seen and not left to pile up. The staging smoke already leaves a new org behind on every run ([smoke-staging.mjs](../../../scripts/smoke-staging.mjs)).

The onboarding norm in India differs from the West. Hotelogix assigns an implementation manager and an account manager, configures tax IDs itself and claims **2–3 days to live** for a 50-room independent ([Hotelogix case study](https://www.hospitalitynet.org/casestudy/4133362/switching-hotel-pms-hotelogix-gets-your-properties-live-faster)). Djubo's team "does the full setup" in **7 or 14 working days**, with no setup fee ([Djubo](https://www.djubo.com/llms-full.txt)). Western vendors push configuration onto the hotel: Mews Classic estimates about 24 hours of hotel time over 1–3 weeks, and Cloudbeds quotes 3–8 weeks ([Mews Classic](https://help.mews.com/s/article/What-is-the-Classic-onboarding-package-for-Mews-Operations); [Cloudbeds implementation](https://cloudbeds.com/hotel-management-software-guide/implementation)).

Every vendor follows the same steps:

1. kick-off with a target go-live date
2. configuration
3. integrations and the payment gateway
4. a test import
5. an **audit before go-live** (Mews requires one, and it can take three business days)
6. go-live
7. **hypercare**, then handover to support

Hypercare lasts 7 days at Hotelogix, 10 at Cloudbeds, 30 at Mews and 60 at Stayntouch ([Mews system audit](https://help.mews.com/s/article/Mews-Onboarding-System-Audit); [Cloudbeds onboarding](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/360041220954-What-to-expect-during-Cloudbeds-onboarding); [Stayntouch outline](https://stayntouch.freshdesk.com/support/solutions/articles/24000013054-stayntouch-pms-onboarding-detailed-outline)).

HospAI's go-live list commits to "a named support contact for the first week" ([roadmap, Pilot go-live](../../../docs/roadmap.md)). That is the bottom of the market range. For a first customer, the 30-day window that Mews offers to every package is the safer benchmark.

**Migration** has an unresolved conflict. Vendors import future reservations, guest and company profiles, and deposits paid. They do not import history. They run a test import about a week out and a delta import at cut-over. Open A/R balances "often don't transfer through a standard reservation import" ([Stayntouch: switching](https://www.stayntouch.com/blog/how-to-make-the-switch-to-saas-hotel-pms/); [Mews blog](https://www.mews.com/en/blog/painless-pms-switch)). Cloudbeds sells reservation import as a paid add-on, and the hotel must produce the export ([Cloudbeds Onboarding T&Cs](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/360050401814-Onboarding-Terms-and-Conditions)).

HospAI's go-live list requires a "full BluePMS import on staging" and a "final delta import". Yet R4.8 was deferred on 2026-11-19, with a rule that the importer is "not a script an engineer runs" ([roadmap R4.8](../../../docs/roadmap.md)). One of the two documents must change before cut-over. The market evidence points to a narrow pilot import: future reservations, profiles and deposits, with city-ledger opening balances keyed in by hand. That is a much smaller job than "full".

Two more market patterns are worth copying.

The first is Apaleo's **Test → Live property status**. A new property starts in Test, and resetting it deletes reservations, folios and payments but keeps units and rate plans ([Apaleo test status](https://apaleo.zendesk.com/hc/en-us/articles/4403408049554)). (Inference) This is the cleanest way to give the pilot hotel a practice sandbox inside production, without the configuration drift a separate training tenant brings. HospAI's demo seed refuses to run outside local dev ([env.ts](../../../apps/pms-core/src/env.ts)), so this would be a new spec.

The second is **training built for staff turnover**. Hotelogix runs a train-the-trainer programme that certifies a senior staff member. Djubo bundles a Moodle course in every plan ([Hotelogix case study](https://www.hospitalitynet.org/casestudy/4133362/switching-hotel-pms-hotelogix-gets-your-properties-live-faster); [Djubo](https://www.djubo.com/llms-full.txt)).

**Support** comes in two models. Mews sells tiered support with the only published response table. Critical requests get a response in 4 hours on Standard and 2 hours on Premium, and Premium "cannot make any changes on your behalf" ([Mews SLA](https://www.mews.com/en/legal/service-level-agreement); [Mews Standard vs Premium](https://help.mews.com/s/article/what-do-standard-premium-support-include)). Stayntouch, Hotelogix, eZee and Djubo include 24/7 support. Stayntouch promises a P1 response within 1 hour around the clock ([Stayntouch SLA](https://www.stayntouch.com/service)). WhatsApp as a channel appears only at Djubo, which fits what Indian SMB hotels expect ([Djubo](https://www.djubo.com/llms-full.txt)).

**Customer success** below the enterprise tier is mostly automated. Mews sends health surveys at 7, 30 and 60 days in every package ([Mews Classic](https://help.mews.com/s/article/What-is-the-Classic-onboarding-package-for-Mews-Operations)).

**Offboarding** is where HospAI already leads. Mews requires the hotel to download its data *before* the term ends and gives no day count for deletion. Cloudbeds deletes "in accordance with the Documentation" and keeps backups ([Mews DPA](https://mews.com/legal/data-processing-addendum); [Cloudbeds DPA](https://www.cloudbeds.com/legal/dpa)). HospAI has org close, then a 30-day retention gate (`ORG_PURGE_RETENTION_MS`), then a certified purge, and closing can be reversed ([0004_purge.sql](../../../migrations/d1-platform/0004_purge.sql); [purge-workflow.ts](../../../apps/pms-core/src/purge-workflow.ts)). That beats every published term. Two things are missing:

- The 30 days are not written into any customer contract.
- The current-state review found no whole-tenant export.

Promising "30 days read-only, a full export and a deletion certificate" would be a real differentiator once both exist.

## The entitlement plane is ready for billing; the money rails are not

Hotel PMS SaaS is priced **per room per month with a floor per property**. Apaleo publishes €8 per room per month with a €400 monthly floor and no setup fee ([Apaleo pricing](https://apaleo.com/pricing)). Western core prices run about $8–15 per room ([Roommaster on Mews](https://www.roommaster.com/blog/mews-pricing), a competitor's estimate).

India works differently. eZee lists about **₹2,250 a month** at entry ([Techjockey](https://www.techjockey.com/detail/ezee-absolute)), and Djubo's tiers run about **$46–223 a month**, with discounts for quarterly and annual prepayment ([Capterra Djubo](https://www.capterra.com/p/143927/Djubo/pricing/); [Capterra India](https://www.capterra.in/software/143927/djubo)). At ₹2,250 for about 10 rooms, that is roughly **3–5x cheaper per room** than Western list prices.

HospAI's catalog limits properties (`pms.properties.limit`), not rooms, and `plan.base_price` is seeded at 0 ([ARCHITECTURE.md §6.7](../../../ARCHITECTURE.md); [0002_entitlements.sql](../../../migrations/d1-platform/0002_entitlements.sql)). If pricing goes per room, enforcing a units meter, which the catalog spec deferred, becomes a billing prerequisite ([entitlement catalog spec §2](../../../docs/superpowers/specs/2026-11-18-entitlement-catalog-design.md)).

HospAI's entitlement design already follows the integration pattern the billing platforms recommend. Stripe tells sellers to **persist entitlements in their own store** and enforce them locally, and notes that product changes reach existing subscriptions only at the next billing period ([Stripe Entitlements](https://docs.stripe.com/billing/entitlements)). HospAI's `subscription` and `subscription_addon` tables, with triggers that bump `entitlement_version`, are that store ([0006_entitlement_catalog.sql](../../../migrations/d1-platform/0006_entitlement_catalog.sql)). (Inference) Billing then becomes a webhook-driven command that writes these rows, with an audit record.

The missing piece before any billing is the planned `entitlement_override (… reason, granted_by, expires_at)` table, and a staff path that writes it. Today a plan change or an add-on grant is hand-written D1 SQL, and nothing records who made it or why ([ARCHITECTURE.md §6.1–6.2](../../../ARCHITECTURE.md); [registry.ts](../../../apps/pms-core/src/registry.ts)).

India imposes three hard constraints that a Stripe-first plan would miss:

1. **Recurring-mandate caps.** Under RBI's 2026 e-mandate framework, recurring debits go through without extra authentication only up to **₹15,000** per transaction, and changing a mandate needs re-authentication ([RBI Master Direction](https://rbi.org.in/scripts/BS_ViewMasDirections.aspx?id=13374)). (Inference) Small-hotel plans fit under the cap. Group plans will exceed it, and Indian B2B SaaS then falls back to an invoice plus bank transfer.
2. **GST invoicing.** HospAI must issue GST invoices to its hotel customers.
3. **e-invoicing.** Generating e-invoices through the government portal (IRP) becomes mandatory above **₹5 crore** of turnover ([OnlineLegalIndia](https://www.onlinelegalindia.com/blogs/e-invoicing-applicability)). A claimed drop to ₹2 crore could not be confirmed. Chargebee's India product bundles UPI AutoPay, e-mandates and GST e-invoicing through Razorpay ([Chargebee for India](https://chargebee.com/for-india)). Stripe Billing costs 0.7% of billing volume ([Stripe Billing pricing](https://stripe.com/en-us/billing/pricing)), and no India e-invoicing feature for it was found.

For the pilot none of this is needed. It runs on Growth, and HospAI can invoice it outside the product ([roadmap Track P](../../../docs/roadmap.md)).

**Payments revenue is real but thinner than it looks.** In 2025 Mews earned about **75% of its €291M revenue from transactions**. After €172M of gateway costs, its net payments take was about **0.28% of volume**, smaller in absolute terms than its €62M of SaaS revenue ([Skift, 2026-10-06](https://skift.com/2026/10/06/inside-mews-2-5-billion-valuation-can-the-economics-catch-up/)). In India, UPI carries zero MDR, yet Razorpay still charges a 2% platform fee plus GST ([Razorpay pricing](https://razorpay.com/pricing)). That supports HospAI's lock that UPI is a desk-recorded tender, not a PSP flow, and suggests payments margin matters for the Canada track, not the India one.

**Dunning should degrade service, not black it out.** ARCHITECTURE.md already says "past-due → read-only, not blackout" ([§6.2](../../../ARCHITECTURE.md)). Stripe's lifecycle (`past_due` → retries → `unpaid`) maps onto that ([Stripe subscriptions](https://docs.stripe.com/billing/subscriptions/overview)). No PMS vendor publishes its own suspension policy. (Inference) A read-only state has to keep arrivals, departures and the foreign-guest register working, because locking a hotel out of its legal duties is worse than losing the revenue.

The **metrics to run from day one** are:

- rooms under contract
- average revenue per room-month
- subscription revenue and net payments revenue, reported separately
- gross revenue retention and net revenue retention (NRR)
- dunning recovery

SaaS Capital's 2025 private-SaaS medians are **101% NRR and 91% gross retention** ([SaaS Capital](https://www.saas-capital.com/research/saas-retention-benchmarks-for-private-b2b-companies/)). No India PMS churn data exists.

## Running fifty hotels needs a console, consented support access and paging

**The admin console.** AWS's SaaS guidance says a provider must see "system activity and health through the lens of individual tenants and tenant tiers" ([AWS SaaS Lens](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/tenant-aware-operations.html)). No PMS vendor publishes what its console contains.

The access pattern the leaders share is consistent. Nobody holds standing access. Grants are scoped and time-boxed. The customer sees them in its own audit log. Examples:

- Microsoft Customer Lockbox: approved access lasts at most **4 hours** ([Customer Lockbox](https://learn.microsoft.com/azure/security/fundamentals/customer-lockbox-overview)).
- Atlassian: grants last **24 hours** and email the account owner ([Atlassian access grants](https://support.atlassian.com/statuspage/docs/customer-data-access-grants-information/)).
- Shopify: the merchant approves each collaborator, who uses a request code ([Shopify collaborators](https://help.shopify.com/en/manual/your-account/staff-accounts/collaborator-accounts)).
- GitHub: staff actions show up in the customer's own audit log ([GitHub audit events](https://docs.github.com/en/enterprise-server@3.14/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/audit-log-events-for-your-organization)).

HospAI's §4.9 design already meets this standard: READ grants of 60 minutes or less with a reason, dual-control WRITE grants of 15 minutes or less, a separate Worker behind Cloudflare Access, and support access shown in the tenant's audit log. None of it is built. The only platform permission is `shell:internal`, and no support actor kind exists ([ARCHITECTURE.md §4.9](../../../ARCHITECTURE.md); [permissions.ts](../../../packages/contracts/src/permissions.ts)).

(Inference) For the pilot there is a cheap interim that stays consistent with this design. The hotel owner adds a named HospAI support user as an org member and removes them afterwards, using the existing member routes. Staff then act under their own identity, which is what Ory recommends over impersonation ([Ory](https://www.ory.com/blog/identity-level-impersonation)), and the hotel can see who has access.

The trade-offs are standing access while membership lasts, and revocation that takes up to the 60-second permission cache to land. Atlassian revokes immediately. HospAI's recorded decision keeps the 60-second cache. Neither trade-off justifies building §4.9 before the pilot.

**Health analytics.** Customer-success tools combine usage, support load and sentiment into a weighted score. PostHog's internal model refreshes daily, out of 10, weighted 0.40 engagement, 0.25 stickiness and 0.35 relationship ([PostHog handbook](https://posthog.com/handbook/customer-success/health-tracking)). Cloudflare positions Workers Analytics Engine for per-tenant usage and for finding high-error tenants ([Cloudflare SaaS usage analytics](https://developers.cloudflare.com/use-cases/saas/usage-analytics/)).

(Inference) For a PMS, the signals that matter are operational, and HospAI's outbox already produces them:

- share of arrivals checked in through the system
- night audit finished on time
- folios closed at zero
- exception-queue depth
- active desk users

A nightly score from these, carrying only tenant and property ids and never guest data, is enough until there is a customer-success team.

**Observability.** This is the largest gap. HospAI has structured logs tagged by tenant. It has no `observability` block in wrangler.jsonc, no metrics, no alerting and no paging. The ten paging signals in ARCHITECTURE.md §13 have no roadmap slice ([observability spec](../../../docs/superpowers/specs/2026-07-28-observability-design.md); [wrangler.jsonc](../../../apps/pms-core/wrangler.jsonc)). Examples of those signals are `night_audit.state = HALTED`, `outbox.unacked_age` over 60 seconds and `degraded.pending_commands` over 15 minutes, each to alert on "the worst property, never the mean".

The Cloudflare building blocks are cheap:

- **Workers Logs** index structured JSON fields automatically but keep only **7 days on Paid**. Pricing changes from 1 December 2026 ([Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)).
- **Analytics Engine** takes one index per data point, so `propertyId` fits, and keeps data for three months ([Analytics Engine limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/)).
- **OpenTelemetry export** sends to Grafana, Honeycomb, Datadog, Sentry and others ([OTel export](https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data)).

Retention is the legal catch, covered in the compliance section. Seven days of logs cannot meet India's 180-day CERT-In rule or the one-year DPDP rule.

**SLAs and status pages.** The market has converged on **99.9%**. Mews measures it monthly, with credits of (99.9 − actual) × 5% of the monthly fee as the sole remedy ([Mews SLA v1.5](https://www.mews.com/en/service-level-agreement)). Stayntouch measures quarterly, with 1/2/5% credits and an SLA that starts only after a 90-day stabilization period ([Stayntouch SLA](https://www.stayntouch.com/service)). Apaleo targets 99.5% ([Apaleo T&C](https://apaleo.com/terms-conditions)).

Mews's public incident history is the sobering part. It includes a WAF misconfiguration, an expired certificate and the **5 December 2025 Cloudflare outage** ([status.mews.com](https://status.mews.com); [Mews Cloudflare incident](https://status.mews.com/incidents/hd85j348htjm)). HospAI runs entirely on Cloudflare and serves its SPA from the same Worker. (Inference) Its degraded mode covers a PropertyDO outage, not a Cloudflare-wide one. The status page and the external uptime monitor should therefore run off Cloudflare. A printable arrivals and in-house list is the hotel's last fallback.

For the pilot, a 24/7 P1 promise ("cannot check in, check out or book") matters more than an uptime percentage. HospAI has no measurement to back an uptime figure yet.

**Releases.** Vendors deploy continuously with no downtime. Mews says it has never needed scheduled downtime. Per-hotel early access is a back-office toggle ([Mews early access](https://help.mews.com/s/article/How-to-enable-a-new-Mews-feature-in-the-live-environment)). Cloudflare's gradual deployments split traffic by percentage, pin users with version affinity and roll back across 100 versions ([gradual deployments](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/); [rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)). However, they split by request, not by tenant.

(Inference) To canary three hotels, HospAI needs either the unbuilt release-flag plane or a version-override header set by the router ([version overrides](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/index.md)). HospAI's mandatory expand/contract migrations already fit a split rollout.

What is missing before production:

- a production deploy workflow gated on green CI, which is on the go-live list
- a production trigger for `MigrationSweepWorkflow` (`post_migration_sweep` is dev-only)
- a post-deploy run of `smoke-staging.mjs`-style checks, which respects the no-Playwright decision ([roadmap](../../../docs/roadmap.md); [migration orchestrator spec](../../../docs/superpowers/specs/2026-07-28-migration-orchestrator-design.md))

(Inference) Night audit runs around each property's local midnight, so deploys should avoid the audit windows of the timezones in production.

**Backups.** No PMS vendor publishes recovery-point or recovery-time objectives (RPO/RTO) except Oracle, whose figures vary by service ([Oracle SaaS pillar](https://oracle.com/assets/saas-public-cloud-services-pillar-3610529.pdf)). SQLite-backed Durable Objects offer **30-day point-in-time recovery** through bookmarks ([DO storage API](https://developers.cloudflare.com/durable-objects/api/transactional-storage-api)). D1 Time Travel offers a similar 30 days on Paid, per a docs preview mirror that should be confirmed on the main docs site ([D1 Time Travel](https://docs-durable-objects-instance-replaced-errors.previews.developers.cloudflare.com/d1/reference/time-travel/index.md)).

HospAI has the platform feature but no runbook or tooling. Its own purge certificates flag the hazard: `do_pitr_not_covered_phase0`, meaning a restore to before a shred can bring back key material ([purge-certificate.ts](../../../apps/pms-core/src/purge-certificate.ts); [ARCHITECTURE.md §4.8](../../../ARCHITECTURE.md)). (Inference) The restore runbook must therefore refuse any target point earlier than a guest erasure or org purge. Any off-platform copy, such as nightly R2 exports for provider-level loss, must sit under the same per-org keys so that crypto-shredding still erases it.

## Partners and compliance: law sets a narrow floor, buyers set the bar

**Partner ecosystem.** The cloud-native vendors all run REST/JSON APIs with sandboxes, and they push webhooks over polling. Mews's Connector API is "completely open and self-service – free of charge" ([Mews certification](https://docs.mews.com/connector-api/your-journey/certification)). Apaleo requires OAuth Authorization Code per hotel, scopes "not broader than necessary", and a certification demo of **onboarding, day-to-day operations and offboarding** ([Apaleo: certify your app](http://apaleo.dev/guides/apaleo-store/certify-your-app.html)).

Oracle's design has a lesson in it. A rate limit of 50 requests per second per gateway, shared by every partner on a chain, lets one noisy app throttle the rest ([OHIP limits](https://docs.oracle.com/en/industries/hospitality/integration-platform/ohipu/c_limits.htm)). Oracle does get one thing right: hotels can audit connected integrations and disconnect them themselves.

Mews sets the benchmark for a deprecation policy: additive changes are not breaking, and discontinued features fail loudly rather than silently changing behaviour ([Mews deprecations](https://mews-systems.gitbook.io/open-api/staying-up-to-date/deprecations-policy)). A 2022 newsletter gave 6-month notice for minor breaking changes and 12-month notice for major ones ([Mews Oct 2022](https://docs.mews.com/staying-up-to-date/partner-newsletters/partner-mewsletter-oct22)).

No vendor publishes a marketplace revenue share. Shopify's is the cross-industry reference: 0% on a developer's first $1M of lifetime revenue, then 15% ([Shopify revenue share](https://shopify.dev/docs/apps/launch/distribution/revenue-share)).

HospAI's planned public API already covers most of this: OpenAPI from contracts, date-based versions, signed webhooks, mandatory idempotency keys, rate limits as an entitlement and OAuth apps installed per property ([ARCHITECTURE.md §10](../../../ARCHITECTURE.md)). It sits in Tracks 5–6, which is the right place. Pilot integrations (channel manager, POS, accounting export) are point connectors, not a marketplace. Two additions are worth recording in the R5.3 spec now:

- rate limits per partner per property, not one shared gateway limit
- a list of connected apps the hotel can see, with call counts and one-click revoke

**The legal floor in India is narrow, and part of it applies now.** The **CERT-In Directions** have been in force since June 2022. They bind HospAI directly as a body corporate and service provider: reportable incidents within **6 hours**, and ICT logs kept for a **rolling 180 days within Indian jurisdiction** ([Internet Society brief](https://www.internetsociety.org/wp-content/uploads/2022/06/IIB-India-CERT-In-Directions-2022.pdf); [Linklaters](https://linklaters.com/insights/blogs/digilinks/2022/may/india-new-and-onerous-cyber-security-framework-and-breach-reporting-obligations)).

The **DPDP Rules** were notified in November 2025. Their substantive duties apply 18 months later, around May 2027 ([DPDP Rules Gazette text](https://dpdpa.com/DPDP_Rules_2025_English_only.pdf)):

- security safeguards that cover processors
- "visibility on the accessing" of personal data through logs
- at least **one year** of logs
- backups
- a **72-hour** detailed breach report to the Board

The hotel is the data fiduciary and HospAI is the processor, so most DPDP duties reach HospAI through the contract. CERT-In reaches it directly.

HospAI's logs today are Workers Logs with 7-day retention and no observability config, and the research did not establish whether logs held abroad but producible on demand satisfy the "within Indian jurisdiction" rule ([ecosystem notes, section 8 gaps](../research_notes/Hotel%20PMS%20platform%20operations/ecosystem_compliance.md)). **That question needs a lawyer before the pilot.** Whatever the answer, long-term logs belong in R2 through Logpush, or with an OTel vendor, not only in Workers Logs.

PCI DSS v4.0 adds MFA for administrative access and 12 months of audit logs. Keeping card data in PSP-hosted fields shrinks HospAI's scope a great deal ([BDO on PCI 4.0](https://www.bdo.com/insights/digital/pci-dss-version-4-0-multi-factor-authentication); [PCI SSC SAQ A FAQ](https://blog.pcisecuritystandards.org/faq-clarifies-new-saq-a-eligibility-criteria-for-e-commerce-merchants)).

**Canada adds breach records and Quebec transfer assessments.** PIPEDA requires a record of *every* breach, kept for **24 months** ([SOR/2018-64](https://gazette.gc.ca/rp-pr/p2/2018/2018-04-18/html/sor-dors64-eng.html)). Quebec's Law 25 requires a privacy impact assessment before personal information leaves Quebec, plus a confidentiality-incident register ([LégisQuébec P-39.1](https://www.legisquebec.gouv.qc.ca/en/document/cs/P-39.1%20/20230630); [CFIB](https://cfib-fcei.ca/quebec-law-25)).

HospAI's registry accepts only the `eu`, `us` and `fedramp` jurisdictions, and its architecture forbids "answer[ing] a residency question with a location hint" ([0001_tenant_registry.sql](../../../migrations/d1-platform/0001_tenant_registry.sql); [ARCHITECTURE.md §4.5](../../../ARCHITECTURE.md)). (Inference) Indian and Canadian hotels should be told plainly where their data is processed. Quebec hotels will need a transfer pack: hosting locations, sub-processors and safeguards. Only Oracle, among the vendors researched, shows in-country endpoints (Mumbai, Toronto) ([OPERA network datasheet](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.2/ocsnc/network.pdf); [OCI regions](https://www.oracle.com/cloud/architecture-and-regions/)).

**Certifications are a buyer bar, not a legal one.** No law mandates SOC 2 or ISO 27001. Mews publishes ISO 27001 (Schellman, to May 2027), SOC 2 Type 2 and PCI through a trust centre with gated documents ([Mews Trust Center](https://trust.mews.com/); [Mews ISO certificate](https://www.mews.com/hubfs/eBooks/ISO-27001-2024-2027.pdf)). Stayntouch cites only SOC 2 Type 1 ([Stayntouch](https://www.stayntouch.com/articles/?p=278)). No Cloudbeds SOC 2 report was found, and its own pages disagree on its PCI level ([Cloudbeds security](https://www.cloudbeds.com/security/)). Yanolja certified ISO 27001/27701 at group level, including Yanolja Cloud Solution, in February 2025 ([Yanolja Group](https://yanoljagroup.com/news/view?id=1457)).

HospAI's crypto-shredding, purge certificates that list what was kept and why, and retention exemptions for tax and immigration records already meet the "erase identity, keep the legal record" standard. That standard is gaining weight: the EDPB made the right to erasure its 2025 coordinated enforcement topic ([EDPB CEF 2025](https://www.edpb.europa.eu/system/files/2026-02/edpb_cef-report_2025_right-to-erasure_annex_en.pdf)). The work left is paperwork:

- a DPA
- a sub-processor list (Cloudflare, Clerk, the copilot model provider, and the PSP once there is one)
- a security page with a vulnerability contact
- a breach register

## The prioritized gap list

The first tier is mostly runbooks, configuration and contracts, not new roadmap slices, so it fits a serial Track P. The second and third tiers are product work, and they slot into existing roadmap items wherever one exists.

### Before the first paying hotel

| # | Gap | Why (evidence) | HospAI starting point |
|---|---|---|---|
| 1 | Verify Form III against Form C: name, fields, departure report | 2025 Act and Rules; moderate evidence ([Rules PDF](https://www.thc.nic.in/Central%20Governmental%20Rules/Immigration%20and%20Foreigners%20Rules,%202025..pdf)) | Tracker shipped as Form C. Departure out of scope ([spec](../../../docs/superpowers/specs/2026-11-22-form-c-tracker-design.md)) |
| 2 | Production deploy: workflow gated on green CI, Clerk production instance, new master key, post-deploy smoke | Go-live list | `env.production` resources exist ([roadmap](../../../docs/roadmap.md)) |
| 3 | Alerting and paging on the §13 signals, at minimum HALTED night audit, outbox age and degraded commands, plus a named on-call | Every vendor pages. The signals are already defined | No metrics, no slice ([observability spec](../../../docs/superpowers/specs/2026-07-28-observability-design.md)) |
| 4 | Log retention: an `observability` block plus Logpush to R2 for 180 days or more. Legal opinion on CERT-In's "in India" rule | CERT-In 6-hour reporting and 180-day logs apply now ([ISOC](https://www.internetsociety.org/wp-content/uploads/2022/06/IIB-India-CERT-In-Directions-2022.pdf)) | Workers Logs at 7 days only |
| 5 | Incident and breach runbook: CERT-In 6 hours, notice to the hotel within hours | CERT-In now. DPDP 72 hours from about May 2027 | None found |
| 6 | Restore runbook and one drill using DO PITR, refusing points before a purge | 30-day PITR exists. DPDP Rule 6(d) requires backups | `do_pitr_not_covered_phase0` ([purge-certificate.ts](../../../apps/pms-core/src/purge-certificate.ts)) |
| 7 | Provisioning and plan runbook, with a change log of who granted what and why | Pilot is "provisioned by ops on Growth" | Hand-written D1 SQL only ([registry.ts](../../../apps/pms-core/src/registry.ts)) |
| 8 | Kill-switch procedure, and a decision on how to suspend one tenant | The kill-switch is global per feature, test-only tooling, and its cache TTL differs between docs (10 s) and code (60 s) | [entitlement-client](../../../packages/entitlement-client/src/index.ts) |
| 9 | Interim consented support access: hotel adds and removes a named HospAI user | Atlassian, Shopify and Lockbox patterns | Member routes exist. §4.9 unbuilt |
| 10 | Resolve the BluePMS import: narrow pilot import, or amend the go-live list | Vendors import future reservations, profiles and deposits only | R4.8 deferral conflicts with the go-live list |
| 11 | DPA, sub-processor list, security page, vulnerability contact | Processor terms are a legal minimum | Not covered in review |
| 12 | Hypercare: 30 days with a 24/7 P1 line (WhatsApp plus phone), and a status page plus external monitor hosted off Cloudflare | Mews 30 days. Mews was hit by the Cloudflare outage of 5 Dec 2025 | "Named contact for the first week" |

### Before ten hotels

| # | Gap | Why (evidence) | HospAI starting point |
|---|---|---|---|
| 13 | Runtime tenant selection in the SPA, so one deployment serves many orgs. R4.4 switcher | (Inference) A build per property does not scale past a handful | `VITE_ORG_ID`/`VITE_PROPERTY_ID` at build time ([tenant.ts](../../../apps/web-pms/src/config/tenant.ts)) |
| 14 | Read-only operator console: tenants, plan, status, business date, last audit, errors, backlog, idle bootstrapped orgs | AWS SaaS Lens: health by tenant | §4.9 design, separate Worker behind Access |
| 15 | `entitlement_override` with reason, granted_by and expires_at. Staff writes as audited commands with a staff actor kind | ARCHITECTURE §6.1. GitHub shows staff actions to the customer | Table and actor kind absent ([permissions.ts](../../../packages/contracts/src/permissions.ts)) |
| 16 | Per-tenant suspend and read-only dunning that keeps legal duties working | "past-due → read-only, not blackout" | Only org status and the global kill-switch |
| 17 | Per-property metrics in Analytics Engine, SLOs, nightly health score | Cloudflare SaaS usage pattern. PostHog model | No binding ([wrangler.jsonc](../../../apps/pms-core/wrangler.jsonc)) |
| 18 | GST-correct billing to hotels: GSTIN, place of supply, annual and quarterly prepay. Mandate or bank-transfer rail | RBI ₹15,000 cap. e-invoicing above ₹5 crore | R5.6, now in the Canada track |
| 19 | R4.8 importer with test import, delta import and a rejection report | Every vendor runs a test import, then a delta | Deferred |
| 20 | Test → Live property mode, or a practice property | Apaleo model | Demo seed is local only |
| 21 | Whole-tenant export, and the 30-day exit window written into contracts | Mews and Cloudbeds give no day counts, so this would beat them | Purge lifecycle shipped. No export found |
| 22 | Production migration-sweep trigger. Per-tenant canary through flags or a version override | 100-version rollback. Flags plane unbuilt | `post_migration_sweep` is dev-only |
| 23 | Published SLA (99.9% monthly, 48-hour notice, credits as sole remedy) once metrics exist | Mews and Stayntouch | None |

### Before selling to groups

| # | Gap | Why (evidence) | HospAI starting point |
|---|---|---|---|
| 24 | Portfolio tier above org (management scope) kept separate from the guest-data boundary | Mews portfolio and chain split | Org is both boundaries. No group scope |
| 25 | Group roles, SSO/SAML and SCIM into OrgDO | Mews Portfolio plan | `sso.saml` reserved for Group |
| 26 | Consolidated reporting and a group night-audit board from projections or the warehouse | Mews Analytics, Cloudbeds Insights. Audit board is open ground | R5.7. Warehouse unbuilt |
| 27 | Central rates and templates (copy-and-diverge versus linked) and a central reservations view | OPERA hub templates, Mews central rate groups | §7.6 planned |
| 28 | SOC 2 Type 2 or ISO 27001, trust centre, annual pen test | Mews has both. Type 1 is a stop-gap | Design strong. No audit |
| 29 | Documented hosting per tenant region, and a Quebec transfer pack | Law 25 PIA. OPERA regional data centres | eu/us/fedramp only |
| 30 | Public API with deprecation policy, per-partner-per-property limits, connected-apps revoke | Mews 6/12 months, OHIP disconnect | R5.3 planned (§10) |
| 31 | Stage B group data consolidation | Oracle group cut-overs: 96 hotels in 31 hours | Moved to R5.7 |

## Conclusion

The research changes the question from "what features does a platform PMS need" to "what does a small team need so it is not flying blind". The vendors HospAI will be compared with do not publish better tenancy or compliance designs than HospAI's. What they visibly have is operational muscle memory: incident pages written in hotel language, hypercare windows, SLA tables, consent-gated support access and audited back-office toggles. HospAI's architecture already describes most of that layer (§4.9 elevation, §6.1 overrides, §13 paging signals). The gap is that none of it has a roadmap slice. The cheapest move is to turn the first-tier items into go-live checklist entries with owners, so they ship with the pilot without changing the serial track order.

Two less obvious implications stand out. First, HospAI's purge, retention-exemption and certificate machinery is a sales asset in exactly the places rivals are vague: exit terms, erasure evidence, and the legal duty to keep invoices and immigration records. Once a tenant export exists, it should be written into contracts and a trust page. Second, the most consequential near-term risks are legal, not technical. The CERT-In rules on log location and 6-hour reporting already apply, and the foreign-guest form may have changed under HospAI's feet. Both questions can be settled cheaply with an advisor before the first night audit. After go-live they become costly to fix.
