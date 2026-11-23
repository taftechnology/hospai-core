# Partner ecosystem and compliance programmes of hotel PMS SaaS vendors

Scope: open APIs, app marketplaces, interoperability standards, security/privacy certifications, legal regimes (GDPR, India DPDP + CERT-In, Canada PIPEDA + Quebec Law 25), trust centres, and guest-data rights versus legal retention. Vendors: Cloudbeds, Mews, Apaleo, Oracle OPERA Cloud (OHIP), Stayntouch, SiteMinder, eZee/Yanolja, Hotelogix. Research date 2026-11-22. Many vendor claims below are self-published marketing and are flagged as such; no audit reports (SOC 2, PCI AOC) were read, because they sit behind NDA or request forms.

## 1. Open APIs: style, auth, rate limits, sandboxes, versioning, developer portals

### Takeaway
All the cloud-native PMS vendors run a public, documented REST/JSON API with a self-service or partner-gated sandbox. Webhooks, or event streaming in Oracle's case, are pushed hard over polling. Authorisation is per property or per chain/enterprise. Apaleo and Cloudbeds use OAuth 2.0 (Cloudbeds now prefers API keys). Mews uses a ClientToken + per-enterprise AccessToken. Oracle uses OAuth plus an application key on a per-chain gateway. Published rate limits range from about 5–10 req/s per property (Cloudbeds) to 50 req/s per gateway (Oracle). Mews is the clearest example of a written deprecation policy.

### Cited Findings
**Mews**
- The Connector API is "completely open and self-service – free of charge for integration partners and Mews customers alike." Partners develop against a demo (sandbox) environment that is available at any time. — [Mews certification docs](https://docs.mews.com/connector-api/your-journey/certification)
- Request limits differ between Demo and Production. The certification page gives no figures and refers to the environments guide. — [Mews certification docs](https://docs.mews.com/connector-api/your-journey/certification)
- A third-party guide cites the Connector API limit as 200 requests per AccessToken per 30 seconds. This was not verified against Mews docs, so treat it as unconfirmed. — [Hashlogics](https://www.hashlogics.com/answers/cloudbeds-mews-and-opera-apis-what-a-real-integration-involves)
- A unique AccessToken is issued for each enterprise (a Mews community post). — [Mews Community](https://community.mews.com/how-do-i-2/how-to-use-the-connector-api-1515)
- Deprecation policy: additive changes (new endpoints or fields) are not deprecations. No feature is discontinued without a deprecation process. Moving an operation from v1 to v2 makes v1 a deprecated feature. Partners should check the changelog at least monthly. Discontinued features fail outright rather than silently changing behaviour. — [Mews deprecations policy](https://mews-systems.gitbook.io/open-api/staying-up-to-date/deprecations-policy); [Mews Connector API deprecations](https://docs.mews.com/connector-api/deprecations)
- An October 2022 partner newsletter announced 6-month deprecation periods for minor breaking changes and 12-month periods for major ones. This is a 2022 source and should be confirmed against the current policy. — [Mews partner Mewsletter Oct 2022](https://docs.mews.com/staying-up-to-date/partner-newsletters/partner-mewsletter-oct22)
- The changelog is maintained through at least 15 Dec 2025, and the docs are published on GitHub. — [Mews Changelog 2025](https://docs.mews.com/connector-api/changelog/changelog2025); [GitHub MewsSystems/gitbook-connector-api](https://github.com/MewsSystems/gitbook-connector-api)

**Apaleo**
- API-first: "every capability … exposed through documented REST APIs secured with OAuth 2.0" (third-party API profile). — [API Evangelist apaleo profile](https://github.com/api-evangelist/apaleo)
- Two connection models: a Store integration available to every hotel, or a custom project for one hotel. — [Apaleo developer docs](https://apaleo.dev/)
- Store apps must use the OAuth 2.0 Authorization Code Grant. Access tokens expire after 3,600 seconds, so refresh must work. Apps must use webhooks instead of polling to avoid rate limits, and must use `pageSize=200`. — [Apaleo: Certify your app](http://apaleo.dev/guides/apaleo-store/certify-your-app.html)
- Calls to obtain OAuth tokens are rate-limited per application, and the guidance is to cache and reuse tokens until expiry. — [Apaleo OAuth best practices](https://apaleo.dev/guides/oauth-connection/best-practices.html)
- A "Rate limiting" docs page exists, but its figures were not retrieved. — [Apaleo developer docs](https://apaleo.dev/)

**Cloudbeds**
- Official FAQ: 5 requests/second for property and group accounts, 10/second for tech partners, enforced. The older Tech Specs page gives a flat 10 req/s. The FAQ recommends about 6–8 calls per use case plus webhooks. Rate limiting was introduced in February 2019. — [Cloudbeds developer FAQ](https://developers.cloudbeds.com/docs/faq); [Cloudbeds Tech Specs](https://developers.cloudbeds.com/reference-link/tech-specs); [Cloudbeds changelog 2019](https://developers.cloudbeds.com/changelog/2019)
- API keys are now the preferred authentication method, and OAuth 2.0 is documented as an "alternative". For certification, Flow A user authorisation is mandatory. Refresh tokens expire after 365 days of client inactivity. Redirect URIs must be HTTPS. — [Cloudbeds alternative OAuth 2.0](https://developers.cloudbeds.com/docs/alternative-oauth-20-authentication-method); [Cloudbeds integration guide](https://developers.cloudbeds.com/docs/integration-guide); [Migration from OAuth to API keys](https://developers.cloudbeds.com/docs/migration-from-oauth-20-to-api-keys-for-technology-partners-optional)
- Separate "Property and Group Account API Access" documentation exists, so hotels and groups can hold their own credentials, not only partners. — [Cloudbeds property and group API access](https://developers.cloudbeds.com/docs/property-and-group-account-api-access)
- Cloudbeds publishes "API Security Standards" for partners. — [Cloudbeds API security standards](https://developers.cloudbeds.com/docs/api-security-standards)

**Oracle OPERA Cloud / OHIP**
- Limits: up to 50 req/s per gateway, shared by all consumers and clients, with a short burst up to 100; excess requests get delays or HTTP 429. Streaming-management requests: 12/min (burst 100/min). Only one consumer per chain per gateway per application key. Consumers must reconnect at least every 24 h (or resume from an offset) and wait at least 10 s between close and resubscribe. Integration Processor business events: 300/min per gateway. Asynchronous APIs: the page gives both 250/min and 100/min for POST, an internal conflict. Header size 8 KB. Default body 100 KB, with 2 MB for bulk endpoints such as `postReservation` and `postRoomingList`, and 14 MB for uploads. A developer portal allows at most 100 registered applications. At most 100 allow-listed IP ranges per chain. R&A Data APIs: 1M rows, 1 GB per query, a 730-day range, and 10 concurrent requests. — [OHIP Limits](https://docs.oracle.com/en/industries/hospitality/integration-platform/ohipu/c_limits.htm)
- OAuth tokens: renew about 1 minute before `exp`. Identical async requests need a 30-minute gap. — [OHIP Limits](https://docs.oracle.com/en/industries/hospitality/integration-platform/ohipu/c_limits.htm)
- A shared sandbox is available for API access, without the UI or legacy OXI/OWS. Developer portal and sandbox access requires Oracle Partner Network registration. Partners move to production by activating the application with each customer chain. — [Oracle partner FAQ](https://www.oracle.com/a/ocom/docs/industries/hospitality/partner-innovation-enablement-faq.pdf); [OHIP moving to production](https://docs.oracle.com/en/industries/hospitality/integration-platform/ohipu/t_moving_to_production_ssd.htm)
- Pricing: partners pay per call, from $10 for up to 10,000 transactions/month. The source is an Oracle Marketplace PDF whose date is unclear. — [OHIP marketplace PDF](https://marketplace.oracle.com/media/167896955/other/ohip-integration-platform.pdf)
- Throttling guidance: use the Distribution APIs for shop and book, cache lists of values, use async operations, and use streaming instead of polling. — [OHIP Limits](https://docs.oracle.com/en/industries/hospitality/integration-platform/ohipu/c_limits.htm)

**Stayntouch**
- Stayntouch describes its "Stayntouch Connect" APIs as free, webhook-enhanced and fully documented, with "unlimited integrations at no extra cost". It claims 1,200+ or 1,400+ integrations; its own pages give both figures. — [Stayntouch open API comparison](https://www.stayntouch.com/articles/?p=215); [Stayntouch integrations](https://www.stayntouch.com/integrations/); [Stayntouch integration hub news](https://www.stayntouch.com/news/stayntouch-unveils-new-integration-hub/)
- A published API integration process exists in the Stayntouch support portal. — [Stayntouch API integration process](https://stayntouch.freshdesk.com/support/solutions/articles/24000100118-stayntouch-api-integration-process)

### Inferences
- The industry norm is REST/JSON. No vendor in scope was found offering a public GraphQL API (searches did not surface one).
- Per-property or per-chain authorisation with refresh tokens is universal. Oracle adds a gateway-level shared rate limit, so one noisy partner can throttle every partner on that chain. That is a design trade-off a small vendor should avoid: rate-limit per (partner × property) instead.
- Two things buyers and partners will ask a new PMS for: a written deprecation policy with notice periods (Mews' 6/12-month model is a credible benchmark) and a public changelog.

### Gaps
- Apaleo's numeric rate limits and webhook retry semantics were not retrieved.
- Mews' official production rate limit and its OAuth/marketplace "connect" flow were not retrieved. The 200/30 s figure is third-party only.
- No SiteMinder, eZee/Yanolja or Hotelogix API documentation was examined (rate limits, auth model, versioning).
- No vendor's sandbox data-reset or seed policy was found.

## 2. App marketplaces: certification, revenue share, install/uninstall, scoping and audit

### Takeaway
Every marketplace gates listing on a certification review. In each case the review checks API hygiene (correct endpoints, error handling, webhooks over polling, least-privilege scopes), not partner security. Then comes a pilot at a live hotel. Listing and certification are free at Apaleo and Mews (at Stayntouch, per its own marketing). Cloudbeds charges certification costs to the partner. Oracle bills partners per API call. No vendor's revenue-share terms were found publicly. Hotels install apps from inside the PMS (consent or approval). Revocation comes from the hotel side, with partner offboarding duties.

### Cited Findings
**Mews Marketplace**
- Journey: register through the Marketplace form to get a Partner ID (e.g. INT12345), develop and test in Demo, then submit a certification form. Mews checks that requests follow the Connector API spec and match the operations and purposes declared on the form. Partner-side processes are **not** reviewed. — [Mews certification docs](https://docs.mews.com/connector-api/your-journey/certification); [Mews Help: certification what to expect](https://help.mews.com/en/articles/4497819-connector-api-certification-what-to-expect)
- Reviewers check that endpoints match the described workflow, that errors were handled in later calls, request formatting, and "appropriate frequency and relevant filters". A unique `Client` name in demo calls is mandatory, or review cannot proceed. — [Mews Help: certification what to expect](https://help.mews.com/en/articles/4497819-connector-api-certification-what-to-expect)
- Public listing includes a two-week pilot at a named pilot property. Private integrations can go live within 24 h of certification. — [Mews private integration journey](https://docs.mews.com/connector-api/your-journey/private-integration); [Mews Help](https://help.mews.com/en/articles/4497819-connector-api-certification-what-to-expect)
- The partner is responsible for data quality and for staying within request limits. — [Mews certification docs](https://docs.mews.com/connector-api/your-journey/certification)
- Partners that access hotel data are bound by a "Data Processing and Transfer Policy – Partners" (v3.4, effective 30 March 2026). It requires processing only on documented instructions and only to the extent necessary, plus breach notification without undue delay. — [Mews partner data processing policy v3.4](https://www.mews.com/en/legal/data-processing-transfer-policy-partners); [Mews service partner DPA](https://www.mews.com/en/legal/service-partner-dpa)

**Apaleo Store (and Agent Hub)**
- "Certification is a quality requirement for store publication." Prerequisites: an onboarding guide, OAuth Authorization Code Grant, error handling (including 404s), token refresh, webhooks not polling, `pageSize=200`, and end-to-end testing. — [Apaleo: Certify your app](http://apaleo.dev/guides/apaleo-store/certify-your-app.html)
- Process: a pre-certification call validates auth and **requested scopes**, which "should not be broader than necessary". Then a certification call with screen-share of three flows: **onboarding, day-to-day operations, offboarding**. Apaleo monitors API usage for logic errors and webhook use. Passing apps are listed on the Store and the Agent Hub, so AI agents are certified through the same path. — [Apaleo: Certify your app](http://apaleo.dev/guides/apaleo-store/certify-your-app.html)
- "There are no additional costs for certification or store listing." — [Apaleo: Certify your app](http://apaleo.dev/guides/apaleo-store/certify-your-app.html)
- Offboarding must unsubscribe webhooks and other subscriptions and "cleanly close the operation with the customer". — [Apaleo: Certify your app](http://apaleo.dev/guides/apaleo-store/certify-your-app.html)

**Cloudbeds Marketplace**
- A partner dev test account "does not guarantee access to Cloudbeds Marketplace and requires our Partnerships team's approval". The app's support-article URL and App Details page must be submitted before a certification call. Passing apps enter pilot testing. — [Cloudbeds integration guide](https://developers.cloudbeds.com/docs/integration-guide); [Getting started as a partner in 5 steps](https://developers.cloudbeds.com/docs/getting-started-as-a-partner-in-5-steps)
- API terms: "significant modifications or enhancements of your Application are subject to re-Certification. Certification will be at your expense." — [Cloudbeds API terms](https://www.cloudbeds.com/terms/api/)
- Install flow: the property opens the Marketplace and clicks "Submit Request". The partner is notified by webhook when `appstate_changed` goes from "installing" to "enabled". — [Cloudbeds integration guide](https://developers.cloudbeds.com/docs/integration-guide)
- Enforcement: up to 5 violations lead to withdrawal from the app directory, and up to 10 to termination of the integration. — [Cloudbeds integration guide](https://developers.cloudbeds.com/docs/integration-guide)
- Partner marketing requirements are published separately, and there is an optional reseller flow. — [Cloudbeds partner marketing requirements](https://developers.cloudbeds.com/docs/partner-marketing-requirements); [Cloudbeds reseller flow](https://developers.cloudbeds.com/docs/cloudbeds-reseller-flow-optional)

**Oracle OHIP**
- "Oracle does not perform any certification for partner integrations through the self-service" OHIP. Hoteliers can **audit integrations through the Developer Portal Analytics tab and disconnect a partner**. The only customer action required is approving the integration. — [Oracle OHIP docs / partner FAQ](https://www.oracle.com/a/ocom/docs/industries/hospitality/partner-innovation-enablement-faq.pdf); [OHIP moving to production](https://docs.oracle.com/en/industries/hospitality/integration-platform/ohipu/t_moving_to_production_ssd.htm)
- Historically (legacy OWS), installing an uncertified interface could void support, and "validated" interfaces carried Oracle endorsement. That is now superseded for self-service OHIP. — [Oracle partner FAQ](https://www.oracle.com/a/ocom/docs/industries/hospitality/partner-innovation-enablement-faq.pdf)

**Stayntouch**
- Certification is required for marketplace listing, and Stayntouch says its API certification is free with unlimited connections (vendor claim). — [Stayntouch open API comparison](https://www.stayntouch.com/articles/?p=215)

### Inferences
- Certification across vendors is a **functional and API-hygiene review**, not a security audit of the partner. Data protection is handled contractually (the Mews partner DPA, the Cloudbeds API terms), not technically verified. Least-privilege scopes (Apaleo) and per-hotel revocation (OHIP's Analytics plus disconnect) are the technical controls.
- The emerging good-practice bundle for a new PMS platform: OAuth Authorization Code per property, scoped permissions reviewed at certification, a hotel-visible list of connected apps with per-app API-call analytics, one-click revoke, and a partner offboarding obligation (unsubscribe, delete data). Apaleo's onboarding/operations/offboarding demo format is a cheap, copyable review ritual.
- Revenue models vary: free listing (Apaleo, Mews), partner-paid certification (Cloudbeds), metered API (Oracle). No public evidence of a percentage revenue share on app sales was found for any vendor.

### Gaps
- No public revenue-share percentages or listing fees for the Mews Marketplace, Cloudbeds Marketplace, Apaleo Store or Oracle Cloud Marketplace.
- No vendor publishes an audit-log format for partner data access visible to hotels, beyond Oracle's Analytics tab.
- SiteMinder's SMX/app store programme terms were not researched.

## 3. Standards: HTNG and OpenTravel versus vendor APIs

### Takeaway
HTNG (now under AHLA) defines requirements through workgroups, and OpenTravel publishes the message and object standards. Both are moving toward REST/JSON (OpenTravel 2.0 Object Model; HTNG "Express" slim profiles). In practice, though, integrations run on vendor-proprietary REST APIs, and standards matter mainly in distribution (content, ARI) and legacy enterprise interfaces. No adoption statistics exist.

### Cited Findings
- HTNG, HEDNA and OpenTravel jointly released "OpenTravel 1.0" content enhancements from HTNG's Optimizing Lodging Content Workgroup. Roles: HTNG manages workgroups and requirements, and OpenTravel publishes and manages standards. A joint workgroup is planned to update the OpenTravel 2.0 Object Model, including JSON/REST APIs. — [AHLA: OpenTravel 1.0 update](https://content.ahla.com/key-enhancements-for-hoteliers-with-opentravel-1.0-update)
- OpenTravel advertises "ready to use REST/JSON open source APIs". — [OpenTravel hospitality](https://opentravel.org/hospitality/)
- HTNG Express (Hapi + AHLA) narrowed HTNG's wide field sets to the critical data needed for a "simple, one-way integration". — [Hospitality Net: HTNG Express](https://www.hospitalitynet.org/news/4113016.html)
- The AHLA/HTNG 2026 "T100" challenges report says AHLA/HTNG continues to offer industry-standard APIs "such as PMS Express" and says adoption should be a 2026 priority. This implies adoption is still not widespread. — [AHLA HTNG T100 2026](https://www.ahla.com/sites/default/files/2026-03/AHLA-HTNG-T100-Top-Industry-Technology-Challenges.pdf)
- In April 2025 HTNG partnered with the Japan Hospitality Technology Association, which is translating HTNG standards to Japanese. — [Hospitality Net](https://www.hospitalitynet.org/news/4126671.html)
- A third-party analysis calls HTNG the least visible of the three standards programmes (qualitative). — [AltexSoft hotel tech standards](https://altexsoft.com/blog/hotel-tech-specifications-htng-opentravel)
- Oracle still references legacy OXI/OWS interfaces alongside OHIP REST; the sandbox excludes them. — [Oracle partner FAQ](https://www.oracle.com/a/ocom/docs/industries/hospitality/partner-innovation-enablement-faq.pdf)

### Inferences
- For a new PMS, OTA/HTNG XML is mainly relevant for **channel-manager and CRS connectivity** (ARI push and reservation delivery, e.g. OTA_HotelAvailNotifRQ / OTA_HotelResNotifRQ patterns). Vendor APIs, not standards, are what marketplace partners build against. A reasonable stance: own the domain model with a vendor REST API, and offer an HTNG/OTA-shaped adapter only where a distribution partner demands it.

### Gaps
- No quantitative adoption data for HTNG Express / PMS Express or for the OpenTravel 2.0 REST models.
- Which of the eight vendors implement HTNG certification profiles today was not established.

## 4. Certifications held by each vendor (PCI DSS, SOC 2, ISO 27001, GDPR, residency)

### Takeaway
The leaders (Mews, Oracle) publish ISO 27001, SOC 2 Type 2 and PCI DSS. Mid-market vendors (Cloudbeds, SiteMinder, Stayntouch) lead with PCI DSS and tokenised vaults. SOC 2 evidence is thinner: Stayntouch cites only Type 1, and no Cloudbeds SOC 2 report was found. For eZee/Yanolja and Hotelogix, the evidence is mainly vendor claims plus a 2025 group-level Yanolja ISO 27001/27701 announcement. Reducing PCI scope through a third-party vault or a payment-provider iframe is the universal pattern.

### Cited Findings
**Mews**
- The trust centre at trust.mews.com shows ISO/IEC 27001, SOC 2 and PCI DSS, with sensitive documents gated behind a request form. — [Mews Trust Center](https://trust.mews.com/)
- ISO/IEC 27001:2022 certificate from Schellman for Mews Systems s.r.o., issued 17 May 2024 and expiring 16 May 2027. — [Mews ISO 27001 certificate PDF](https://www.mews.com/hubfs/eBooks/ISO-27001-2024-2027.pdf)
- SOC 2 Type 2 examination completed and announced in 2023. — [Hospitality Net: Mews SOC 2 Type 2](https://www.hospitalitynet.org/news/4116622.html); [Mews Security and Compliance](https://www.mews.com/en/security-at-mews)
- PCI: Mews Operations runs on Microsoft Azure (PCI DSS 4.0 Service Provider Level 1), and Mews Payments relies on Stripe (Service Provider Level 1). This is from a help article that may be dated. — [Mews Help: PCI compliance](https://help.mews.com/s/article/pci-compliance)
- Data hosted in the EU or the US depending on product and configuration. A sub-processor list is published. — [Mews sub-processors](https://www.mews.com/en/legal/mews-sub-processors); [Mews DPA](https://www.mews.com/en/legal/data-processing-addendum)
- Roles: Mews is the processor for PMS data and the controller for voluntary data collected for the Mews Guest Portal. — [Mews Help: GDPR compliance](https://help.mews.com/s/article/gdpr-compliance)
- A DPA v3.5 appears with a bracketed effective date of "[1st October 2026]". — [Mews DPA v3.5](https://mews.com/legal/data-processing-addendum)

**Cloudbeds**
- The PCI level is **inconsistent across its own pages**: the English security page says "PCI DSS level 2", while the Spanish and Portuguese pages and a platform page say Level 1. — [Cloudbeds security (EN)](https://www.cloudbeds.com/security/); [Cloudbeds seguridad (ES)](https://www.cloudbeds.com/es/seguridad/); [Cloudbeds data security](https://www.cloudbeds.com/cloudbeds-data-security/)
- PCI compliance validated by VikingCloud. Cloudbeds "does not store credit card information" and uses a third-party token-based vault. — [Cloudbeds Help: Security features and PCI DSS](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/227167088-Cloudbeds-Security-Features-and-PCI-DSS-Certification)
- Runs on AWS, with TLS in transit and AES-256 at rest. — [Cloudbeds data security](https://www.cloudbeds.com/cloudbeds-data-security/)
- DPA: the client appoints Cloudbeds as processor. Cloudbeds flows data-protection terms down to sub-processors, remains liable for them, and informs clients before adding sub-processors. The DPA URL is inconsistent across pages (/legal/dpa, /terms/dpa, help centre). — [Cloudbeds DPA](https://www.cloudbeds.com/legal/dpa); [Cloudbeds DPA Mar 2025 PDF](https://cloudbeds.com/wp-content/uploads/2025/03/Data_Processing_Addendum_Digital_Arbitrage_Mar2025.pdf); [Cloudbeds Master Terms 2026](https://www.cloudbeds.com/master-terms-2026/)
- No Cloudbeds SOC 2 report was found. — (search negative; see Gaps)

**Oracle OPERA Cloud**
- The regional data centre is chosen by Oracle Hospitality infrastructure based on chain location. The US, EMEA and AP regions each use at least two geo-redundant data centres. A newer network datasheet lists an AP Mumbai endpoint. — [OPERA Cloud network datasheet 24.2](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.2/ocsnc/network.pdf)
- OCI regions exist in India (Mumbai, Hyderabad), Canada (Toronto, Montreal) and the EU, including EU Sovereign Cloud in Madrid and Frankfurt. Whether OPERA Cloud runs on the sovereign regions is not stated. — [Oracle OCI tenancy regions](https://docs.oracle.com/en/industries/hospitality/identity-management/ocimy/t_creating_an_oci_tenancy.htm); [Oracle public cloud regions](https://www.oracle.com/cloud/architecture-and-regions/)

**Stayntouch** (vendor marketing only)
- Claims AWS private VPC hosting with "SOC 2 Type 1, GDPR, and ISO 27001/27018" and PCI DSS Level 1 payment processing. Stayntouch Pay is described as PCI DSS v4.0 compliant. **No SOC 2 Type II claim was found.** — [Stayntouch PCI DSS Level 1 article](https://www.stayntouch.com/articles/?p=278); [Stayntouch payment API guide](https://www.stayntouch.com/articles/?p=320); [Stayntouch Security Guide](https://stayntouch.freshdesk.com/support/solutions/articles/24000100318-stayntouch-security-guide)

**SiteMinder**
- Says it became "PCI DSS certified globally" and publishes a **PCI DSS Responsibility Matrix**, which splits duties between SiteMinder and the hotel. — [SiteMinder data security](https://www.siteminder.com/legal/data-security/); [SiteMinder PCI compliance](https://www.siteminder.com/pci-compliance/)

**eZee / Yanolja Cloud Solution**
- In February 2025 Yanolja announced ISO/IEC 27001 and ISO/IEC 27701 certification covering HQ and key global members, **including Yanolja Cloud Solution (YCS)**. eZee Technosys was folded into Yanolja Cloud in 2021. — [Yanolja Group news](https://yanoljagroup.com/news/view?id=1457); [VentureSquare](https://www.venturesquare.net/en/985449); [PR Newswire: Yanolja Cloud launch](https://prnewswire.com/news-releases/yanoljas-new-corporation-yanolja-cloud-launches-to-lead-the-global-cloud-solution-technology-sector-301336256.html)
- PCI DSS and GDPR claims for eZee Absolute appear only in third-party directories. — [ZoftwareHub eZee Absolute](https://zoftwarehub.com/products/ezee-absolute/overview)

**Hotelogix**
- Claims to be a "PCI DSS compliant application". Its ISO 27001 wording is ambiguous: it reads as helping customers achieve ISO 27001 rather than Hotelogix holding a certificate. The privacy policy claims GDPR alignment and names a DPO. — [Hotelogix enterprise-grade security](https://hotelogix.com/enterprise-grade-security-hlxe); [Hotelogix privacy policy](https://www.hotelogix.com/privacy-policy)

**PCI DSS scope reduction (applies to all)**
- PCI SSC SAQ A update for v4.0.1 (January 2025): requirements 6.4.3 (payment-page script inventory and authorisation), 11.6.1 (tamper detection) and 12.3.1 were removed from SAQ A. In their place is an eligibility criterion: merchants that embed an iframe must confirm their site is not susceptible to script attacks. All card-capture fields must sit inside the iframe. — [PCI SSC blog: SAQ A eligibility FAQ](https://blog.pcisecuritystandards.org/faq-clarifies-new-saq-a-eligibility-criteria-for-e-commerce-merchants); [PCI SSC FAQ 1438](https://www.pcisecuritystandards.org/faqs/1438/); [PCI SSC: Important updates SAQ A](https://blog.pcisecuritystandards.org/important-updates-announced-for-merchants-validating-to-self-assessment-questionnaire-a)
- 6.4.3 and 11.6.1 still apply to service providers (PSPs) and to SAQ D / ROC merchants. They became effective 31 March 2025. — [Akamai on v4.0.1 SAQ A](https://www.akamai.com/blog/security/pci-dss-v4-0-1-changes-qualify-saq-a); [Adyen SAQ A eligibility](https://docs.adyen.com/development-resources/pci-dss-compliance-guide/saq-a-eligibility)
- Open interpretation: whether 6.4.3/11.6.1-style controls must cover the whole site or just the page hosting the iframe (one QSA says page only). — [TrustedSec](https://trustedsec.com/blog/the-hidden-trap-in-the-pci-dss-saq-a-changes)

### Inferences
- A PMS that **never touches the PAN** (PSP-hosted fields or iframe plus tokens; MOTO keyed through the PSP's virtual terminal) can keep itself out of most of the cardholder data environment. It is still likely a **service provider** if it can affect transaction security, for example by serving the page that loads the iframe. Then it needs an SAQ D-Service Provider or a ROC by transaction volume, and the 6.4.3/11.6.1 duties apply to it. Mews (Stripe) and Cloudbeds (third-party vault) both follow this pattern.
- SOC 2 Type 2 plus ISO 27001 is the enterprise/group norm (Mews, Oracle). Smaller vendors compete on PCI alone, or on SOC 2 Type 1 (Stayntouch). Self-published inconsistencies, such as Cloudbeds' Level 1 vs Level 2, are common, and diligent buyers ask for the AOC itself.

### Gaps
- Apaleo's certifications (ISO 27001, SOC 2, PCI) and hosting regions were not researched in this pass.
- SiteMinder's ISO 27001/SOC 2 status was not found.
- No primary eZee security page was found. Whether the Yanolja ISO scope covers the eZee Absolute product hosting is unconfirmed.
- Oracle Hospitality's own SOC/ISO attestations for OPERA Cloud (as opposed to OCI) were not retrieved.
- There is no evidence of any vendor offering a dedicated **India-resident** or **Canada-resident** PMS tenancy, other than Oracle's Mumbai endpoint.

## 5. Legal regimes: GDPR, India DPDP Act + Rules + CERT-In, Canada PIPEDA + Quebec Law 25

### Takeaway
India: the DPDP Rules were notified on 13 Nov 2025 and commence in phases. The definitional and Board rules apply immediately, consent-manager registration applies after 1 year (about Nov 2026, i.e. now), and the substantive duties apply after 18 months (about May 2027). Those duties include security safeguards, 72-hour breach reports to the Board, retention limits, and notice and consent. CERT-In's 6-hour incident reporting and 180-day in-India log retention have applied since June 2022. Both bind a PMS vendor operating in India. Canada: PIPEDA requires reporting of breaches with real risk of significant harm and a 24-month breach record. Quebec's Law 25 adds a privacy impact assessment before data leaves Quebec, a confidentiality-incident register, and much larger penalties. Under DPDP the hotel is the data fiduciary and the PMS is a processor, so the hotel carries the statutory duties and pushes them onto the vendor by contract.

### Cited Findings
**India: DPDP Act 2023 and DPDP Rules 2025**
- Rules notified by MeitY on 13 November 2025. Rules 1, 2 and 17–21 commence immediately. Rule 4 (consent manager registration) commences after 1 year. Rules 3, 5–16 and 22–23 commence 18 months after publication. — [ILF Law: DPDP Rules 2025 notified](https://www.ilflaw.com/publications/digital-personal-data-protection-rules-2025-notified/); [MediaNama](https://www.medianama.com/2025/11/223-data-breach-reporting-timeline-of-dpdp-rules-2025-explained/)
- One summary gives consent manager registration in Nov 2026 and obligations and penalties from 13 May 2027. Sources differ slightly (13 vs 14 Nov 2025 notification). — [Glocert DPDP timeline](https://www.glocertinternational.com/resources/guides/dpdp-rules-2025-compliance-timeline/); [Cy5](https://cy5.io/blog/dpdp-rules-2025-complete-compliance-guide-cloud-security/)
- Rule 6 security safeguards apply to data held by the fiduciary **including data handled by any Data Processor**: encryption, obfuscation, masking or tokenisation; access controls; logging and monitoring; backups. Logs and personal data must be kept **at least one year** for detecting unauthorised access unless law requires otherwise. Processor contracts must carry security obligations. — [ILF Law](https://www.ilflaw.com/publications/digital-personal-data-protection-rules-2025-notified/); [MediaNama](https://www.medianama.com/2025/11/223-data-breach-reporting-timeline-of-dpdp-rules-2025-explained/)
- Rule 7 breach: notify the Board and each affected Data Principal "without delay". Send a detailed report to the Board within **72 hours** (cause, mitigation, findings on the person responsible, notifications sent). The Board can extend on written request. There is **no risk threshold**, so all breaches are notifiable. — [MediaNama](https://www.medianama.com/2025/11/223-data-breach-reporting-timeline-of-dpdp-rules-2025-explained/); [Cy5](https://cy5.io/blog/dpdp-rules-2025-complete-compliance-guide-cloud-security/)
- Rule 8 retention: erase when the purpose is served or consent is withdrawn, unless law requires retention. Third-Schedule classes (large e-commerce, online gaming; social media per other summaries) get a 3-year inactivity cap and a 48-hour pre-erasure notice. Hotels are not named as a class in the sources read. — [ILF Law](https://www.ilflaw.com/publications/digital-personal-data-protection-rules-2025-notified/)
- Cross-border (Rule 15): there is no general localisation. The Government may restrict transfers to notified countries. Significant Data Fiduciaries need an India-based DPO, an independent data auditor and annual DPIAs. — [ILF Law](https://www.ilflaw.com/publications/digital-personal-data-protection-rules-2025-notified/)
- Penalties: up to ₹250 crore for failing reasonable security safeguards, and up to ₹200 crore for failing to report a breach. — [MediaNama](https://www.medianama.com/2025/11/223-data-breach-reporting-timeline-of-dpdp-rules-2025-explained/)
- DPDP and CERT-In reporting are not harmonised. Industry asked for harmonisation. — [MediaNama](https://www.medianama.com/2025/11/223-data-breach-reporting-timeline-of-dpdp-rules-2025-explained/)

**India: CERT-In Directions (28 April 2022, in force 27 June 2022)**
- Issued under s.70B(6) of the IT Act. They cover service providers, intermediaries, data centres, **body corporates** and government. Specified incident types must be reported **within 6 hours** of noticing or being told. — [Linklaters](https://linklaters.com/insights/blogs/digilinks/2022/may/india-new-and-onerous-cyber-security-framework-and-breach-reporting-obligations); [Internet Society brief](https://www.internetsociety.org/wp-content/uploads/2022/06/IIB-India-CERT-In-Directions-2022.pdf)
- ICT system logs must be kept securely for a **rolling 180 days within Indian jurisdiction** and produced to CERT-In on request. Clocks must be synchronised to NIC/NPL NTP (flagged as overbroad by ISOC). Cloud suppliers should be able to supply 180-day logs. — [Internet Society brief](https://www.internetsociety.org/wp-content/uploads/2022/06/IIB-India-CERT-In-Directions-2022.pdf); [KPMG India](https://assets.kpmg.com/content/dam/kpmg/in/pdf/2022/07/cyber-security-incident-response.pdf)
- The CERT-In FAQs (May 2022) clarified scope. Initial 6-hour reports may be preliminary. — [Mondaq: 6 hours to report](https://www.mondaq.com/india/it-and-internet/1270332/6-hours-to-report-cyber-incidents-to-cert-in)

**Canada: PIPEDA**
- Report to the OPC breaches of security safeguards involving personal information that pose a "real risk of significant harm" (RROSH), based on sensitivity and probability of misuse. Notify individuals as soon as feasible. — [OPC: mandatory breach reporting](https://priv.gc.ca/en/privacy-topics/business-privacy/safeguards-and-breaches/privacy-breaches/respond-to-a-privacy-breach-at-your-business/gd_pb_201810/)
- Keep records of **every** breach, RROSH or not, for **24 months** after the day the organisation determines the breach occurred. — [Breach of Security Safeguards Regulations SOR/2018-64](https://gazette.gc.ca/rp-pr/p2/2018/2018-04-18/html/sor-dors64-eng.html); [OPC](https://priv.gc.ca/en/privacy-topics/business-privacy/safeguards-and-breaches/privacy-breaches/respond-to-a-privacy-breach-at-your-business/gd_pb_201810/)

**Canada: Quebec Law 25**
- A privacy impact assessment is required **before** personal information leaves Quebec, including to other provinces or the US. It weighs sensitivity, purpose, safeguards (including contract terms) and the destination's legal regime. If the destination is inadequate, the transfer needs added contractual measures. — [CFIB: Quebec Law 25](https://cfib-fcei.ca/quebec-law-25); [OneTrust: Bill 64](https://OneTrust.com/blog/quebecs-bill-64-adopted/)
- Every enterprise must keep a **register of confidentiality incidents** (all incidents, not only notifiable ones). Guidance says to keep it at least five years. The register goes to the CAI on request. — [LégisQuébec P-39.1](https://www.legisquebec.gouv.qc.ca/en/document/cs/P-39.1%20/20230630); [Fasken guide](https://www.fasken.com/-/media/358f0370eeb443c182b27da974204fd1.pdf)
- Penalties: up to C$25M or 4% of worldwide turnover under Law 25, versus up to C$100,000 per violation under PIPEDA. — [TrustArc: Quebec Law 25](https://trustarc.com/regulations/quebec-law-25/)

**EU: GDPR (vendor practice)**
- Vendors publish Art. 28 DPAs and sub-processor lists, and commit to notifying before adding sub-processors: Mews ([sub-processors](https://www.mews.com/en/legal/mews-sub-processors), [DPA](https://www.mews.com/en/legal/data-processing-addendum)); Cloudbeds ([DPA](https://www.cloudbeds.com/legal/dpa)).

### Inferences
- **Legal versus expected (India):** the hotel is the fiduciary. A PMS vendor is a processor and has no direct DPDP statutory duties. It will, however, be contractually bound to Rule 6 safeguards, to fast breach notice (it must beat the hotel's "without delay" and 72-hour clocks), to erasure on instruction, and to one-year log retention. CERT-In, by contrast, applies **directly** to the vendor as a body corporate and service provider: 6-hour reporting, 180 days of logs kept in India, and NTP sync. This is a law-level requirement before the first Indian hotel, not a buyer nicety. A vendor whose logs live only in a non-Indian region (for example Cloudflare's global logs) needs an India-located log copy or a documented position.
- DPDP's substantive rules land around May 2027, so a vendor shipping now should design to them already: hotel-configurable retention, erasure with legal-hold exceptions, breach runbook, processor contract template.
- The GDPR Art. 33 (72 h to the supervisory authority) and Art. 28 (processor contract) requirements were not re-verified in this session, but they align with the vendor DPAs above.
- **Canada:** hosting Quebec hotels' data outside Quebec (even in Toronto) technically triggers a Law 25 transfer assessment by the **hotel**. Vendors help by supplying a "transfer impact" pack: hosting locations, sub-processors, safeguards.

### Gaps
- The official MeitY gazette text of the DPDP Rules was not read directly. Rule numbers and exact commencement dates are from law-firm summaries.
- No source was found on whether DPDP Rules require a processor to notify the fiduciary within a fixed time.
- The CERT-In list of reportable incident types and the exact clock-sync text were not retrieved from primary text.
- Whether any 2025–2026 CERT-In update changed the 6-hour or 180-day terms was not checked.
- Quebec Law 25's 72-hour or "promptly" notification wording and the CAI reporting form were not retrieved.

## 6. Trust centres: what vendors publish

### Takeaway
The mature model, Mews, is a dedicated trust centre (trust.mews.com) with certification badges, public certificates, a public sub-processor list and versioned DPAs, and gated SOC 2 and pen-test documents behind a request form. Others publish a static security page plus a PCI statement and DPA. SiteMinder's PCI responsibility matrix is a notable artefact. No vendor's public status/uptime history was examined.

### Cited Findings
- Mews: badges for ISO 27001, SOC 2 and PCI DSS, with documents gated behind a request form. The ISO certificate PDF is public. The sub-processor list is public. Partner DPA policies are versioned (v2.1 April 2021 through v3.4 March 2026, with v3.5 pending). — [Mews Trust Center](https://trust.mews.com/); [Mews ISO certificate](https://www.mews.com/hubfs/eBooks/ISO-27001-2024-2027.pdf); [Mews partner policy v3.4](https://www.mews.com/en/legal/data-processing-transfer-policy-partners)
- Cloudbeds: a security page (AWS, TLS, AES-256, PCI via VikingCloud), DPA pages and a help-centre article on PCI. The pages are inconsistent with each other. — [Cloudbeds security](https://www.cloudbeds.com/security/); [Cloudbeds Help PCI](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/227167088-Cloudbeds-Security-Features-and-PCI-DSS-Certification)
- SiteMinder: a legal data-security page and a published PCI DSS Responsibility Matrix. — [SiteMinder data security](https://www.siteminder.com/legal/data-security/)
- Stayntouch: a security guide in its support portal. — [Stayntouch Security Guide](https://stayntouch.freshdesk.com/support/solutions/articles/24000100318-stayntouch-security-guide)
- Hotelogix: an "enterprise-grade security" marketing page. — [Hotelogix security](https://hotelogix.com/enterprise-grade-security-hlxe)
- Third-party aggregators track vendor sub-processor lists (e.g. trustlists.org lists Mews). — [trustlists.org Mews](https://trustlists.org/company/mews/)

### Inferences
- A minimum credible trust page for a young vendor: a security overview (hosting, encryption, access control, backups and RPO/RTO), the PCI scope statement and the PSP's AOC, a DPA, a sub-processor list with change notice, a vulnerability-disclosure contact, and a status page. A SOC 2 report and pen-test summary go behind NDA once they exist. Trust-centre SaaS (Vanta, Drata, SafeBase and similar) is how Mews-style gating is usually done. That is general industry knowledge, not verified here.

### Gaps
- Public pen-test summaries, bug-bounty programmes and status-page/uptime histories were not found or examined for any vendor.
- Apaleo's and Oracle Hospitality's trust pages were not examined.

## 7. Guest data rights: erasure and export from hotel to vendor; legal retention versus erasure

### Takeaway
Hotels are controllers (GDPR) or fiduciaries (DPDP), and PMS vendors are processors acting on instructions. Erasure and export requests flow from guest to hotel to vendor, through PMS tooling or DPA terms. Erasure is always bounded by statutory retention: tax invoices (India CGST 72 months; EU commonly 6–10 years), foreigner registration (India Form C, now Form III, filed within 24 h), and breach logs. The pattern is to anonymise or redact identity while keeping the legally required financial and registration records.

### Cited Findings
- Mews is a processor for PMS data and a controller only for voluntary Guest Portal data. Partners must process only on documented instructions. — [Mews Help: GDPR compliance](https://help.mews.com/s/article/gdpr-compliance); [Mews partner policy v3.4](https://www.mews.com/en/legal/data-processing-transfer-policy-partners)
- Cloudbeds acts as processor appointed by the client, with flow-down to sub-processors. — [Cloudbeds DPA](https://www.cloudbeds.com/legal/dpa)
- GDPR Art. 17(3)(b): erasure does not apply where processing is needed for a legal obligation under **EU or Member State law**. Hotel invoice records are governed by tax and commercial law, commonly 6–10 years. Storage limitation still applies per data category. — [gdpr-info.eu Art. 17](https://gdpr-info.eu/art-17-); [HOTREC data-protection guidelines (via HotellerieSuisse)](https://hotelleriesuisse.ch/fileadmin/user_upload/documents/01_Leistungen___Support/02_Recht/01_Rechtsangebote/Rechtsfragen_A-Z/D-1017-246-MM-_Note_Data_Protection_-_HOTREC_guidelines.pdf); [AHLA GDPR for Hospitality](https://ahla.com/sites/default/files/GDPR%20for%20Hospitality.pdf)
- The EDPB's 2025 Coordinated Enforcement Framework focused on the **right to erasure** (report published 2026), so erasure handling is an active enforcement topic. — [EDPB CEF 2025 right to erasure annex](https://www.edpb.europa.eu/system/files/2026-02/edpb_cef-report_2025_right-to-erasure_annex_en.pdf)
- India CGST s.36: keep accounts and records for **72 months** from the due date of the annual return for that year, longer if proceedings are pending. — [CGST Act (India Code)](https://indiacode.nic.in/bitstream/123456789/15689/5/A2017-12.pdf); [TaxGuru](https://taxguru.in/goods-and-service-tax/accounts-records-maintained-gst-sec-35-36-rules-56-58-cgst-act.html)
- DPDP Rule 8: erase when the purpose is served or consent is withdrawn, **unless retention is required by law**. Rule 6 requires at least one year of logs. — [ILF Law](https://www.ilflaw.com/publications/digital-personal-data-protection-rules-2025-notified/)
- India foreigner registration: under the Immigration and Foreigners Act 2025 (in force 1 Sep 2025) and Rules 2025, Rule 17 requires accommodation providers to submit Form III (formerly Form C) electronically within 24 h of arrival, and departure details within 24 h. Rules were amended on 1 June 2026. — [Sentinel Assam](https://www.sentinelassam.com/topheadlines/new-immigration-rules-ease-timelines-for-foreigners-mandate-24-hour-reporting-and-online-appeals); [Immigration and Foreigners Rules 2025 PDF](https://www.thc.nic.in/Central%20Governmental%20Rules/Immigration%20and%20Foreigners%20Rules,%202025..pdf); [Eastern Mirror](https://www.easternmirrornagaland.com/immigration-act-2025-dimapur-police-direct-24-hour-reporting-of-foreigners-by-hotels-hospitals); [GKToday: rules revised](https://www.gktoday.in/government-revises-immigration-and-foreigners-rules-2025/)
- PIPEDA breach records: 24 months. Quebec incident register: guidance says at least 5 years. — [SOR/2018-64](https://gazette.gc.ca/rp-pr/p2/2018/2018-04-18/html/sor-dors64-eng.html); [Fasken](https://www.fasken.com/-/media/358f0370eeb443c182b27da974204fd1.pdf)

### Inferences
- A PMS erasure flow should be **"erase identity, keep the legal record"**: crypto-shred or anonymise guest profile PII, and retain invoices or folios with the minimum legally required fields under a legal-hold flag tied to jurisdiction (CGST 72 months; EU state law). Keep foreigner-registration records for whatever period the Immigration and Foreigners Rules prescribe (unknown; see Gaps). The erasure response to the hotel should list what was kept and why, since the EDPB CEF 2025 focus makes this auditable.
- Export (portability or access) is a hotel duty, so the vendor needs a hotel-operated per-guest export. Marketplace apps that received copies of guest data must be told to erase too. Apaleo's "offboarding" obligation and the Mews partner policy are the contractual hooks, but no vendor was found propagating erasure to partner apps automatically.

### Gaps
- The retention period for Form III / foreigner records under the Immigration and Foreigners Rules 2025 was not found.
- No vendor's documented API or webhook for propagating guest erasure to marketplace partners was found.
- Mews' anonymisation mechanics and default retention were not retrieved.
- DPDP rights-request response timelines (some summaries cite 90 days) were not confirmed.

## 8. What a small vendor needs: required by law versus expected by buyers; first paying hotel versus groups

### Takeaway
Before the first paying hotel, the legal minimum is narrow. It includes a processor contract/DPA, reasonable security safeguards, a breach process that meets the hotel's clocks, and staying out of card-data scope through a PSP. In India, the CERT-In 6-hour reporting and 180 days of logs in India also apply directly. Certifications (SOC 2 Type 2, ISO 27001), trust centres, sub-processor portals, pen tests and residency options are **buyer expectations** that become gating when selling to groups and chains.

### Cited Findings
- No law mandates SOC 2 or ISO 27001. They appear in vendor trust programmes as market signals (Mews ISO + SOC 2 Type 2; Stayntouch only SOC 2 Type 1; Cloudbeds no SOC 2 found). — [Mews Trust Center](https://trust.mews.com/); [Stayntouch article](https://www.stayntouch.com/articles/?p=278); [Cloudbeds security](https://www.cloudbeds.com/security/)
- Law requires processor terms (DPDP Rule 6 contractual security obligations on processors; GDPR Art. 28-style DPAs as published by Mews and Cloudbeds). — [ILF Law](https://www.ilflaw.com/publications/digital-personal-data-protection-rules-2025-notified/); [Mews DPA](https://www.mews.com/en/legal/data-processing-addendum); [Cloudbeds DPA](https://www.cloudbeds.com/legal/dpa)
- PCI DSS applies to anyone storing, processing or transmitting cardholder data, or able to affect its security. Using PSP-hosted iframe fields reduces the merchant (hotel) side to SAQ A, but the PSP and service-provider duties remain. — [PCI SSC SAQ A FAQ](https://blog.pcisecuritystandards.org/faq-clarifies-new-saq-a-eligibility-criteria-for-e-commerce-merchants); [Adyen SAQ A](https://docs.adyen.com/development-resources/pci-dss-compliance-guide/saq-a-eligibility)
- CERT-In applies to body corporates and service providers: 6-hour reports and 180 days of logs in India. — [Internet Society brief](https://www.internetsociety.org/wp-content/uploads/2022/06/IIB-India-CERT-In-Directions-2022.pdf)
- Groups and chains expect hotel-side audit and revocation of integrations (OHIP Analytics tab plus disconnect) and a regional choice of hosting (OPERA Cloud regional data centres; Mews EU/US). — [Oracle partner FAQ](https://www.oracle.com/a/ocom/docs/industries/hospitality/partner-innovation-enablement-faq.pdf); [OPERA Cloud network datasheet](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.2/ocsnc/network.pdf); [Mews sub-processors](https://www.mews.com/en/legal/mews-sub-processors)

### Inferences
**Before the first paying hotel (independent property), largely law-driven:**
1. A hotel-facing DPA, with the vendor as processor: instructions-only processing, confidentiality, sub-processor list with change notice, breach notice to the hotel within hours (to serve DPDP "without delay"/72 h and GDPR 72 h), assistance with rights requests, deletion or return at end of contract.
2. Card data out of scope: PSP-hosted fields or tokens only, never PAN in logs or DB, and the PSP's AOC on file. Document which PCI role the vendor holds.
3. India: CERT-In readiness, meaning an incident-reporting runbook with a 6-hour clock, 180 days of ICT logs retrievable within India, and NTP sync. Plus DPDP-ready design (safeguards, one-year logs, erasure with legal holds) ahead of the ~May 2027 commencement.
4. A breach register (PIPEDA requires 24 months; Quebec requires a register) if any Canadian hotel signs.
5. A basic public security page and a vulnerability contact.

**Before selling to groups and chains, mostly buyer-driven:**
1. SOC 2 Type 2 (often requested first by US buyers) and/or ISO 27001 (EU/APAC buyers). A Type 1 is a stop-gap (the Stayntouch pattern).
2. A trust centre with gated reports, an annual third-party pen test with a summary, and a status page with uptime history.
3. Residency options or at least documented hosting regions per tenant (EU, India, Canada). Quebec chains will run a Law 25 transfer PIA on the vendor.
4. Group-level authorisation and SSO, per-property scoping, audit logs of staff and partner access, and a partner marketplace with certification, scoped OAuth, hotel-visible connected-apps analytics and one-click revoke.
5. A written API versioning and deprecation policy (benchmark: Mews' 6/12-month notice).

### Gaps
- No primary survey data was found quantifying how often hotel groups require SOC 2 versus ISO 27001 in RFPs. The ordering above is inference.
- No source states whether CERT-In's 180-day in-India log rule is satisfied by a foreign-hosted log store that can be produced on demand. Legal advice is needed.
