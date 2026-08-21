# Luna 12-case acceptance addendum

This addendum supplements the historical artifact `live-phase-one-12-case-luna-v1.json`. The original artifact and its recorded `FAIL` result are unchanged.

The original one-web-search-per-response criterion was incorrectly specified. The corrected contract is one OpenAI Responses request per prospect with `max_tool_calls: 3`, only the built-in web-search tool enabled, a maximum of three web-search calls per case, and a maximum of 36 across the 12-case acceptance.

Historical run evidence:

- 12 Responses requests;
- 35 web-search calls;
- known calculated cost: USD 0.45957458;
- identity resolution: 11/12;
- Apollo candidates: 38;
- all safety gates: zero violations.

Under the corrected maximum-three-search policy, this evidence is accepted as a **CONDITIONAL PASS**. The new hard `max_tool_calls: 3` request parameter and deterministic post-response/global budget checks are verified by focused tests only; the acceptance was not live-rerun.

Remaining cost uncertainty is limited to cache-write billing not reported in the response usage payload. Search-content tokens are included in input usage and were not double-counted.
