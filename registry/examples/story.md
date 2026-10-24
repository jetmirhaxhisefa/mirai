---
id: PMT-12
type: story
template: story@v1
repo: "."
risk: normal
size: M
verify: "A staff member signs in with SSO on the staging stack and lands on their team page."
covers_fr: [FR-2]
covers_ac: [AC-FR-2.1, AC-FR-2.2]
governed_by: [ADR-3]
after: [PMT-11]
epic: PMT-10
files_likely: [app/Http/Controllers/Auth/SsoController.php, resources/js/pages/Login.tsx]
e2e: true
---
# A staff member signs in with company SSO

## Description

A staff member opens the people tool, chooses "Sign in with SSO" and lands on their team page,
already signed in. A staff member whose account is disabled is told why and stays signed out.
This is the first slice of the sign-in epic: it replaces the password form for staff.

## Acceptance criteria

- AC-PMT-12.1: SSO sign-in lands on the team page
  - Given a staff member with an active account
  - When they sign in with SSO
  - Then they land on their team page, signed in, and the session lasts eight hours
- AC-PMT-12.2: A disabled account is refused with the reason
  - Given a staff member whose account is disabled
  - When they sign in with SSO
  - Then they stay signed out and see "Your account is disabled; ask your manager"
- AC-PMT-12.3: The SSO provider is down
  - Given the SSO provider doesn't answer within five seconds
  - When a staff member signs in
  - Then they see "Sign-in is unavailable; try again in a few minutes" and nothing is logged as a failed sign-in

These deliver AC-FR-2.1 and AC-FR-2.2 from the PRD.

## Boundaries

- Must not change: how admins sign in (still with a password), or the session length for admins.

## References

- The PRD: requirement FR-2, "Staff sign in with SSO".
- ADR-3: SSO through the company identity provider.

## Notes

- Decision: disabled accounts get a message, not a silent refusal (2026-10-24).
- Assumption: the eight-hour session matches the identity provider's token lifetime.
