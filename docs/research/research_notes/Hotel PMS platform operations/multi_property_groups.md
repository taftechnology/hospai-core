# Multi-property groups: how cloud PMS vendors support chains, groups and portfolio owners

Scope: Cloudbeds, Mews, Apaleo, Oracle OPERA Cloud (+ OPERA Cloud Central / Distribution), Stayntouch, Hotelogix, eZee Absolute (Yanolja Cloud Solution), plus Djubo (India). Research date 2026-11-22. Source quality note: the strongest primary sources are vendor help centres and API docs (Cloudbeds Help Center, Mews Help and Connector API docs, Oracle OPERA Cloud user guides). Stayntouch, Hotelogix, eZee and Djubo evidence is mostly vendor marketing, brochures or review aggregators; it is labelled as such. Several pages (oracle.com OPERA Central product page, apaleo Zendesk) returned HTTP 403 to the fetch tool, so some points rely on search-result summaries of those pages.

## 1. Tenant hierarchy, per-property roles, and single sign-on

### Takeaway
Every vendor models the group as a container of otherwise independent properties ("Organization" in Cloudbeds, "portfolio" plus legally separate "chains" in Mews, "account" in apaleo, "chain" with "hub" locations in OPERA). Per-property roles for one user are standard in Cloudbeds, Mews and apaleo; enterprise SSO/SCIM is only documented as a packaged feature by Mews (Portfolio plan) and is a premium item.

### Cited Findings
**Cloudbeds**
- "If several properties are added to one group, they become an Organization." The Organization page (Account > Settings > Organization) has Profile, Properties, Multi-view and Organization Log tabs; an Organization has its own subdomain with a `/manage` landing page; an Organization must be requested through Cloudbeds Support. Article updated 2026-07-29. — [Cloudbeds: Organizations - Everything you need to know](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/1260803386269-Organizations-Everything-you-need-to-know)
- Organization Users can access multiple properties and "can have the same or different roles in each property"; property-level users are created by the Property Owner and see one property only; only the Organization Owner can deactivate an Org Admin; the Org Owner can be changed only by Cloudbeds Support; credit-card viewing permission must be granted by the Property Owner of each property (updated 2025-11-20). — [Cloudbeds: Organizations FAQ](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/4403591508123-Organizations-FAQ)
- An Organization "does not merge properties or change OTA mapping rules"; each channel listing must be connected to its own Cloudbeds property. — [Cloudbeds: Organizations FAQ](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/4403591508123-Organizations-FAQ)
- The Organization Log is visible to Org Owners, Org Admins and Super Admins; the property permission "View Activity Logs" does not govern it. — [Cloudbeds: Organizations - Everything you need to know](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/1260803386269-Organizations-Everything-you-need-to-know)
- Cloudbeds API docs have a dedicated "Supporting Group Accounts" page for apps serving organizations. — [Cloudbeds Developers: Supporting Group Accounts](https://developers.cloudbeds.com/docs/supporting-group-accounts)

**Mews**
- Two distinct grouping concepts: a **portfolio** (Multi-Property, for central management, e.g. rates and vouchers) and **chains**, which "define legal relationships between enterprises and are used for sharing certain data such as customer profiles." Companies and loyalty programs are filterable by `ChainId`. A **Portfolio Access Token** covers "all of the enterprises or properties within scope of the portfolio"; operations take `EnterpriseId`/`EnterpriseIds` and default to all enterprises in scope. Multi-Property "is not available to all customers" and needs support to issue a portfolio token. — [Mews Connector API: Multi-property](https://docs.mews.com/connector-api/concepts/multi-property)
- Properties can be grouped "by brand, by region, by management"; one company can have several groups. — [Mews: Multi-property management](https://mews.com/en/products/multi-property-management)
- **Central users** have "Admin permissions across all properties in your portfolio" and manage the multi-property account; **property users** access only assigned properties and cannot access the multi-property account. **Central roles** are defined once in the multi-property account and appear in every property; **local roles** exist in one property only. A user can hold different roles at different properties (all active roles listed per property). Removing a property user from the multi-property account removes them from all properties. User and role lists export to Excel for audits. — [Mews Help: Understanding users and role management in Mews Multi-Property](https://help.mews.com/s/article/Understanding-users-and-role-management-in-Mews-Multi-Property)
- The Mews **Portfolio** plan bundles "SSO and user provisioning: single sign-on, SCIM for automated user management, centralized roles and permissions, bulk user creation, and compliance and auditing tools." — [Mews Help: Understanding the Portfolio pricing plan](https://help.mews.com/s/article/Understanding-the-Portfolio-pricing-plan)

**apaleo**
- apaleo supports only predefined roles (no custom roles). "Account Admin" has full permissions across the account, including inviting/deactivating users; a property-limited admin role has near-identical rights but for a single property and cannot invite users; the UI shows "assigned user roles per property," changeable at any time. (Search-result summary; page returned 403 to direct fetch.) — [apaleo Help: User Roles](https://apaleo.zendesk.com/hc/en-us/articles/360001498771-User-Roles); [apaleo Help: User management](https://apaleo.zendesk.com/hc/en-us/articles/360001424611-User-management)
- Properties within an account are listed via `GET /inventory/v1/properties`; the accounting guide maps each property to an accounting organisation. — [apaleo dev: Map property and accounts](https://apaleo.dev/guides/business-cases/finance-management/mapping.html)
- The Settings API is described as account- and property-level configuration. — [api.apaleo.com Settings swagger](https://api.apaleo.com/swagger/settings-v1/swagger.json)

**Oracle OPERA Cloud**
- The **chain** is provisioned automatically with the OPERA Cloud Foundation subscription; edited at Administration > Enterprise > Chain and Property Management > Chain. — [OPERA Cloud 24.3: Configuring Chain](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.3/ocsuh/t_admin_configuring_chain.htm)
- Multi-property work happens from a **hub** location: users "copy configuration from a property or template when working from a hub location," and target properties are "linked to the hub." Requires the Multi-Property OPERA Control; role must hold Template Configuration and New/Edit Template tasks. — [OPERA Cloud 24.2: Copying Configuration Codes to Multiple Properties](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.2/ocsuh/t_copying_configurations_to_multiple_properties.htm)
- OPERA user docs reference "Changing Your Location in Central or Multi Property Operations" (one login switches location among chain/hub/property). — [OPERA Cloud 24.3: Configuring Chain](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.3/ocsuh/t_admin_configuring_chain.htm)

**Stayntouch / Hotelogix / eZee / Djubo**
- Stayntouch: users can create custom property groups for regions or hotel types (press release, 2022-08-16). — [Hospitality Net: Stayntouch enhanced chain functionality](https://www.hospitalitynet.org/news/4111995/hotel-groups-benefit-from-streamlined-multi-property-management-with-stayntouch-pms-enhanced-chain-functionality)
- Stayntouch says its chain dashboard manages configurations for 100+ properties "from a single login" (marketing). — [Stayntouch: Brands & chains](https://www.stayntouch.com/brands-chains/)
- eZee Absolute brochure: "single login" with its Central Reservation System and ability to "switch between multiple properties" (brochure). A G2 reviewer reports it "freezes when I switch properties." — [eZee Absolute brochure](https://kelaenderkoe.pages.dev/Using-https-www.ezeeabsolute.com/Absolute_Brochure.pdf); [G2 eZee Absolute reviews](https://g2.com/products/ezee-absolute/reviews)
- eZee products now sit under "Yanolja Cloud Solution (formerly eZee)". — [Capterra: eZee Centrix reviews](https://www.capterra.com/p/135677/eZee-Centrix/reviews/)
- Hotelogix multi-property page does not describe a hierarchy or SSO; it promises to "Control all properties, rates, and teams from one screen" (marketing). — [Hotelogix: Multi-property hotel management system](https://hotelogix.com/multiple-property-management-system)
- Djubo's head-office product is "DJUBO Cockpit" (multi-property dashboard with drill-down for corporate offices). — [Djubo: Hotel chain head office](https://djubo.com/products/hotel-chain-head-office)

### Inferences
- Table stakes: one login across properties, a property switcher, and per-property role assignment for a single user (Cloudbeds, Mews, apaleo, OPERA, eZee all have this in some form).
- Premium: enterprise IdP SSO + SCIM provisioning, centrally-defined roles pushed to all properties, and audit exports of permissions (only Mews documents this as packaged, inside the Portfolio plan).
- Mews' split between "portfolio" (management scope) and "chain" (legal data-sharing scope) is the most explicit model of "management company vs owner/legal entity" among the vendors; it lets a management company run properties that do not share guest data.
- Cloudbeds keeps a sensitive permission (card viewing) at the property-owner level even inside an Organization — a pattern of owner-level consent for sensitive data.

### Gaps
- No vendor documentation found describing an explicit "owner" tier (asset owner viewing only their hotels within a management company's portfolio) beyond Mews' custom groups and Stayntouch property groups.
- Cloudbeds SSO with external IdPs (SAML/OIDC) not documented in the pages read.
- apaleo multi-account / portfolio structure above a single account not found; apaleo's per-property role model came from a search summary only.
- OPERA Cloud brand-level hierarchy (chain > brand > property) and IdP integration not confirmed from pages read.

## 2. Portfolio views: dashboards, consolidated reporting, group night audit, BI export

### Takeaway
A cross-property dashboard and property-filterable reports are near-universal claims; genuinely consolidated KPI reporting (occupancy/ADR/RevPAR across properties) is documented by Cloudbeds (Insights filter), Mews (Power BI-based Mews Analytics) and Hotelogix (marketing). Group-level night-audit status was not documented by any vendor.

### Cited Findings
- Cloudbeds Multi-Property View unifies Reservations, Guests, Dashboard and Availability Matrix; owners choose which multi-property pages admins/users see; Cloudbeds Insights reports can filter by one or more properties via a "Properties" filter. — [Cloudbeds: Organizations - Everything you need to know](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/1260803386269-Organizations-Everything-you-need-to-know)
- Turning on Multi-Property view removes the "Switch to Classic" button; only Org Owners or Super Admins can turn it off. — [Cloudbeds: Organizations FAQ](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/4403591508123-Organizations-FAQ)
- Mews Analytics is Power BI-based, gives chain-level overview, is part of Enterprise but "you need to enable the integration in each property in your chain." — [Mews Help: Upgrading from Mews Pro to Enterprise](https://help.mews.com/s/article/Upgrading-from-Mews-Pro-to-Enterprise-subscription) (via search summary)
- Mews Portfolio plan: "Dashboards and intel: filterable analytics dashboards and cross-property performance tracking"; Mews Analytics includes management performance, financial, pickup and outlet dashboards. — [Mews Help: Portfolio pricing plan](https://help.mews.com/s/article/Understanding-the-Portfolio-pricing-plan)
- Stayntouch Chain Dashboard shows per hotel: room count, current occupancy, previous/next-day occupancy and best available rate (2022-08-16); "multi-property configuration and reporting" was announced as "coming soon" then. — [Hospitality Net: Stayntouch chain functionality](https://www.hospitalitynet.org/news/4111995/hotel-groups-benefit-from-streamlined-multi-property-management-with-stayntouch-pms-enhanced-chain-functionality)
- Stayntouch marketing (later): multi-property dashboard with up to nine property tiles per page, filter by hotel, chain or property group. — [Stayntouch: Multi-property hotel management system features](https://www.stayntouch.com/articles/?p=167)
- Hotelogix group reporting lists manager flash reports, revenue history/forecast, MIS reports, and occupancy/ADR/RevPAR by property, revenue by source, booking pace (marketing). — [Hotelogix: Reports](https://www.hotelogix.com/reports); [Hotelogix blog: Multi-property PMS for hotel groups](https://www.hotelogix.com/blog/multi-property-pms-for-hotel-groups)
- OPERA Cloud: reports can be copied to multiple properties; copy fails if the report already exists at the destination. — [OPERA Cloud 24.1: Copying Reports to Multiple Properties](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.1/ocsuh/t_reports_copying_reports.htm)
- eZee brochure: "consolidate data of your entire hotel chain at a single place"; reports emailed after night audit. Reviewers mixed on reports (guest history/CRM reports "need some work"). — [eZee Absolute brochure](https://kelaenderkoe.pages.dev/Using-https-www.ezeeabsolute.com/Absolute_Brochure.pdf); [Capterra eZee Absolute reviews](https://www.capterra.com/p/135751/eZee-Absolute/reviews/?page=8)
- Djubo Cockpit targets corporate offices needing consolidated P&L views (marketing). — [Djubo: Hotel chain head office](https://djubo.com/products/hotel-chain-head-office)
- Mews' own comparison page claims cross-property rate management, consolidated reporting and permission structures were flagged as Cloudbeds gaps in 2025–26 Capterra/G2 reviews (competitor marketing; treat with caution). — [Mews vs Cloudbeds](https://www.mews.com/en/compare/mews-vs-cloudbeds)

### Inferences
- Table stakes: a multi-property dashboard with today's per-property counts and a property filter on reports.
- Premium: a BI layer (Mews Analytics/Power BI), pickup/forecast across properties, and portfolio API tokens for warehouse extraction (Mews Portfolio Access Token).
- Night audit stays per property everywhere (each property has its own business date); a "group audit status board" appears to be an unoccupied niche.

### Gaps
- No vendor page found documenting a group-level night-audit status view.
- Native data-warehouse export (Snowflake/BigQuery share, scheduled bulk export) for portfolios not confirmed for any vendor in sources read; OPERA has Oracle analytics products but not checked here.
- Currency and tax consolidation rules across properties in different countries not documented by any vendor read.

## 3. Shared configuration: templates, push to properties, overrides

### Takeaway
OPERA Cloud has the most explicit template model (enterprise/custom templates upserted into properties from a hub). Mews offers central rate groups, central products/policies and bulk rate edits in its Portfolio plan. Cloudbeds exposes cross-property rate editing in the multi-property Availability Matrix but no documented template push. Others are marketing claims.

### Cited Findings
- OPERA: copying configuration "from a property or template when working from a hub location... ensures consistency of configuration throughout all properties." Workflow: Template tab > copy > choose properties linked to the hub > review panel. — [OPERA Cloud 24.2: Copying Configuration Codes to Multiple Properties](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.2/ocsuh/t_copying_configurations_to_multiple_properties.htm)
- Oracle Enterprise Management: a custom template must be linked to one or more properties; configuration from the enterprise template and custom template is "distributed and upserted" into OPERA Cloud, to template and properties when Multi Property control is active. — [Oracle Hospitality Enterprise Management: Getting Started](https://docs.oracle.com/en/industries/hospitality/enterprise-management/ecmug/ch_getting_started.htm)
- OPERA Cloud Central marketing: reusable templates for room types, rate and transaction codes, packages, and booking categories; with OPERA Cloud Distribution, a distribution setup for one property can be copied across the portfolio. (Search summary; page 403 to direct fetch.) — [Oracle: OPERA Cloud Central](https://www.oracle.com/hospitality/products/opera-central)
- OPERA electronic registration card templates are configured at chain and property level. — [OPERA Cloud 24.3: Configuring Electronic Registration Card Templates](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.3/ocsuh/t_admin_chain_and_property_configuring_electronic_registration_card_templates.htm)
- Mews Portfolio plan rate management: "bulk rate adjustments, central rate groups, central products and policies, and vouchers." — [Mews Help: Portfolio pricing plan](https://help.mews.com/s/article/Understanding-the-Portfolio-pricing-plan)
- Mews: new properties can be added and synchronised with existing settings; adjust rates in bulk across properties. — [Mews: Multi-property management](https://mews.com/en/products/multi-property-management)
- Cloudbeds multi-property Availability Matrix: users can check availability and pricing across permitted properties, update rates, set price differentials and add long-term intervals. — [Cloudbeds: Organizations - Everything you need to know](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/1260803386269-Organizations-Everything-you-need-to-know)
- Stayntouch 2022 release listed multi-property configuration as "coming soon." — [Hospitality Net: Stayntouch chain functionality](https://www.hospitalitynet.org/news/4111995/hotel-groups-benefit-from-streamlined-multi-property-management-with-stayntouch-pms-enhanced-chain-functionality)

### Inferences
- Two patterns exist: (a) copy/distribute (one-time push, property may diverge — OPERA "copy", Cloudbeds bulk matrix edits) and (b) central objects that stay linked (Mews central rate groups/central roles, OPERA templates re-upserted). Override handling in (b) is not documented in what was read.
- Table stakes for mid-market: bulk rate edits across properties. Premium: true templates with ongoing sync (OPERA, Mews Portfolio).

### Gaps
- How per-property overrides of a central template survive the next push (OPERA upsert semantics, Mews central products) was not documented in pages read.
- Tax/charge code templating across jurisdictions not documented beyond OPERA "transaction codes."
- apaleo: no documented cross-property template push found; Hotelogix/eZee/Djubo: no detail.

## 4. Central reservations (CRO / call centre, cross-property availability)

### Takeaway
A cross-property availability screen for a central reservations office is common (OPERA Cloud Central, Stayntouch, Hotelogix CRO, eZee CRS, Cloudbeds multi-property matrix and unified reservations). Moving a reservation between properties is gated in OPERA on shared profiles. Multi-property booking engines are offered by Mews.

### Cited Findings
- OPERA Cloud Central: central reservations, sales and shared standards across properties; agents create/amend reservations, handle requests and payments, offer alternatives when first choice is unavailable; each hotel keeps its own bookings, profiles, rooms, billing and daily operations. (Search summary of Oracle marketing page.) — [Oracle: OPERA Cloud Central](https://www.oracle.com/hospitality/products/opera-central)
- OPERA: without profile sharing, the Property field is single-select and mandatory in Look to Book and reservation search, and moving reservations to other properties is disabled; with sharing, Property is multi-select. — [OPERA Cloud 24.3: Configuring Chain](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.3/ocsuh/t_admin_configuring_chain.htm)
- Stayntouch: Availability Screen shows multiple properties or whole chain; Pacifica Hotels: "The Multi-Property Availability Screen allows them to have a centralized view... when booking large groups" (2022). — [Hospitality Net: Stayntouch chain functionality](https://www.hospitalitynet.org/news/4111995/hotel-groups-benefit-from-streamlined-multi-property-management-with-stayntouch-pms-enhanced-chain-functionality)
- Hotelogix CRO: agents at a central office see availability and rates across properties and take direct bookings for FIT, corporates and travel agents; supports itinerary bookings across properties (marketing). — [Hotelogix: Central reservation office for chain hotels](https://hotelogix.com/central-reservation-office-for-chain-hotels); [Hotelogix: CRO for multi-properties](https://www.hotelogix.com/central-reservation-office-for-multi-properties-hlxe)
- Mews: unified reservation and guest data, multi-property booking engine. — [Mews Help: Portfolio pricing plan](https://help.mews.com/s/article/Understanding-the-Portfolio-pricing-plan)
- Cloudbeds: Multi-Property View unifies Reservations and Availability Matrix across properties. — [Cloudbeds: Organizations - Everything you need to know](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/1260803386269-Organizations-Everything-you-need-to-know)
- eZee: single login "with its Central Reservation System" (brochure); a GetApp summary mentions challenges with group bookings. — [eZee Absolute brochure](https://kelaenderkoe.pages.dev/Using-https-www.ezeeabsolute.com/Absolute_Brochure.pdf); [GetApp: eZee Absolute](https://www.getapp.com/hospitality-travel-software/a/ezee-absolute/)

### Inferences
- Table stakes: cross-property availability/rate search from one screen. Premium: a CRO product with alternate-property offers, multi-hotel itineraries, call-centre workflows (OPERA Central), and multi-property booking engine (Mews Portfolio).
- OPERA's design couples "move reservation to another property" to chain-wide shared profiles — cross-property moves need a guest identity that exists at both properties.

### Gaps
- No vendor documents how cross-property booking handles inventory and deposits atomically (each property keeps its own ledger in all products read).
- Cloudbeds: whether one can create a booking spanning two properties in a single transaction not documented.

## 5. Shared guest profiles / chain CRM / loyalty and privacy

### Takeaway
Profile sharing is an explicit chain-level choice: Mews shares customer profiles only within a legal "chain"; OPERA turns on chain-wide Shared Profiles irreversibly behind a PIN; Stayntouch markets shared chain profiles. Privacy handling is mostly structural (legal chain boundary, irreversible opt-in) rather than documented consent workflows.

### Cited Findings
- Mews chains "define legal relationships between enterprises and are used for sharing certain data such as customer profiles"; portfolios are separate from chains. — [Mews Connector API: Multi-property](https://docs.mews.com/connector-api/concepts/multi-property)
- OPERA: Shared Profiles is toggled at chain level; "Your PIN is required to enable profile sharing; the option cannot be disabled once enabled." — [OPERA Cloud 24.3: Configuring Chain](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.3/ocsuh/t_admin_configuring_chain.htm)
- OPERA Cloud Central with OPERA Cloud Loyalty gives central tools for member profiles, tiers, points, benefits and rewards (marketing summary). — [Oracle: OPERA Cloud Central](https://www.oracle.com/hospitality/products/opera-central)
- Stayntouch: chain-level stay data for guests, travel agents and companies; guest preferences and loyalty visible chain-wide; Adrift Hospitality: "it's absolutely essential for us to build guest profiles on a chain-level basis" (2022). — [Hospitality Net: Stayntouch chain functionality](https://www.hospitalitynet.org/news/4111995/hotel-groups-benefit-from-streamlined-multi-property-management-with-stayntouch-pms-enhanced-chain-functionality)
- Stayntouch Multi-Property "uses shared profiles and custom fields to ensure consistent, personalized service across all properties" (marketing). — [Stayntouch: Multi-property features](https://www.stayntouch.com/articles/?p=167)
- Cloudbeds Multi-Property View includes a unified Guests page. — [Cloudbeds: Organizations - Everything you need to know](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/1260803386269-Organizations-Everything-you-need-to-know)
- Hotelogix FAQ: groups can access guest preferences and reports centrally; no explicit shared-profile statement. — [Hotelogix: Multi-property hotel management system](https://hotelogix.com/multiple-property-management-system)

### Inferences
- Default is per-property profiles; chain-wide profiles are an opt-in at the legal-entity/chain level. A management company running hotels for different owners would typically not share profiles across owners (Mews' chain vs portfolio split exists for exactly that).
- Chain-wide loyalty is premium (OPERA Loyalty, Mews loyalty programs scoped by chain).

### Gaps
- No vendor page read documents GDPR/DPDP consent, per-guest opt-out, or erasure propagation across a shared chain profile.
- Whether Cloudbeds' unified Guests view is a merged profile or a union of per-property profiles is not stated.
- India vendors (Hotelogix, eZee, Djubo): no documentation on shared profiles or privacy found.

## 6. Inter-property finance: group billing, central AR / city ledger, transfers

### Takeaway
Thin evidence. OPERA documents distributing AR accounts from a hub to properties (older release) and transaction-code templates; no vendor page read documents centralised receivables collection or inter-property folio transfers.

### Cited Findings
- OPERA (release 18.3 docs): from a hub, Manage Accounts Receivables > account > Account Setup > Distribute to choose receiving properties; status message shows success/failure. — [OPERA Cloud 18.3: Copying Accounts to Other Properties](https://docs.oracle.com/cd/E81346_01/doc.183/e81527/t_cashiering_finance_copying_accounts_to_other_properties.htm)
- OPERA Cloud Central marketing: each hotel keeps its own billing while Central supports the group-wide view. — [Oracle: OPERA Cloud Central](https://www.oracle.com/hospitality/products/opera-central)
- apaleo maps each property to an accounting organisation for finance export. — [apaleo dev: Map property and accounts](https://apaleo.dev/guides/business-cases/finance-management/mapping.html)
- Mews companies are filterable by chain (`ChainId`), i.e. company (corporate account) records are chain-scoped. — [Mews Connector API: Multi-property](https://docs.mews.com/connector-api/concepts/multi-property)
- Djubo Cockpit: consolidated P&L for corporate office (marketing). — [Djubo: Hotel chain head office](https://djubo.com/products/hotel-chain-head-office)

### Inferences
- Pattern: AR accounts and companies are shared/distributed as master data, but each property keeps its own ledger and posts its own receivables; consolidation happens in accounting export/ERP, not in the PMS.

### Gaps
- No source found for centralised city-ledger collection across properties, inter-property charge transfer, or group master folio spanning hotels, for any vendor.
- Hotelogix and eZee AR across properties: nothing found.

## 7. Pricing for multi-property

### Takeaway
Pricing is per room per month with quote-based enterprise tiers. Multi-property capability is packaged as a higher plan (Mews Portfolio/Brand, Cloudbeds Enterprise, OPERA Central as separate product) rather than a per-property surcharge. India vendors quote by property count and rooms.

### Cited Findings
- Mews: Portfolio plan includes Multi-Property (oversight, central rates, SSO/SCIM, dashboards, Multi-Property API), up to 8 Marketplace integrations; Brand plan adds Open API and unlimited Marketplace; no prices published. — [Mews Help: Portfolio pricing plan](https://help.mews.com/s/article/Understanding-the-Portfolio-pricing-plan)
- Mews third-party list prices: €7.01/room/month (one directory) to an estimated $8–15/room. — [roommaster: Mews vs Apaleo](https://www.roommaster.com/alternatives/mews-vs-apaleo); [Capterra: Mews](https://capterra.com/p/145487/Mews-Commander/)
- apaleo: reported €8/room/month with €400 monthly minimum per property, no setup fees (third-party reading of apaleo's pricing page). — [rfp.wiki: apaleo vs Mews](https://www.rfp.wiki/specialty-industries/hospitality-travel/apaleo/mews-systems)
- Cloudbeds: plans Flex, One, Experience, Enterprise; quote-based; third-party estimate Flex ~$15/room, Enterprise ~$18–25+/room for groups and management companies. — [roommaster: Cloudbeds pricing 2026](https://www.roommaster.com/blog/cloudbeds-pricing)
- Hotelogix: multi-property pricing is subscription-based, by hotel size and integrations; no figures published. — [Hotelogix: Multi-property hotel management system](https://hotelogix.com/multiple-property-management-system)
- Djubo: chain pricing custom by total property count and room inventory. — [Djubo: Hotel chain head office](https://djubo.com/products/hotel-chain-head-office)
- eZee Absolute: from $23.86 flat per month (Software Advice). — [Software Advice: eZee Absolute](https://www.softwareadvice.com/hotel-management/ezee-absolute-profile/)
- Stayntouch: no multi-property pricing published. — [Stayntouch: Brands & chains](https://www.stayntouch.com/brands-chains/)

### Inferences
- Premium packaging: SSO/SCIM, central rate groups, portfolio API, BI dashboards, multi-property booking engine (Mews puts all in Portfolio). Table stakes bundled in base/organization tier: one login, property switch, multi-property availability view.
- OPERA monetises the chain layer as separate products (Central, Distribution, Loyalty) on top of per-property Foundation.

### Gaps
- No verified vendor-published prices for multi-property tiers; all figures are third-party.
- OPERA Cloud Central pricing not found.

## Summary matrix (from cited findings above)

| Capability | Cloudbeds | Mews | apaleo | OPERA Cloud | Stayntouch | Hotelogix | eZee | Djubo |
|---|---|---|---|---|---|---|---|---|
| Group container | Organization (via Support) | Portfolio + legal Chain | Account | Chain + hub | Chain + property groups | "Multi-property" (marketing) | Chain, single login (brochure) | Cockpit |
| Per-property roles for one user | Yes | Yes, central + local roles | Yes (predefined roles) | Yes (location switch) | Not documented | Not documented | Not documented | Not documented |
| SSO/SCIM | Not documented | Yes (Portfolio plan) | Not found | Not confirmed | Not found | Not found | Not found | Not found |
| Cross-property dashboard | Yes | Yes | Not found | Central view | Yes | Claimed | Claimed | Claimed |
| Consolidated reports | Insights property filter | Mews Analytics (Power BI) | Not found | Report copy; Central | "Coming soon" (2022) | Claimed | Mixed reviews | P&L claimed |
| Template/config push | Bulk rates in matrix | Central rate groups, products | Not found | Templates upserted from hub | "Coming soon" (2022) | Claimed | Not found | Not found |
| Central reservations | Unified reservations | Multi-property booking engine | Not found | OPERA Cloud Central | Multi-property availability | CRO (marketing) | CRS (brochure) | Not found |
| Shared guest profiles | Unified Guests page | Per legal chain | Not found | Chain toggle, irreversible | Yes (marketing) | Not stated | Not found | Not found |
| Central AR | Not found | Companies chain-scoped | Per-property accounting map | AR account distribute (hub) | Not found | Not found | Not found | Not found |
