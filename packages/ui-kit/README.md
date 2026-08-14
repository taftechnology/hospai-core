# @hospai/ui-kit

Hand-authored Tier A components for `apps/web-pms` and module UI surfaces. No Tailwind, no shadcn CLI.

**Stack:** `.stack` stays a CSS class in `apps/web-pms/src/styles.css` — it has no variants worth typing as a component (spec §17.7).

**Variants:** plain intent/size → class maps via `clsx`, not `class-variance-authority` (spec §17.8).

**API:** no `className`, no `style`, no blanket `...rest` on components (spec §7.3 / invariant 17).
