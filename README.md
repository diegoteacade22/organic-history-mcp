# OrganicHistory MCP

**An MCP server that answers one question no free USDA tool answers: has this organic operation *ever* lost its certification — and when?**

The USDA Organic INTEGRITY search shows today's status. It does not show history. This server keeps the history.

---

## Why an agent needs this

An agent buying organic inputs, screening a supplier, or assembling a due-diligence file can confirm a supplier is certified **today**. It cannot see that the same supplier was **suspended eight months ago** and re-certified since — which is exactly the fact that changes a sourcing decision.

Between January and November 2026, **6,094 operations moved from `Certified` to a non-certified status** (about 609 per month). None of those transitions are queryable anywhere without rebuilding them from 11 separate 76–79 MB spreadsheets.

This server ships the rebuilt history.

---

## Install

```json
{
  "mcpServers": {
    "organic-history": {
      "command": "npx",
      "args": ["-y", "github:diegoteacade22/organic-history-mcp"]
    }
  }
}
```

Requires Node 18+. No API key, no account, no network calls — the dataset is bundled.

---

## Tools

### `verify_operation`
Verify one operation by its 10-digit USDA Operation ID.

```json
{ "operation_id": "8699694963" }
```

Returns:

```json
{
  "found": true,
  "operation_id": "8699694963",
  "name": "BANANORIA S DE PR DE RL DE CV",
  "certifier": "BioAgriCert",
  "country": "Mexico",
  "current_status": "Suspended",
  "status_since": "10/08/2026",
  "verdict": "not_certified",
  "ever_non_certified": true,
  "non_certified_events": [{ "month": "2026-11", "status": "Suspended" }]
}
```

### `verify_many`
Screen up to 100 IDs in one call and get a count per verdict.

### `list_changes`
Every operation that moved into a non-certified status between two months.

```json
{ "from_month": "2026-11", "to_month": "2026-11", "to_status": "Suspended" }
```

### `search_operations`
Resolve a supplier name to an Operation ID.

```json
{ "query": "bananoria", "country": "Mexico" }
```

---

## Verdicts

| Verdict | Meaning |
|---|---|
| `verified_certified` | Certified now, and never lost certification in the observed window |
| `certified_after_loss` | Certified now, but lost certification earlier — the fact a status check hides |
| `not_certified` | Not certified today (Surrendered, Suspended or Revoked) |
| `unknown` | ID not present in the observed window |

---

## Data

- **Source:** USDA Organic INTEGRITY monthly snapshots — public data, published on the 1st of each month at `organic.ams.usda.gov/Integrity/MonthlyReports/`.
- **Method:** every published month of the current year parsed from the `Operation Level` sheet and aligned by Operation ID; status transitions derived by diffing consecutive months.
- **Coverage:** 11 months (2026-01 → 2026-11), **84,441 operations**, **6,125 transitions** into a non-certified status.
- **Rebuilt:** 2026-11-19. A build script refreshes it when the USDA publishes a new month.
- **Excluded:** the USDA placeholder row `0000000000` ("USDA Organic Import") is not a real operation and is filtered out.

### Known limits

- **Up to 30 days stale.** Snapshots are monthly, not real time. Use it for due diligence and history, not for live alerts.
- **History starts 2026-01.** Earlier years are not in the published snapshot format.
- Certifiers can update an operation's record between snapshots; the next snapshot carries the change.

---

## Verify the data yourself

Every claim above is reproducible from public files:

1. Download `INTEGRITY_Data_20260101.xlsx` … `INTEGRITY_Data_20261101.xlsx` from the USDA Data History page.
2. Read the `Operation Level` sheet, skip the two header rows.
3. Key on `Operation ID` (column 2). Status is `Operation Certification Status` (column 8).
4. Diff consecutive months.

---

## Pricing

The server above is **free** and covers the full history for any single lookup.

A paid tier adds what a production agent needs:

| Plan | Price | Includes |
|---|---|---|
| Free | USD 0 | Bundled dataset, all four tools, manual refresh |
| Team | USD 29/month | Automatic monthly refresh delivered to you, 1,000 verifications/month, change webhook |
| Scale | USD 99/month | 10,000 verifications/month, batch CSV export, priority refresh on publication day |

Contact: open an issue in this repository.

---

## License

MIT for the code. The underlying data is public USDA data.
