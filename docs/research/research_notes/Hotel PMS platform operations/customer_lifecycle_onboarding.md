# Hotel PMS customer lifecycle: provisioning, onboarding, support and offboarding

Research date 2026-11-22. Vendors covered: Cloudbeds, Mews, Apaleo, Stayntouch, Oracle OPERA Cloud, Hostaway (vacation rental), eZee / Yanolja Cloud Solution, Hotelogix, Djubo. Most usable sources are vendor help centres, vendor terms and vendor marketing. Timelines in vendor marketing are vendor claims and are flagged as such. Two Oracle pages (consulting-journey PDF, remote-implementation page) returned HTTP 403 and could not be read. A Hostaway job posting returned 404.

## 1. Self-serve sign-up versus sales-led; what a guided setup covers

### Takeaway
None of the nine vendors offers a true credit-card self-signup for the full PMS in 2026. Everyone sells through a demo or quote. "Self-serve" exists only at the configuration step: Mews Classic and Cloudbeds let the hotel do the setup itself against a dashboard or checklist, and Apaleo gives a free trial account whose property starts in a resettable Test status. eZee is the only one with a published free trial for hotels (14 days, per an aggregator).

### Cited Findings
- **Cloudbeds**: pricing page asks for room count and leads to a quote. Capterra India and SaaSworthy list no free trial and no free version. A competitor blog says a $250 demo credit is the closest thing to a trial. Cloudbeds' pricing material says onboarding "can take place on a self-serve basis or with an Onboarding coach, your choice." — [Cloudbeds pricing](https://cloudbeds.com/property-management-system/pricing); [Capterra India](https://www.capterra.in/software/158839/cloudbeds); [SaaSworthy](https://www.saasworthy.com/product/cloudbeds/pricing); [Roommaster blog (competitor)](https://www.roommaster.com/blog/cloudbeds-pricing)
- **Mews**: the pricing page shows "Get Pricing" / "Request a quote" for every tier, Essentials included, and the demo page starts with a 30-minute call with a Mews expert. No checkout or free trial was found. Essentials is pitched at "independent hotels who prioritize efficiency and cost savings". — [Mews pricing](https://www.mews.com/pricing); [Mews Essentials plan](https://help.mews.com/s/article/Understanding-the-Essentials-pricing-plan); [Mews small hotels](https://www.mews.com/en/solutions/small-hotel-management-software)
- **Mews Classic onboarding is configuration self-service**: "You do most of the setup yourself, with step-by-step guidance." An onboarding dashboard splits configuration into required, recommended and optional tasks, with an intro video, sample configurations by region, in-app tips and Mews University. At kick-off the hotel assigns an owner per area (finance, bookable services, spaces, integrations, revenue management), each with a weekly time estimate from about 15 min ("Know Your Business") to 8 h (bookable services). — [Mews Classic package](https://help.mews.com/s/article/What-is-the-Classic-onboarding-package-for-Mews-Operations)
- **Mews in-app guide**: Mews Community describes a "digital wizard companion" for onboarding. Only the title was seen, not the content. — [Mews Community](https://community.mews.com/onboarding-45/meet-your-digital-wizard-companion-888)
- **Apaleo trial and test property**: the terms entitle each customer to one trial. In the trial, customers "may not enter any personal data … other than their own" and must use fictitious data. Apaleo gives no availability guarantee for the trial, either side can end it at any time without notice, and the account is blocked after expiry. — [Apaleo T&C §2.11, §4.1, §5.2, §7.2, §14.6](https://apaleo.com/terms-conditions)
- **Apaleo property lifecycle**: a new property starts in **Test** status. While in Test, the hotel can reset it, deleting all transactional data (reservations, folios, payments, charges) while setup (units, unit groups, rate plans) stays. Go-live means switching to **Live** in Settings → Property. Properties are created from the Account context. — [Apaleo help: test status](https://apaleo.zendesk.com/hc/en-us/articles/4403408049554); [Apaleo help: create a property](https://apaleo.zendesk.com/hc/en-us/articles/360008033260-Create-a-property)
- **Apaleo developer sandbox**: developer accounts are free, and Apaleo Pay comes pre-configured on every developer account with test card numbers. — [apaleo.dev Pay setup](https://apaleo.dev/guides/pay-integration/setup.html); [apaleo.dev store listing](https://apaleo.dev/guides/apaleo-store/listing-your-app)
- **Apaleo commercial go-live is contractual**: go-live is the date the customer is "first technically enabled to use the Platform". Services are deemed live, and fees fall due, "no later than 3 months after the Effective Date" of the order form if the customer causes the delay. — [Apaleo T&C §8.1–8.4](https://apaleo.com/terms-conditions)
- **Stayntouch**: sales-led. After contract, Stayntouch sends a welcome email and invoice, and the kick-off call is scheduled only after the initial invoice is paid. Configuration uses an "Auto-Configurator Tool" fed by a standardized Excel worksheet, which Stayntouch says cuts setup for an average hotel "from 2-3 days to a few hours". — [Stayntouch onboarding outline](https://stayntouch.freshdesk.com/support/solutions/articles/24000013054-stayntouch-pms-onboarding-detailed-outline)
- **eZee Absolute**: a deals aggregator lists a 14-day free trial reached from the eZee site, plus a "personalized free trial with your own hotel data". GoodFirms also lists a 14-day trial. No eZee documentation on a setup wizard was found. — [subscribed.fyi](https://subscribed.fyi/?p=135960); [GoodFirms](https://www.goodfirms.co/software/ezee-absolute)
- **Hotelogix**: its FAQ refers to a free trial with "no set-up fees, no software cost, no training cost, no technical support cost". — [Hotelogix FAQ](https://hotelogix.com/faq)
- **Djubo**: "No free trial", replaced by "a full live demo with a specialist using realistic data". Sales go through sales@ or demo@ addresses, and no self-signup is documented. — [Djubo llms-full.txt](https://www.djubo.com/llms-full.txt)
- **Hostaway**: the pricing page is a quote form. — [Hostfully vs Hostaway (competitor page)](https://www.hostfully.com/hostfully-vs-hostaway/)
- **Cloudbeds first-session content**: the coach-led "prepare for kickoff" step gathers property details, room types, images, policies, taxes, fees, reservation sources and staff information. Cloudbeds publishes a set of discovery questions for kick-off calls. — [Cloudbeds onboarding](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/360041220954-What-to-expect-during-Cloudbeds-onboarding); [Cloudbeds discovery questions](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/32554816005147-General-discovery-questions-for-onboarding-kick-off-calls)

### Inferences
- The market pattern is "sales-led purchase, then self-serve or assisted configuration." The configuration checklist (property profile, room types/units, rates, taxes, policies, users, payment gateway, channel mapping, integrations, then audit) is effectively the same across Cloudbeds, Mews and Stayntouch.
- Apaleo's Test → Live property status, with a reset that wipes transactions but keeps setup, is the cleanest published model for a pre-go-live sandbox inside the production tenant.
- A spreadsheet-driven auto-configurator (Stayntouch) is the enterprise-grade alternative to a click-through wizard.

### Gaps
- No vendor publishes screenshots or a step list for a first-login setup wizard. Mews' "digital wizard companion" content was not read.
- Whether eZee's trial includes a self-configuration wizard is unconfirmed.

## 2. Implementation: time to live, fees, who configures, checklists and milestones

### Takeaway
For an independent hotel, vendor-stated time to live ranges from 2–3 days (Hotelogix), 7–14 working days (Djubo) and 1–3 weeks (Mews Classic) up to 3–8 weeks (Cloudbeds) and about 8 weeks (Stayntouch). Complex or group properties take 5–7 weeks (Mews Custom), 30–45 days per portfolio (Stayntouch) or a phased or "big bang" programme (OPERA). Vendor staff (coach, implementation consultant or manager) usually guide, but the hotel enters most of the configuration. Partners matter mainly for OPERA and Apaleo.

### Cited Findings
**Cloudbeds**
- Seven stages: prepare for kickoff → kickoff call (milestones, go-live target) → setup and configuration → **audit** with coach → go live → **hypercare** (first 10 days, check-ins on Day 2 and Day 9) → adoption and optimization. A dedicated Onboarding Coach leads, and some customers get more than one coach depending on services purchased. — [Cloudbeds onboarding](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/360041220954-What-to-expect-during-Cloudbeds-onboarding)
- Customer duties: complete checklist items on time, attend sessions, make operational decisions, complete assigned configuration tasks, create OTA accounts, test reservations and workflows, and set staff access before go-live. — same source
- The Onboarding T&Cs **exclude** configuring OTAs and third-party apps, "obtaining information from the property's PMS", website changes, **reservation import (sold separately)** and **additional training (sold separately)**. The coach inputs base rates the property supplies, the account owner enters sensitive data such as card details, and "Projected timelines are approximate." — [Cloudbeds Onboarding T&Cs](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/360050401814-Onboarding-Terms-and-Conditions)
- Marketing claims: customers typically go live in 3–8 weeks, and a switch from OPERA can take as little as three weeks. — [Cloudbeds implementation guide](https://cloudbeds.com/hotel-management-software-guide/implementation); [Cloudbeds what to expect](https://cloudbeds.com/what-to-expect)

**Mews** (three published packages; the 30-day intensive-support window applies to all)
- **Classic**: online, mainly for the Essentials plan or expansions, 1–3 weeks to live ("as fast as 1 week"). Includes live chat with onboarding experts, bookable calls and 24/7 AI chat. The steps are kick-off email → onboarding dashboard → go-live checklist plus a **required audit with a Mews expert** → surveys at 7/30/60 days. Estimated hotel time: about 24 h system configuration, 2–8 h Mews University per learning path, about 4 h channel-manager mapping and testing, about 4 h third-party integrations, about 8 h reservation import. — [Mews Classic](https://help.mews.com/s/article/What-is-the-Classic-onboarding-package-for-Mews-Operations)
- **Classic Plus**: for Advanced, Traveler or Long Stay plans, 2–4 weeks. — [Mews Classic Plus](https://help.mews.com/s/article/What-is-the-Classic-Plus-onboarding-package-for-Mews-Operations)
- **Custom**: for Enterprise PMS properties and pilot properties on the Brand or Portfolio packages. Hybrid delivery, 5–7 weeks, a designated onboarding consultant who co-designs the plan and training, and optional **paid** 2-day or 4-day onsite visits. — [Mews Custom](https://help.mews.com/s/article/What-is-the-Custom-onboarding-package-for-Mews-Operations)
- The system audit takes up to 3 business days, so hotels should plan for it before the go-live date. — [Mews Onboarding System Audit](https://help.mews.com/s/article/Mews-Onboarding-System-Audit)
- A Mews blog says average contract-to-full-operation is about two months. Some hotels are live within a week and others take months. — [Mews blog: painless PMS switch](https://www.mews.com/en/blog/painless-pms-switch)
- Mews case study: Roam Spokane went live in 11 days, covering data import, training and final system checks. — [Mews customer story](https://www.mews.com/en/customers/roam-spokane)
- Package prices are not published on any of the package pages.

**Stayntouch**
- About 6–8 weeks of preparation, with formal PMS go-live in Week 8. Roles: Project Manager, Implementation Consultant and Transition or Client Success Manager on the vendor side; a named **Property Champion** on the hotel side. — [Stayntouch outline](https://stayntouch.freshdesk.com/support/solutions/articles/24000013054-stayntouch-pms-onboarding-detailed-outline)
- Week by week: W1 kick-off, worksheet and 2–4 instructor-led configuration sessions. W2 guest-mobility templates, payment-gateway paperwork and interface-vendor outreach. W3 gateway testing and CRS. W4 interface PC and CRS done, EMV devices arrive. W5–6 Academy eLearning by department, training environment. W6–7 go-live prep call with task owners. W8 go-live. After go-live, dedicated support days and a Transition Manager for 60 days. The source contradicts itself on whether W4 or W8 is the go-live. — same source
- Hotel prerequisites: a dedicated onsite Windows interface PC (no VMs) with firewall port forwarding, 20–30 Mbps download minimum, logo and room images to spec, key-server details, and confirmation of the payment batch time 10 days before go-live (otherwise it defaults to 02:00). Gateway lead times run from contract signing: Stayntouch Pay 7–10 business days, Shift4 6–8 weeks, Planet up to 10 weeks. — same source
- Marketing: "full portfolio configuration in 30 to 45 days". Remote, on-site or combined deployment. Transition managers for independents, client success managers for strategic accounts. — [Stayntouch implementation & support](https://www.stayntouch.com/implementation-support/)
- Group example: Imperial London Hotels migrated seven properties in phases, ending with the 1,379-room Royal National (Stayntouch press release). — [Hospitality Net](https://www.hospitalitynet.org/news/4134473/stayntouch-powers-full-pms-migration-across-imperial-london-hotels-including-the-large)

**Oracle OPERA Cloud** (group-heavy evidence only)
- Thon Hotels (2024): Oracle Consulting recommended its standard phased approach, but Thon chose a "big bang". It moved 96 properties in a 31-hour cutover and finished staff training three weeks before. Oracle now recommends a similar strategy to other groups. — [Oracle: Thon Hotels](https://www.oracle.com/hospitality/thon-hotels-reinvents-oracle-cloud-pms-migration/)
- Germain Hotels: 19 hotels migrated in under 10 hours (about 30 minutes per hotel) using automated data transfer, with a central internal team plus Oracle remote resources rather than Oracle staff on site. — [CIO Review](https://www.cioreview.com/cxoinsight/cloudbased-pms-for-germain-hotels-ticks-all-the-tech-boxes-nid-38228-cid-384.html)
- Wyndham's CIO (2021): hotels can move remotely "in days rather than weeks". Oracle says independents also use its remote implementation route. — [Hospitality Net: Wyndham/Accor](https://www.hospitalitynet.org/news/4107439/wyndham-and-accor-accelerate-their-digital-transformation-with-opera-cloud); [Oracle remote PMS implementation (page 403, snippet only)](https://www.oracle.com/hospitality/hotel-property-management/remote-pms-implementation/)
- OPERA Cloud Foundation is Oracle's tier for economy and limited-service hotels. — [Oracle OPERA Cloud Foundation](https://www.oracle.com/kr/hospitality/hotel-property-management/opera-cloud-foundation-cloud-pms-for-hotels/)
- A third-party OPERA 5 → Cloud plan has six phases (discovery, data clean-up, interface moves, testing, training, cut-over at low occupancy) but gives no week counts. — [chatlyn blog](https://chatlyn.com/en/blog/opera-5-to-opera-cloud-migration/)

**Hostaway (vacation rental)**
- A competitor page and others cite a **$500 onboarding fee** covering all modules. This is not verified on Hostaway's own site. — [Hostfully vs Hostaway (competitor)](https://www.hostfully.com/hostfully-vs-hostaway/); [iGMS Hostaway pricing (competitor)](https://www.igms.com/go/hostaway-pricing/)
- Enterprise Onboarding Specialists "lead complex onboarding implementations for large and strategic customers" through a "structured milestone-based rollout" from kickoff to completion. — [Hostaway careers (via Mediabistro)](https://www.mediabistro.com/jobs/3339479490-enterprise-onboarding-specialist-100-remote-north-america); [Remote First Jobs](https://remotefirstjobs.com/companies/hostaway/jobs/enterprise-onboarding-specialist-760831)
- Migration and setup can be outsourced to partner STR Logic, covering imports, automations, templates, workflows and team training. — [Hostaway support: STR Logic](https://support.hostaway.com/hc/en-us/articles/46874548584347-How-to-connect-with-STR-Logic)
- Reviews mention onboarding calls with a dedicated onboarding expert and describe the onboarding as structured and personalized. — [Software Advice](https://www.softwareadvice.com/property/hostaway-profile/)

**Hotelogix (India HQ, New Delhi)**
- Each client gets an implementation manager and an account manager. The flow is kick-off (scope, legacy system, integrations) → configuration (property parameters, room types, rate plans, **tax IDs**, modules, data migration, integrations) → departmental training plus a **"train the trainer"** programme that certifies a senior staff member → final check → go-live → **7-day hypercare** → handover to the account manager. — [Hotelogix case study, Hospitality Net (vendor-written)](https://www.hospitalitynet.org/casestudy/4133362/switching-hotel-pms-hotelogix-gets-your-properties-live-faster)
- Claimed go-live of 2–3 days for an independent (about 50 rooms, 1 POS, 1 channel manager, 1 booking engine) and 2–3 days per group property. Multi-property groups average 5–6 properties onboarded per month. — same source
- Fees: the FAQ advertises no setup or training fees but separately lists custom training at **US$350/day online**. A third-party listing says a US$350 sign-up fee covers basic setup, training and booking-engine integration. — [Hotelogix FAQ](https://hotelogix.com/faq); [Capterra India](https://www.capterra.in/software/76374/hotelogix)

**Djubo (India)**
- Onboarding takes 7 working days (Growing Hotelier) or 14 working days (Pro, Master). "No setup fee and no onboarding fee." The onboarding team does the full setup, including channel connections, training and go-live support. — [Djubo llms-full.txt](https://www.djubo.com/llms-full.txt)

**eZee / Yanolja Cloud Solution**
- No vendor implementation documentation was found. Aggregators say it is "fairly quick to onboard" and describe free online training. — [Capterra](https://www.capterra.com/p/135751/eZee-Absolute/); [Techjockey](https://www.techjockey.com/detail/ezee-absolute)

**Review-site pattern**
- Hotel Tech Report scores implementation at Cloudbeds 4.5 (about 1,147 reviews) and Mews 4.4 (about 690). Mews reviewers say setup "can be a bit complex", and group reviewers value copying configuration from existing properties when opening new hotels. — [HTR Cloudbeds vs Mews](https://hoteltechreport.com/compare/mews-vs-cloudbeds-myfrontdesk); [HTR Mews review](https://hoteltechreport.com/reviews/n9pwdddz2w85)
- Hotelogix reviews are mixed. One cites implementation gaps and shallow training, and a comparison site notes billing and refund disputes on Trustpilot. — [Capterra India reviews](https://www.capterra.in/reviews/76374/hotelogix); [rfp.wiki](https://www.rfp.wiki/specialty-industries/hospitality-travel/innrow/hotelogix)

### Inferences
- The common milestone spine is: kick-off with a go-live target → configuration → integrations and payment gateway → reservation import test → **pre-go-live audit or checklist** → go-live → **hypercare** (7 days Hotelogix, 10 days Cloudbeds, 30 days Mews, 60 days Stayntouch) → handover to support or account management.
- Payment-gateway underwriting is often the critical path for a US hotel (6–10 weeks for third-party gateways at Stayntouch). An in-house PSP shortens it to days.
- Implementation fees are rarely published. Where figures exist they are small and flat for SMB (Hostaway about $500, Hotelogix about $350) or zero (Djubo). Enterprise work (Mews onsite visits, Oracle Consulting) is billed separately.
- Indian vendors (Hotelogix, Djubo) claim days, not weeks, and do the configuration for the hotel. Western SMB vendors push configuration work onto the hotel.

### Gaps
- No OPERA Cloud timeline or fee for a single independent hotel. The Oracle consulting PDF returned 403.
- No published price for any Mews onboarding package, Cloudbeds' reservation import service, or Stayntouch implementation.
- The Hostaway $500 fee comes only from competitor pages.

## 3. Data migration from a previous PMS

### Takeaway
Vendors migrate **future reservations and profiles**, not history or open financial balances. The standard tools are a reservation importer (Stayntouch Dataloader, Mews reservation import, Cloudbeds' paid Reservation Import Service), a test import before cut-over, and cleaning duplicates first. Open A/R and folio balances are the hard part and are usually re-keyed or carried as opening balances.

### Cited Findings
- **Stayntouch Dataloader** is included in implementation fees for properties cutting over from an existing PMS. It imports company profiles, travel-agency profiles, guest profiles and reservations, including advance-deposit totals. — [Stayntouch outline](https://stayntouch.freshdesk.com/support/solutions/articles/24000013054-stayntouch-pms-onboarding-detailed-outline)
- Stayntouch's guide says to submit import files in test form about a week before migration. It calls outstanding A/R balances among the trickiest items because they "often don't transfer through a standard reservation import". — [Stayntouch: switching to SaaS PMS](https://www.stayntouch.com/blog/how-to-make-the-switch-to-saas-hotel-pms/)
- **Cloudbeds** sells a Reservation Import Service as an add-on, described as moving "inventory, guest data, and reservations". It is not included in standard onboarding. Its implementation guide recommends merging duplicate guest profiles, removing test bookings and outdated records, running a test migration on a subset, using validation checkpoints and keeping a parallel transition window. It also warns that the hotel must decide "what will carry over, what won't, and what needs to be rebuilt". — [Cloudbeds customer success](https://cloudbeds.com/customer-success); [Cloudbeds Onboarding T&Cs](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/360050401814-Onboarding-Terms-and-Conditions); [Cloudbeds implementation guide](https://cloudbeds.com/hotel-management-software-guide/implementation)
- **Mews** budgets about 8 h of hotel time for reservation import in every package. Its blog says importing historic guest profiles is possible but fills a clean system with "tens of thousands of profiles" and inaccurate data, and that Mews "will not import all the history". — [Mews Classic](https://help.mews.com/s/article/What-is-the-Classic-onboarding-package-for-Mews-Operations); [Mews blog: painless PMS switch](https://www.mews.com/en/blog/painless-pms-switch)
- Mews publishes go-live tasks for properties changing PMS and vendor-specific switching guides, such as from Hotel Perfect. — [Mews go-live tasks](https://help.mews.com/s/article/what-are-the-go-live-tasks-for-properties-changing-pms); [Mews: switch from Hotel Perfect](https://mews.com/en/resources/research/switch-pms-guide-hotel-perfect)
- **OPERA**: Germain Hotels used automated data transfer at about 30 minutes per hotel. Thon used a single 31-hour cut-over for 96 hotels. — [CIO Review](https://www.cioreview.com/cxoinsight/cloudbased-pms-for-germain-hotels-ticks-all-the-tech-boxes-nid-38228-cid-384.html); [Oracle: Thon](https://www.oracle.com/hospitality/thon-hotels-reinvents-oracle-cloud-pms-migration/)
- **Hostaway**: migration is offered through partner STR Logic. — [Hostaway support](https://support.hostaway.com/hc/en-us/articles/46874548584347-How-to-connect-with-STR-Logic)
- **Hotelogix** lists data migration as a configuration step with no method given. A Hotel Tech Report figure it cites says 24% of hoteliers see migration complexity as a top barrier. — [Hotelogix case study](https://www.hospitalitynet.org/casestudy/4133362/switching-hotel-pms-hotelogix-gets-your-properties-live-faster)
- **Cloudbeds** excludes "obtaining information from the property's PMS" from onboarding, so the hotel must produce the export. — [Cloudbeds Onboarding T&Cs](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/360050401814-Onboarding-Terms-and-Conditions)

### Inferences
- The minimum viable importer covers future reservations (with deposits paid), guest profiles, and company and travel-agent profiles. Historic stays and closed folios are usually left in the old system or an archive.
- Cut-over practice is a test import about a week out, a final delta import at cut-over, a low-occupancy cut-over date, and a short parallel window. Opening A/R or city-ledger balances need a separate path because reservation imports drop them.
- Extracting data from the old PMS is the hotel's job at Cloudbeds. The losing vendor's export capability is therefore a practical lock-in lever, which feeds into offboarding (section 7).

### Gaps
- No vendor publishes its import CSV template schema in the sources read.
- No source documents how in-house guests, as opposed to future arrivals, are handled at cut-over.

## 4. Training

### Takeaway
Every Western vendor has a branded LMS: Cloudbeds University, Mews University, Stayntouch Academy and Oracle University. Courses are role-based and self-paced, with certification at Stayntouch. Indian vendors rely more on live sessions and train-the-trainer (Hotelogix) or a bundled Moodle LMS (Djubo). In-app guidance is limited to Mews' dashboard tips. No source named WalkMe or Pendo.

### Cited Findings
- **Cloudbeds University**: unlimited access for all customers to hundreds of on-demand courses, 100+ training videos and a knowledge base with hundreds of guides. Extra coach training is sold separately. — [Cloudbeds customer success](https://cloudbeds.com/customer-success); [Cloudbeds Onboarding T&Cs](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/360050401814-Onboarding-Terms-and-Conditions)
- **Mews University**: role-specific learning paths of about 2–8 h. Onboarding dashboard with in-app tips. Live webinars and co-designed training in the Custom package. — [Mews Classic](https://help.mews.com/s/article/What-is-the-Classic-onboarding-package-for-Mews-Operations); [Mews Custom](https://help.mews.com/s/article/What-is-the-Custom-onboarding-package-for-Mews-Operations)
- **Stayntouch Academy (2.0)**: self-paced, chosen by department at registration, with progress tracking and certifications. Modules run about 90 minutes. The vendor claims front desk can be trained in about 2 h and the full PMS in about 2 days. A separate training environment is provided for practice before go-live. — [Stayntouch implementation & support](https://www.stayntouch.com/implementation-support/); [Stayntouch outline](https://stayntouch.freshdesk.com/support/solutions/articles/24000013054-stayntouch-pms-onboarding-detailed-outline); [Academy 2.0 news](https://www.stayntouch.com/news/stayntouch-unveils-academy-2-0/)
- **Hotelogix**: in-person, live online, webinars, documentation and videos. A train-the-trainer programme certifies a senior client staff member. Refreshers on request. Custom training costs US$350/day. — [Hotelogix case study](https://www.hospitalitynet.org/casestudy/4133362/switching-hotel-pms-hotelogix-gets-your-properties-live-faster); [Hotelogix FAQ](https://hotelogix.com/faq)
- **Djubo**: "Staff Training & LMS", a Moodle-based learning system, is included in all packages. — [Djubo llms-full.txt](https://www.djubo.com/llms-full.txt)
- **eZee**: free online training and multiple training sessions, per reviews and aggregators. — [Techjockey](https://www.techjockey.com/detail/ezee-absolute); [Capterra reviews](https://www.capterra.com/p/135751/eZee-Absolute/reviews/?page=7)
- **OPERA**: Thon completed staff training three weeks before its big-bang cut-over. — [Oracle: Thon](https://www.oracle.com/hospitality/thon-hotels-reinvents-oracle-cloud-pms-migration/)

### Inferences
- Training is time-boxed before go-live and runs in parallel with configuration (Stayntouch weeks 5–6). A practice or training environment separate from the live tenant is standard at the mid-market and up.
- Train-the-trainer suits Indian properties with high front-desk turnover and limits vendor training cost.

### Gaps
- No source confirms a WalkMe, Pendo or Userpilot-style digital adoption platform at any of the nine vendors.
- No Oracle University or OPERA Cloud learning-subscription details were retrieved.

## 5. Support model: channels, tiers, SLAs, India and local language, group account management

### Takeaway
Two models dominate. **Tiered paid support** (Mews Standard vs Premium, Cloudbeds Premium add-on, Apaleo support per price list beyond the contract) contrasts with **24/7 included** (Stayntouch, Hotelogix, eZee, Djubo, and Cloudbeds' baseline). Mews publishes the only response-time SLA table found. Stayntouch advertises under-1-hour ticket response at no extra cost.

### Cited Findings
- **Mews SLA v1.5 (20 Mar 2024)**: standard response 4 h for critical, 8 h for high and 24 h for general requests. Premium critical response is 2 h with a 6 h critical resolution. Standard support is tickets via a digital assistant or live agent, the Help Center, Mews University and an emergency helpline for critical issues. — [Mews SLA](https://www.mews.com/en/legal/service-level-agreement); [Mews help: Standard vs Premium](https://help.mews.com/s/article/what-do-standard-premium-support-include)
- **Mews Premium**: adds 24/7 live chat with specialists, a dedicated phone line staffed "by a real person", screen sharing, and a dedicated support team that learns the property. The help article gives critical response within 2 h and other requests within 12 h. Minimum term is 3 months, it is bought in the Mews Marketplace, and it "cannot make any changes on your behalf". — [Mews help](https://help.mews.com/s/article/what-do-standard-premium-support-include); [Mews Premium Support terms v2.0 (5 Jul 2025)](https://www.mews.com/en/legal/premium-support)
- **Cloudbeds**: 24/7 multilingual support with every plan via live chat and email, with phone for in-depth investigations. Premium Support is an add-on for "faster response time and phone support", but no SLA figure was found. Claimed 82% single-contact resolution and 60% of chats resolved in under 20 minutes. Reviews are mixed on speed. — [Cloudbeds customer success](https://cloudbeds.com/customer-success); [Cloudbeds pricing](https://cloudbeds.com/property-management-system/pricing); [GetApp reviews](https://www.getapp.com/hospitality-travel-software/a/cloudbeds/reviews/)
- **Apaleo**: support is included "as part of their original contract", otherwise billed per price list, and runs through ticketing software. Uptime target is 99.5% monthly average, with up to 1 h/week of scheduled maintenance excluded and 7 days' notice. No response times are stated. — [Apaleo T&C §4.2–4.3, §6.4](https://apaleo.com/terms-conditions)
- **Stayntouch**: 24/7 follow-the-sun support, "under 1 hour" ticket response included at no extra cost, seven languages (per HTR as cited by Stayntouch), and an AI chat that escalates to live agents. — [Stayntouch implementation & support](https://www.stayntouch.com/implementation-support/)
- **Hotelogix**: "24x7 live support" by call, chat and email (support@hotelogix.com), with an account manager after go-live. — [Hotelogix FAQ: training and support](https://www.hotelogix.com/faqs/are-training-and-support-included-with-hotelogix); [Hotelogix case study](https://www.hospitalitynet.org/casestudy/4133362/switching-hotel-pms-hotelogix-gets-your-properties-live-faster)
- **eZee**: email, chat and phone, 24x7, per aggregators. The vendor is based in Gujarat (Surat). — [GoodFirms](https://www.goodfirms.co/software/ezee-absolute); [SpotSaaS](https://www.spotsaas.com/product/ezee-absolute/pricing); [IndiaMART](https://m.indiamart.com/ezee-technosys-surat)
- **Djubo**: phone, email and chat in all plans, with WhatsApp listed in contacts. Hours are not stated, and one reviewer reported slow reactions. — [Djubo llms-full.txt](https://www.djubo.com/llms-full.txt); [GetApp AU reviews](https://www.getapp.com.au/reviews/110547/djubo)
- **Hostaway**: reviewers cite support at all hours, live calls and dedicated account managers, though reviews are mixed. — [Software Advice](https://www.softwareadvice.com/property/hostaway-profile/); [Capterra](https://www.capterra.com/p/152433/Hostaway/reviews/)

### Inferences
- An AI or digital-assistant first line with human escalation is now the default at Mews, Stayntouch and Cloudbeds. Paid tiers buy humans on the phone and shorter SLAs, not configuration work: Mews Premium explicitly will not make changes.
- WhatsApp as a support channel appears only at the Indian vendor (Djubo), which fits Indian SMB expectations.

### Gaps
- No vendor documents Hindi or other Indian-language support.
- No published Cloudbeds Premium SLA, and no OPERA Cloud support-tier detail.
- No source shows response-time differences by plan at eZee, Hotelogix or Djubo.

## 6. Customer success: account management, business reviews, health checks

### Takeaway
Named account or success management is reserved for larger accounts: Stayntouch client success managers for strategic accounts, Hostaway enterprise onboarding, and the Mews Custom consultant. SMBs get a time-boxed transition owner (Stayntouch transition manager for 60 days, Cloudbeds coach for 10 days of hypercare) and then pooled support. Hotelogix stands out by assigning an account manager to every client. Business reviews are mentioned only by Cloudbeds, with no cadence given.

### Cited Findings
- Cloudbeds describes a "Customer Growth team" with hospitality experience that offers "ongoing business reviews and best practices". No cadence or eligibility is stated. — [Cloudbeds customer success](https://cloudbeds.com/customer-success); [Cloudbeds customer success (ES)](https://www.cloudbeds.com/es/customer-success/)
- Cloudbeds stage 7, "adoption and optimization", follows hypercare. — [Cloudbeds onboarding](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/360041220954-What-to-expect-during-Cloudbeds-onboarding)
- Mews runs automated health surveys at 7, 30 and 60 days after go-live in every package. — [Mews Classic](https://help.mews.com/s/article/What-is-the-Classic-onboarding-package-for-Mews-Operations)
- Stayntouch has a Transition Manager for 60 days after go-live, transition managers for independents and client success managers for strategic accounts, and advertises a "Dedicated Customer Success Team". — [Stayntouch outline](https://stayntouch.freshdesk.com/support/solutions/articles/24000013054-stayntouch-pms-onboarding-detailed-outline); [Stayntouch implementation & support](https://www.stayntouch.com/implementation-support/)
- Hotelogix assigns an account manager from the start of onboarding. The account manager owns the relationship after the 7-day hypercare. — [Hotelogix case study](https://www.hospitalitynet.org/casestudy/4133362/switching-hotel-pms-hotelogix-gets-your-properties-live-faster)
- Hostaway's enterprise onboarding role targets "large and strategic customers". — [Hostaway job (Mediabistro)](https://www.mediabistro.com/jobs/3339479490-enterprise-onboarding-specialist-100-remote-north-america)

### Inferences
- The lifecycle hand-offs are sales → onboarding (coach or PM) → hypercare → support pool, with an account manager or CSM only above a size threshold. Mews' 7/30/60-day surveys are a low-cost substitute for human health checks at SMB scale.

### Gaps
- No vendor publishes QBR cadence, health-score models or CSM eligibility thresholds. Job postings for CSM roles were not retrieved.

## 7. Offboarding: data export, retention after cancellation, deletion

### Takeaway
Contracts promise deletion after termination but rarely give a day count or a post-termination export window. Mews' DPA requires the hotel to download its data **before** the term ends and lets Mews delete afterwards. Cloudbeds' DPA allows in-term self-service retrieval, deletion "in accordance with the Documentation", and backup retention. Apaleo requires 12-month terms with 3 months' notice and archiving of the account. Indian vendors' terms on export were not found. Djubo's paid subscriptions are non-refundable.

### Cited Findings
- **Mews DPA v3.5 (effective "[1st October 2026]")** §3.6: before the term ends, Mews must "return the Personal Data by enabling the Partner to download it". After the term, Mews "is not required to retain any Partner's data" and "shall delete it from its systems unless its retention is required by applicable law". No day count is given. Deleting data from a "Cluster" (§4.5) and assistance requests (§5.2) are at the partner's cost. — [Mews DPA](https://mews.com/legal/data-processing-addendum)
- Mews Master Terms v5.0 apply to partners contracting on or after 26 Feb 2025. Termination and export clauses were not retrieved. — [Mews Master Terms v5.0 PDF](https://www.mews.com/hubfs/Master%20Terms%20and%20Conditions%20Version%205.0%20Effective%20February%2026-%202025%20.pdf)
- **Cloudbeds DPA** §6.1: during the term, the client can "access, retrieve or delete Client Personal Data" through the Services. §6.2: after termination, Cloudbeds "must, in accordance with the Documentation, delete all Client Personal Data", but may retain data as law requires or "in accordance with its standard backup or record retention policies". No day count is given. — [Cloudbeds DPA](https://www.cloudbeds.com/legal/dpa)
- **Cloudbeds Websites**: cancelling the subscription unpublishes the site immediately, and "site export or data transfer of any kind is not supported". — [Cloudbeds Websites terms](https://www.cloudbeds.com/terms/websites/)
- **Apaleo**: minimum 12-month initial term with automatic 12-month renewal, 3 months' written notice before term end, fees due to term end with no refunds, and good-cause termination preserved. After the paid period, the customer "is obliged to archive the account", otherwise Apaleo may archive it. Confidential information must be destroyed or returned. Export and deletion timing is deferred to a separate DPA, which was not read. — [Apaleo T&C §7.9, §14, §16.3](https://apaleo.com/terms-conditions)
- **Djubo**: "Paid subscriptions are not refundable". Access continues to the end of the paid period after a mid-cycle cancellation. Data export is not described. — [Djubo llms-full.txt](https://www.djubo.com/llms-full.txt)
- **Hotelogix**: a comparison site reports Trustpilot complaints about billing disputes and refunds. — [rfp.wiki](https://www.rfp.wiki/specialty-industries/hospitality-travel/innrow/hotelogix)
- **EU context, not vendor-specific**: UNCITRAL notes that cloud contracts should fix an export window and deletion rules, and that some providers charge for post-contract retention. Other SaaS vendors' EU Data Act addenda show patterns such as a 30-day retrieval window and deletion within 90 days (Klaviyo), or a retrieval period of at least 30 days (Pipedrive). No PMS vendor's Data Act addendum was found. — [UNCITRAL cloud notes: end of service](https://uncitral.un.org/en/cloud/end%20of%20service); [Klaviyo EU Data Act addendum](https://www.klaviyo.com/uk/legal/eu-data-act-addendum); [Pipedrive EU Data Act](https://www.pipedrive.com/en/legal/eu-data-act)

### Inferences
- In practice offboarding means "export it yourself before the term ends". Vendors do not commit to a post-termination grace window in the sources read. A PMS that offers a defined export window (for example 30 days read-only plus a full export) and a deletion certificate would be ahead of these published terms.
- Lock-in comes mainly from commercial terms (Apaleo 12-month auto-renewal with 3 months' notice, Djubo non-refundable) rather than from data-export barriers. Cloudbeds' no-export rule for its website product is the one hard data lock found.

### Gaps
- No Stayntouch, OPERA Cloud, Hostaway, eZee or Hotelogix termination or export terms were retrieved.
- No day counts for deletion at any vendor. Apaleo's DPA was not read.
- No evidence on whether vendors give a full-history export (folios, invoices) in a standard format at exit.

## 8. Sandbox, demo and test properties for customers and training

### Takeaway
Apaleo is the clearest: a trial account, a Test-status property that can be reset, and free developer accounts with a payments sandbox. Stayntouch gives a separate training environment before go-live. Djubo replaces a trial with a specialist-run demo on realistic data. eZee offers a personalized trial with the hotel's own data, per an aggregator.

### Cited Findings
- Apaleo Test status with transactional reset; trial-account rules (fictitious data only, no availability guarantee, one trial per customer); free developer account with Apaleo Pay pre-configured and test cards. — [Apaleo help](https://apaleo.zendesk.com/hc/en-us/articles/4403408049554); [Apaleo T&C](https://apaleo.com/terms-conditions); [apaleo.dev Pay setup](https://apaleo.dev/guides/pay-integration/setup.html)
- Stayntouch provides a training environment for practice in weeks 5–6, before go-live. — [Stayntouch outline](https://stayntouch.freshdesk.com/support/solutions/articles/24000013054-stayntouch-pms-onboarding-detailed-outline)
- Stayntouch also recommends using test environments to check staff comprehension before go-live. — [Stayntouch articles: front desk training](https://www.stayntouch.com/articles/?p=65)
- Djubo offers "a full live demo with a specialist using realistic data" instead of a trial. — [Djubo llms-full.txt](https://www.djubo.com/llms-full.txt)
- eZee offers a "personalized free trial with your own hotel data" (aggregator). — [subscribed.fyi](https://subscribed.fyi/?p=135960)
- Cloudbeds partners get developer onboarding in five steps, which is the partner-side sandbox. — [Cloudbeds developers](https://developers.cloudbeds.com/docs/getting-started-as-a-partner-in-5-steps)

### Inferences
- Two sandbox patterns exist. One is **in-tenant test mode** (Apaleo: the same property is reset and then flipped to Live). The other is a **separate training tenant** (Stayntouch). In-tenant test mode avoids configuration drift between sandbox and production. A separate tenant lets staff keep practising after go-live.

### Gaps
- Not confirmed whether Mews, Cloudbeds or OPERA Cloud give hotels a persistent training property after go-live.

## India specifics (cross-cutting)

### Takeaway
Indian vendors price in INR by room slab, exclude 18% GST from list prices, and promise days-to-live with vendor-done setup. None of the Western vendors publishes INR pricing. No vendor documentation on GST-compliant invoicing of the SaaS fee itself was found.

### Cited Findings
- Djubo prices in INR by room slab (1–10, 11–20, 21–30, 31–50 rooms), with custom chain pricing. Annual billing saves 40% in India against 20% abroad. Indian prices exclude 18% GST. There is no setup or onboarding fee. — [Djubo llms-full.txt](https://www.djubo.com/llms-full.txt)
- eZee Absolute starts at about INR 2,250 per month ("exclusive of all taxes") per Indian aggregators. USD figures elsewhere conflict ($23.86 on Capterra, about $45 on SaaSworthy). — [Techjockey](https://www.techjockey.com/detail/ezee-absolute); [SaaStrac](https://saastrac.com/?p=117896); [Capterra pricing](https://www.capterra.com/p/135751/eZee-Absolute/pricing/); [SaaSworthy](https://www.saasworthy.com/product/ezee-absolute/pricing)
- Hotelogix prices by room count ("very standard"). No INR figures were found, and the company is HQ'd in New Delhi. Tax IDs are an explicit configuration step in its onboarding. — [Hotelogix FAQ](https://hotelogix.com/faq); [Hotelogix case study](https://www.hospitalitynet.org/casestudy/4133362/switching-hotel-pms-hotelogix-gets-your-properties-live-faster)
- Cloudbeds publishes no rupee pricing, and the listing shows personalized quotes. — [Capterra India](https://www.capterra.in/software/158839/cloudbeds)

### Inferences
- An India-first PMS can follow the local pattern: INR room-slab pricing, prices shown excluding 18% GST, a strong annual-prepay discount, vendor-done onboarding in 7–14 working days, and support over WhatsApp, phone and chat.

### Gaps
- No vendor source confirms GST tax-invoice issuance (GSTIN on invoice, place of supply) for the subscription. No Hindi or regional-language support commitments were found.
