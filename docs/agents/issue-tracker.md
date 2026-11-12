# Issue tracker: GitHub Issues

Issues and specs for this repo live as GitHub Issues on `CaiZongyuan/ontology-plus`. Use the `gh` CLI.

## Conventions

- One feature per **spec issue**. Its implementation tickets are **sub-issues** of the spec.
- Triage state is a label (see `triage-labels.md` for the role strings).
- A ticket's blockers are native "blocked by" dependencies, not prose.
- Tickets that are deliberately not being built yet carry `needs-triage` and state the condition that should reopen them.
- Comments and conversation history live on the issue.

## When a skill says "publish to the issue tracker"

- Spec: `gh issue create --label ready-for-agent --title ... --body-file ...`
- Ticket: create the issue the same way, then attach it to its spec and blockers:
  - sub-issue: `gh api -X POST repos/{owner}/{repo}/issues/<spec>/sub_issues -F sub_issue_id=<ticket id>`
  - blocker: `gh api -X POST repos/{owner}/{repo}/issues/<ticket>/dependencies/blocked_by -F issue_id=<blocker id>`
  - both take the issue's numeric `id` (`gh api repos/{owner}/{repo}/issues/<n> --jq .id`), not its number.

## When a skill says "fetch the relevant ticket"

`gh issue view <number> --comments`. The user will normally pass the issue number or URL directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is an issue with one **child** sub-issue per ticket.

- **Map**: an issue whose body holds the Notes / Decisions-so-far / Fog sections.
- **Child ticket**: a sub-issue of the map, with the question in the body and a `Type:` line (`research`/`prototype`/`grilling`/`task`).
- **Blocking**: native "blocked by" dependencies. A ticket is unblocked when every blocker is closed.
- **Frontier**: open sub-issues of the map that are unblocked and unassigned; lowest number wins.
- **Claim**: assign the issue to yourself before any work.
- **Resolve**: post the answer as a comment under an `## Answer` heading, close the issue, then append a context pointer (gist + link) to the map's Decisions-so-far.

## Scratch files

`.scratch/` is gitignored and may hold working notes. It is not the tracker.
