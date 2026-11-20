# Filter module (`src/filter/`)

The request-table filter query language and the saved-filter tree UI.

## Files

| File | Responsibility |
| --- | --- |
| `filterParser.ts` | Tokenizer and recursive-descent parser. `parseFilterQuery` returns an AST, and `filterEntries` evaluates it per entry. Also `compileFilterQuery`. |
| `FilterTree.ts` | Strip above the request table: path of ancestors, delete button, and sub-filter chips. |
| `filter.css` | Styles for the filter bar and filter tree. |

## Query syntax

Field clauses (`status:200`, `method:GET`, `host:...`, `path:...`,
`protocol:...`, `type:...`, `duration:>100`, `size:<10kb`), `-field:` and
`not` negation, `and` / `or` / parentheses, and header/cookie clauses
(`reqheader:name=value`, `resheader:name`, `reqcookie:...`, `rescookie:...`).
Plain text matches the method and URL. Unknown prefixes never throw.

The full reference is in `CLAUDE.md` ("Filter Query Syntax").

## Adding a field

1. Add it to `FIELD_ALIASES` (and `NUMERIC_FIELDS` if numeric).
2. Add a case in `getFieldValue`.
3. Update the hint in `index.html` (`#filter-hint`).

## Tests

`tests/filter/filterParser.test.ts`.
