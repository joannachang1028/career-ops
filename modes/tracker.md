# Mode: tracker — Applications Tracker

Read and display `data/applications.md`.

**Tracker Format:**

```markdown
| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
```

Possible states: `Evaluated` → `Applied` → `Responded` → `Interview` → `Offer` / `Rejected` / `Discarded` / `SKIP`

- `Evaluated` = offer evaluated with report, pending decision
- `Applied` = the candidate submitted their application
- `Responded` = Company has responded (not yet interview)
- `Interview` = active interview process
- `Offer` = job offer received
- `Rejected` = rejected by company
- `Discarded` = discarded by candidate or offer closed
- `SKIP` = doesn't fit, don't apply

If the user asks to update a state, edit the corresponding row.

## Notion mirror — only after the user has applied

**Do NOT export to Notion when a row is still `Evaluated` or `SKIP`.** Evaluation + report + PDF stay local until the user confirms they submitted the application.

After the user confirms they **applied** (or updates an already-applied row to `Responded`, `Interview`, `Offer`, `Rejected`, or `Discarded`), check whether the Notion export plugin is enabled in `config/plugins.yml`.

1. Update `data/applications.md` first (canonical status `Applied` or downstream).
2. Ensure `data/notion-sync.yml` has metadata for that tracker `#` (`industry`, `website`, `location`, `work_arrangement` — no `status` field needed; Application Status comes from the tracker).
3. If enabled, run `node plugins.mjs run notion export` immediately after the local tracker update. The export skips `Evaluated`/`SKIP` rows and maps `Applied` → Notion **Applied**.
4. Treat `data/applications.md` as the source of truth; Notion is a mirror.
5. Report both outcomes separately: local tracker updated, Notion synchronized.
6. If the Notion export fails, keep the valid local update, quote the concise connection/configuration error, and never imply that Notion was updated.

Also show statistics:
- Total applications
- Breakdown by state
- Average score
- % with PDF generated
- % with report generated
