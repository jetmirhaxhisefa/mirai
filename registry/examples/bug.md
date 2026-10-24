---
id: PMT-31
type: bug
template: bug@v1
repo: "."
risk: normal
size: S
verify: "Changing a team's name keeps every member on the team page, checked by a feature test."
covers_fr: []
covers_ac: []
governed_by: []
after: []
files_likely: [app/Actions/RenameTeam.php]
e2e: false
---
# Renaming a team hides its members

## Description

A manager renames a team, and the team page then shows no members, although they are still in
the team. Reloading doesn't help. The page should list the same members under the new name.

## Reproduction

1. Staging, signed in as a manager of the team "Platform" with four members.
2. Open the team's settings, rename it to "Platform Core" and save.
3. Actual: the team page says "No members yet". Expected: the four members are listed.

The log shows `TeamMembers::forSlug platform-core: 0 rows`.

## Cause hypothesis

The members query looks the team up by its slug, and renaming changes the slug without
updating the cached slug on the members' records.

## Acceptance criteria

- AC-PMT-31.1: The members stay listed after a rename
  - Given a team with members
  - When a manager renames it
  - Then the team page lists the same members under the new name
- AC-PMT-31.2: Links to the old name still work
  - Given a bookmark to the team's page under its old name
  - When a member opens it after the rename
  - Then they land on the team page under the new name

## References

- The support report from the Platform manager, 2026-10-22.

## Notes

Not applicable — nothing beyond the report and the log.
