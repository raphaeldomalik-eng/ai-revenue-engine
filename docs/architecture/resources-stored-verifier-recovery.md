# Read-only historical verifier recovery

The existing signed directory verifier supports a cache-only request header. Signature, policy, original request fingerprint and reservation-scope validation remain in force. A cache-only miss or retryable/incomplete result returns a conflict without falling through to research. Cache-only reads do not reserve work, complete a historic ledger row, change a retry guard or replace an immutable result.

A complete, already verified cached result may return a derived `firstPassAcquisition` using only retained page hashes/manifests, original neutral facts and explicitly accepted contact observations. The existing optional evidence payload carries versioned recovery provenance and the original result digest. Observation times, page URLs and contact evidence references are retained. Aggregate source hashes describe retained page hashes, not a new fetch. No HTML extraction, network resolution, crawl, search or paid provider runs.

AIRE returns neutral evidence and a zero-execution cache receipt. Nexus still governs canonical association; EventSuite still governs supported private routing and publication. A stored form observation does not establish form usability. No mailbox-domain/name policy, identity threshold, suitability rule, provider allowance or scheduler changes are part of this repair.
