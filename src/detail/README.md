# Detail module (`src/detail/`)

The right pane: details of one request, or the aggregate view for a multi-selection.

## Files

| File | Responsibility |
| --- | --- |
| `DetailPanel.ts` | `render(entry)` for one request (Request/Response sides, each with Headers, Raw, Cookies, Syntax, and Image/Font previews). `renderMultiSelect(entries)` for the Timeline and Stats tabs. |
| `statsView.ts` | `renderStatsView(entries, parser)`: the Stats markup for the Stats tab. |
| `aggregateStats.ts` | `computeAggregateStats` for the Stats tab (counts, bytes, time span, code and content-type tallies). |
| `httpFormatter.ts` | Raw HTTP text (`buildRawRequest`, `buildRawResponse`) and JSON/HTML syntax highlighting (`highlightSyntax`). |
| `detail.css` | Detail panel, timeline and stats styles. |

## Timeline

Rows are sized by absolute start time. Phases come from `TIMELINE_PHASES`
(blocked, DNS, connect, SSL, send, wait, receive). The axis picks a "nice"
tick step. The fixed time scale option wraps the timeline in a scrollable
container. Clicking a row selects that entry in the table.

## Tests

`tests/detail/aggregateStats.test.ts`.
