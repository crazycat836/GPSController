---
name: Always reference DESIGN.md for frontend work
description: All frontend design decisions must reference frontend/DESIGN.md — tokens, colors, z-index, components, motion
type: feedback
---

All frontend design and styling work must reference `frontend/DESIGN.md` before making changes.

**Why:** The user established a comprehensive design system document and wants consistency. Ad-hoc styling decisions (hardcoded colors, arbitrary z-index, inline styles) were a recurring problem that this system was built to prevent.

**How to apply:**
- Before writing any CSS, Tailwind classes, or inline styles, check DESIGN.md for the correct token
- Use `--color-*` tokens for all colors, `--z-*` for z-index, `--duration-*` for timing, `--radius-*` for border-radius
- Use pre-composed classes (`.modal-overlay`, `.status-badge-*`, `.seg-*`, `.action-btn`) instead of building from scratch
- Never introduce hardcoded hex colors — add new tokens to `@theme` in `index.css` if needed
- Update DESIGN.md when adding new tokens or component patterns
