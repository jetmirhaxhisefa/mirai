---
id: PMT-31-plan
type: plan
template: plan@v1
ticket: PMT-31
acs: [AC-PMT-31.1, AC-PMT-31.2]
risk: normal
tdd: first
tests: required
round: 1
---
# The plan for PMT-31: renaming a team hides its members

<!-- frozen:start -->
## Intent

**Problem:** renaming a team changes its slug, but the members' cached slug stays old, so the
team page finds no members.

**Approach:** look members up by the team's id instead of its slug, and keep the old slug as a
redirect to the new one.

## Boundaries

- Always: a team's members are found by the team's id.
- Never: change how teams are created or deleted, or rename existing slugs in bulk.

## Edge cases

| Case | Input or state | Expected | On error |
|---|---|---|---|
| Rename | a team with members, a new name | the same members under the new name | none expected |
| Old link | a bookmark to the old slug | a redirect to the new slug | a 404 if no team ever had it |
| Rename twice | two renames in a row | both old slugs redirect | as above |
<!-- frozen:end -->

## Code map

| Path | Symbols | Change |
|---|---|---|
| `app/Actions/RenameTeam.php` | `RenameTeam::handle` | change |
| `app/Queries/TeamMembers.php` | `TeamMembers::forSlug` | change |
| `app/Queries/TeamMembers.php` | `TeamMembers::forTeam` | add |
| `app/Http/Middleware/TeamSlugRedirect.php` | `TeamSlugRedirect::handle` | add |
| `routes/web.php` | `teams.show` | read |

## Tasks

- [ ] `app/Queries/TeamMembers.php`: add `forTeam(id)` and make `forSlug` resolve the id first.
- [ ] `app/Actions/RenameTeam.php`: record the old slug before changing it.
- [ ] `app/Http/Middleware/TeamSlugRedirect.php`: a stub that returns nothing, then the redirect.

## Test list

| Test | Test ID | Symbol | AC | Level | Kind |
|---|---|---|---|---|---|
| renaming keeps the team's name and slug rules | `tests/Unit/RenameTeamTest.php` | `RenameTeam::handle` | AC-PMT-31.1 | unit | characterization |
| a renamed team still lists its members | `tests/Feature/TeamRenameTest.php::test_members_stay` | `TeamMembers::forTeam` | AC-PMT-31.1 | feature | red |
| an old slug redirects to the new one | `tests/Feature/TeamRenameTest.php::test_old_slug_redirects` | `TeamSlugRedirect::handle` | AC-PMT-31.2 | feature | red |
| two renames both redirect | `tests/Feature/TeamRenameTest.php::test_two_renames` | `TeamSlugRedirect::handle` | AC-PMT-31.2 | feature | red |

## Declared changes

| Kind | Item | Why |
|---|---|---|
| none | | |

## Verification

- `php artisan test --filter=TeamRename`: all pass.
- `npm run lint`: no new warnings.

## Design notes

Not applicable — looking members up by id is the usual pattern in this codebase.

## Implementation log

## Change log

## Review triage log
