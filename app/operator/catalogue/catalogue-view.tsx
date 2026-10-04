"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type {
  AireCatalogueItem,
  NormalizedProfile,
  EventCapability,
  CanonicalIdentityState,
  RouteState,
  ResearchDisposition,
  PaidEligibility,
} from "../../../src/nexus/catalogue.ts";
import type { CatalogueBudgetSummary } from "../../../src/nexus/db.ts";
import "./catalogue.css";

interface CatalogueApiResponse {
  access: string;
  view: string;
  items: AireCatalogueItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  budgets: CatalogueBudgetSummary;
  saved: string;
  error?: string;
  message?: string;
}

const SAVED_VIEWS = [
  { id: "all", label: "All Entities" },
  { id: "needs_web_verification", label: "Needs Web Verification" },
  { id: "owner_confirmation", label: "Owner Confirmation" },
  { id: "resources_ready", label: "Resources Ready" },
  { id: "needs_identity_review", label: "Needs Identity Review" },
  { id: "waiting_for_paid_research", label: "Waiting for Paid Research" },
  { id: "event_businesses", label: "Event Businesses" },
  { id: "invalid_provider_refs", label: "Invalid Provider Refs" },
  { id: "commercial_possible", label: "Commercial Possible" },
] as const;

type DrawerTab = "overview" | "evidence" | "classification" | "channels" | "research" | "listing" | "communications" | "activity";

export function CatalogueView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // URL state
  const pageParam = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const searchParam = searchParams.get("search") ?? "";
  const savedParam = searchParams.get("saved") ?? "all";
  const selectedParam = searchParams.get("selected") ?? null;

  // Local query state
  const [searchInput, setSearchInput] = useState(searchParam);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<string>(searchParams.get("normalizedProfile") ?? "ALL");
  const [selectedCapability, setSelectedCapability] = useState<string>(searchParams.get("eventCapability") ?? "ALL");
  const [selectedIdentity, setSelectedIdentity] = useState<string>(searchParams.get("canonicalIdentityState") ?? "ALL");
  const [selectedDisposition, setSelectedDisposition] = useState<string>(searchParams.get("researchDisposition") ?? "ALL");

  // Data state
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CatalogueApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Selected item & drawer
  const [selectedItem, setSelectedItem] = useState<AireCatalogueItem | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("overview");
  const [focusedRowIndex, setFocusedRowIndex] = useState<number>(-1);

  // Promotion modal / form state
  const [proModalOpen, setProModalOpen] = useState(false);
  const [proPurpose, setProPurpose] = useState("Commercial Prospecting");
  const [proReason, setProReason] = useState("");
  const [proChannel, setProChannel] = useState("resources");
  const [proSubmitting, setProSubmitting] = useState(false);
  const [proFeedback, setProFeedback] = useState<{ message: string; type: "success" | "suppressed" | "error" } | null>(null);

  const [entModalOpen, setEntModalOpen] = useState(false);
  const [entPurpose, setEntPurpose] = useState("Enterprise Capacity Verification");
  const [entReason, setEntReason] = useState("");
  const [entEvidenceGap, setEntEvidenceGap] = useState("");
  const [entChannel, setEntChannel] = useState("resources");
  const [entSubmitting, setEntSubmitting] = useState(false);
  const [entFeedback, setEntFeedback] = useState<{ message: string; type: "success" | "suppressed" | "error" } | null>(null);

  // Focus restoration refs
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const originatingRowRef = useRef<HTMLTableRowElement | null>(null);

  // Fetch catalogue collection
  const loadCatalogue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      q.set("page", String(pageParam));
      q.set("pageSize", "50");
      if (searchParam) q.set("search", searchParam);
      if (savedParam && savedParam !== "all") q.set("saved", savedParam);
      if (selectedProfile && selectedProfile !== "ALL") q.set("normalizedProfile", selectedProfile);
      if (selectedCapability && selectedCapability !== "ALL") q.set("eventCapability", selectedCapability);
      if (selectedIdentity && selectedIdentity !== "ALL") q.set("canonicalIdentityState", selectedIdentity);
      if (selectedDisposition && selectedDisposition !== "ALL") q.set("researchDisposition", selectedDisposition);

      const res = await fetch(`/api/operator/catalogue?${q.toString()}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || `Failed to fetch catalogue: ${res.statusText}`);
      }
      const json: CatalogueApiResponse = await res.json();
      setData(json);

      // If URL has selectedParam, set selected item
      if (selectedParam && json.items) {
        const match = json.items.find((item) => item.external_reference_id === selectedParam);
        if (match) setSelectedItem(match);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [pageParam, searchParam, savedParam, selectedProfile, selectedCapability, selectedIdentity, selectedDisposition, selectedParam]);

  useEffect(() => {
    loadCatalogue();
  }, [loadCatalogue]);

  // Sync search input if URL changes
  useEffect(() => {
    setSearchInput(searchParam);
  }, [searchParam]);

  // Open drawer for an item
  const openDrawer = (item: AireCatalogueItem, rowIndex: number) => {
    originatingRowRef.current = rowRefs.current[rowIndex] ?? null;
    setSelectedItem(item);
    setDrawerTab("overview");
    setProFeedback(null);
    setEntFeedback(null);
    setProModalOpen(false);
    setEntModalOpen(false);

    // Update URL param without full reload
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    current.set("selected", item.external_reference_id);
    router.replace(`${pathname}?${current.toString()}`);
  };

  // Close drawer and restore focus
  const closeDrawer = () => {
    setSelectedItem(null);
    setProModalOpen(false);
    setEntModalOpen(false);
    setProFeedback(null);
    setEntFeedback(null);

    const current = new URLSearchParams(Array.from(searchParams.entries()));
    current.delete("selected");
    router.replace(`${pathname}?${current.toString()}`);

    if (originatingRowRef.current) {
      originatingRowRef.current.focus();
    }
  };

  // Keyboard navigation across table rows
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTableElement>) => {
    if (selectedItem && (e.key === "Escape" || e.key === "Esc")) {
      e.preventDefault();
      closeDrawer();
      return;
    }

    if (!data?.items.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedRowIndex((prev) => {
        const next = Math.min(prev + 1, data.items.length - 1);
        rowRefs.current[next]?.focus();
        return next;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedRowIndex((prev) => {
        const next = Math.max(prev - 1, 0);
        rowRefs.current[next]?.focus();
        return next;
      });
    } else if (e.key === "Enter" && focusedRowIndex >= 0) {
      e.preventDefault();
      const item = data.items[focusedRowIndex];
      if (item) openDrawer(item, focusedRowIndex);
    }
  };

  // Search submit
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    if (searchInput.trim()) {
      current.set("search", searchInput.trim());
    } else {
      current.delete("search");
    }
    current.set("page", "1");
    router.push(`${pathname}?${current.toString()}`);
  };

  // Saved view chip select
  const handleSavedViewSelect = (viewId: string) => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    current.set("saved", viewId);
    current.set("page", "1");
    router.push(`${pathname}?${current.toString()}`);
  };

  // Promotion actions
  const handlePromotePro = async () => {
    if (!selectedItem) return;
    setProSubmitting(true);
    setProFeedback(null);
    try {
      const res = await fetch("/api/operator/catalogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "PROMOTE_PRO",
          externalReferenceId: selectedItem.external_reference_id,
          purpose: proPurpose,
          reason: proReason,
          originatingProduct: proChannel,
        }),
      });
      const result = await res.json();
      if (result.suppressed) {
        setProFeedback({ message: result.message || "Existing evidence satisfies this request.", type: "suppressed" });
      } else if (result.success) {
        setProFeedback({ message: result.message, type: "success" });
        loadCatalogue();
      } else {
        setProFeedback({ message: result.message || "Promotion failed.", type: "error" });
      }
    } catch (err) {
      setProFeedback({ message: (err as Error).message, type: "error" });
    } finally {
      setProSubmitting(false);
    }
  };

  const handlePromoteEnterprise = async () => {
    if (!selectedItem) return;
    if (!entReason.trim() || !entEvidenceGap.trim()) {
      setEntFeedback({ message: "Mandatory reason and evidence gap are required for Enterprise promotion.", type: "error" });
      return;
    }
    setEntSubmitting(true);
    setEntFeedback(null);
    try {
      const res = await fetch("/api/operator/catalogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "PROMOTE_ENTERPRISE",
          externalReferenceId: selectedItem.external_reference_id,
          purpose: entPurpose,
          reason: entReason,
          evidenceGapReason: entEvidenceGap,
          originatingProduct: entChannel,
        }),
      });
      const result = await res.json();
      if (result.suppressed) {
        setEntFeedback({ message: result.message || "Existing evidence satisfies this request.", type: "suppressed" });
      } else if (result.success) {
        setEntFeedback({ message: result.message, type: "success" });
        loadCatalogue();
      } else {
        setEntFeedback({ message: result.message || "Promotion failed.", type: "error" });
      }
    } catch (err) {
      setEntFeedback({ message: (err as Error).message, type: "error" });
    } finally {
      setEntSubmitting(false);
    }
  };

  const totalCount = data?.total ?? 21468;
  const budgets = data?.budgets;

  return (
    <div className="catalogue-container">
      {/* 1. Header with Operational Indicators */}
      <header className="operator-page-header compact">
        <div>
          <span className="operator-kicker">CROSS-PRODUCT DISCOVERY ESTATE</span>
          <h1>Entity Catalogue</h1>
          <p>
            {totalCount.toLocaleString()} entities · Nexus-backed discovery estate & cross-product routing
          </p>
        </div>
        <div className="catalogue-header-badges">
          <div className="catalogue-stat-badge" title="Total accounted entities in production catalogue">
            <span className="catalogue-dot live" />
            <strong>{totalCount.toLocaleString()}</strong>
            <small>total</small>
          </div>
          <div className="catalogue-stat-badge pro" title="Google Places Pro monthly budget allowance">
            <span>PRO</span>
            <strong>{budgets?.pro?.remaining ?? 0}</strong>
            <small>remaining</small>
          </div>
          <div className="catalogue-stat-badge enterprise" title="Google Places Enterprise monthly budget allowance">
            <span>ENTERPRISE</span>
            <strong>{budgets?.enterprise?.remaining ?? 0}</strong>
            <small>remaining</small>
          </div>
          <div className="catalogue-stat-badge disabled-tier" title="Enterprise Atmosphere is permanently disabled in V1">
            <span className="catalogue-dot disabled" />
            <span>ATMOSPHERE</span>
            <strong>disabled</strong>
          </div>
        </div>
      </header>

      {/* 2. Saved Views Chips Bar */}
      <nav aria-label="Saved Catalogue Views" className="catalogue-views-bar">
        {SAVED_VIEWS.map((view) => (
          <button
            key={view.id}
            type="button"
            className={`catalogue-view-chip ${savedParam === view.id ? "active" : ""}`}
            onClick={() => handleSavedViewSelect(view.id)}
            aria-pressed={savedParam === view.id}
          >
            {view.label}
          </button>
        ))}
      </nav>

      {/* 3. Search and Faceted Filter Bar */}
      <form onSubmit={handleSearchSubmit} className="catalogue-toolbar">
        <div className="catalogue-search-wrap">
          <input
            type="search"
            aria-label="Search entities, localities, queries, or provider references"
            placeholder="Search by entity name, locality, discovery query, or reference ID…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="catalogue-search-input"
          />
          <button type="submit" className="operator-button">
            Search
          </button>
        </div>
        <button
          type="button"
          className={`catalogue-filter-toggle ${filterOpen ? "active" : ""}`}
          onClick={() => setFilterOpen(!filterOpen)}
          aria-expanded={filterOpen}
        >
          {filterOpen ? "Hide Filters ▲" : "Faceted Filters ▼"}
        </button>
      </form>

      {/* Collapsible Faceted Filter Grid */}
      {filterOpen && (
        <div className="catalogue-filter-grid">
          <div className="catalogue-filter-field">
            <label htmlFor="filter-profile">Normalized Profile</label>
            <select
              id="filter-profile"
              value={selectedProfile}
              onChange={(e) => setSelectedProfile(e.target.value)}
            >
              <option value="ALL">All Profiles</option>
              <option value="dedicated_event_venue">Dedicated Event Venue</option>
              <option value="hospitality">Hospitality</option>
              <option value="accommodation">Accommodation</option>
              <option value="food_beverage">Food & Beverage</option>
              <option value="nightlife">Nightlife</option>
              <option value="sports_recreation">Sports & Recreation</option>
              <option value="culture_entertainment">Culture & Entertainment</option>
              <option value="event_supplier">Event Supplier</option>
              <option value="general_organisation">General Organisation</option>
              <option value="other_business">Other Business</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>

          <div className="catalogue-filter-field">
            <label htmlFor="filter-capability">Event Capability</label>
            <select
              id="filter-capability"
              value={selectedCapability}
              onChange={(e) => setSelectedCapability(e.target.value)}
            >
              <option value="ALL">All Capabilities</option>
              <option value="EXPLICIT_EVENT_VENUE">Explicit Event Venue</option>
              <option value="VENUE_CAPABLE_NEEDS_WEB_VERIFICATION">Needs Web Verification</option>
              <option value="OWNER_CONFIRMATION_LIKELY">Owner Confirmation Likely</option>
              <option value="NO_CURRENT_EVENT_VENUE_EVIDENCE">No Event Venue Evidence</option>
              <option value="UNKNOWN">Unknown</option>
            </select>
          </div>

          <div className="catalogue-filter-field">
            <label htmlFor="filter-identity">Canonical Identity</label>
            <select
              id="filter-identity"
              value={selectedIdentity}
              onChange={(e) => setSelectedIdentity(e.target.value)}
            >
              <option value="ALL">All Identities</option>
              <option value="MATCHED_CANONICAL">Matched Canonical</option>
              <option value="PROVISIONAL">Provisional</option>
              <option value="UNRESOLVED">Unresolved</option>
              <option value="INVALID_PROVIDER_REFERENCE">Invalid Provider Ref</option>
              <option value="DUPLICATE">Duplicate</option>
            </select>
          </div>

          <div className="catalogue-filter-field">
            <label htmlFor="filter-disposition">Research Disposition</label>
            <select
              id="filter-disposition"
              value={selectedDisposition}
              onChange={(e) => setSelectedDisposition(e.target.value)}
            >
              <option value="ALL">All Dispositions</option>
              <option value="FIRST_PARTY_WEB_VERIFICATION">First-Party Web Verification</option>
              <option value="OWNER_CONFIRMATION">Owner Confirmation</option>
              <option value="EVIDENCE_ALREADY_AVAILABLE">Evidence Already Available</option>
              <option value="PRO_ELIGIBLE_LATER">Pro Eligible Later</option>
              <option value="ENTERPRISE_ELIGIBLE_LATER">Enterprise Eligible Later</option>
              <option value="WAITING_FOR_BUDGET">Waiting for Budget</option>
              <option value="HUMAN_IDENTITY_REVIEW">Human Identity Review</option>
              <option value="NO_ACTION_REQUIRED">No Action Required</option>
            </select>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="operator-empty error" role="alert" style={{ marginBottom: "16px" }}>
          <h2>Catalogue data unavailable</h2>
          <p>{error}</p>
          <button type="button" className="operator-button" onClick={() => loadCatalogue()} style={{ marginTop: "12px" }}>
            Retry Query
          </button>
        </div>
      )}

      {/* 4. Split Layout: Collection Table + ECC V3 Workbench Drawer */}
      <div className="catalogue-split-layout">
        {/* Collection Table Panel */}
        <div className="catalogue-collection-panel">
          <div className="collection-table-wrap">
            <table
              className="collection-table"
              onKeyDown={handleKeyDown}
              tabIndex={0}
              aria-label="Discovered Entities Catalogue Grid"
            >
              <thead>
                <tr>
                  <th scope="col" style={{ width: "22%" }}>Entity</th>
                  <th scope="col" style={{ width: "12%" }}>Profile</th>
                  <th scope="col" style={{ width: "14%" }}>Location</th>
                  <th scope="col" style={{ width: "12%" }}>Capability</th>
                  <th scope="col" style={{ width: "12%" }}>Identity</th>
                  <th scope="col" style={{ width: "12%" }}>Top Channels</th>
                  <th scope="col" style={{ width: "12%" }}>Research</th>
                  <th scope="col" style={{ width: "4%" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", padding: "36px", color: "#65746c" }}>
                      Loading catalogue entities from production projection…
                    </td>
                  </tr>
                )}
                {!loading && data?.items.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", padding: "48px" }}>
                      <div className="operator-empty">
                        <h2>No entities match current filters</h2>
                        <p>Try resetting filters or adjusting search parameters.</p>
                      </div>
                    </td>
                  </tr>
                )}
                {!loading &&
                  data?.items.map((item, idx) => {
                    const isSelected = selectedItem?.external_reference_id === item.external_reference_id;
                    return (
                      <tr
                        key={item.external_reference_id}
                        ref={(el) => {
                          rowRefs.current[idx] = el;
                        }}
                        className={`catalogue-table-row ${isSelected ? "is-selected" : ""}`}
                        onClick={() => openDrawer(item, idx)}
                        onFocus={() => setFocusedRowIndex(idx)}
                        tabIndex={0}
                        aria-selected={isSelected}
                        style={{ cursor: "pointer" }}
                      >
                        <td>
                          <strong>{item.entity_name || item.discovery_query || item.external_reference_id}</strong>
                          <small style={{ color: "#7a857f", font: "500 9px 'DM Mono', monospace" }}>
                            {item.external_reference_id.slice(0, 16)}…
                          </small>
                        </td>
                        <td>
                          <span className="operator-badge current" style={{ fontSize: "9px" }}>
                            {item.normalized_profile.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td>
                          <span>{item.locality || item.region || item.country || "—"}</span>
                          {item.country && <small>{item.country}</small>}
                        </td>
                        <td>
                          <span
                            className={`operator-badge ${
                              item.event_capability === "EXPLICIT_EVENT_VENUE"
                                ? "verified"
                                : item.event_capability === "VENUE_CAPABLE_NEEDS_WEB_VERIFICATION"
                                ? "review_required"
                                : "legacy"
                            }`}
                            style={{ fontSize: "8px" }}
                          >
                            {item.event_capability.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`operator-badge ${
                              item.is_invalid_reference
                                ? "rejected"
                                : item.canonical_identity_state === "MATCHED_CANONICAL"
                                ? "current"
                                : "legacy"
                            }`}
                            style={{ fontSize: "8px" }}
                          >
                            {item.canonical_identity_state.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                            {item.resources_route === "STRONG_FIT" && (
                              <span className="route-badge strong" title="Resources: Strong Fit">
                                RES
                              </span>
                            )}
                            {item.context_pos_route === "STRONG_FIT" && (
                              <span className="route-badge strong" title="ContextPOS: Strong Fit">
                                POS
                              </span>
                            )}
                            {item.event_business_route === "STRONG_FIT" && (
                              <span className="route-badge strong" title="Event Business: Strong Fit">
                                EB
                              </span>
                            )}
                            {item.commercial_prospecting_route === "STRONG_FIT" && (
                              <span className="route-badge strong" title="Commercial Prospecting: Strong Fit">
                                PROS
                              </span>
                            )}
                            {item.commercial_prospecting_route === "POSSIBLE_FIT" && (
                              <span className="route-badge possible" title="Commercial Prospecting: Possible Fit">
                                PROS?
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <small style={{ color: "#4b5e54", fontWeight: 500 }}>
                            {item.research_disposition.replace(/_/g, " ")}
                          </small>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="table-action"
                            onClick={(e) => {
                              e.stopPropagation();
                              openDrawer(item, idx);
                            }}
                            aria-label={`Inspect ${item.entity_name || item.external_reference_id}`}
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {data && data.pageCount > 1 && (
            <div className="pagination">
              <span>
                Page <strong>{data.page}</strong> of <strong>{data.pageCount}</strong> ({data.total.toLocaleString()} total)
              </span>
              <button
                type="button"
                disabled={data.page <= 1}
                onClick={() => {
                  const current = new URLSearchParams(Array.from(searchParams.entries()));
                  current.set("page", String(data.page - 1));
                  router.push(`${pathname}?${current.toString()}`);
                }}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={data.page >= data.pageCount}
                onClick={() => {
                  const current = new URLSearchParams(Array.from(searchParams.entries()));
                  current.set("page", String(data.page + 1));
                  router.push(`${pathname}?${current.toString()}`);
                }}
              >
                Next
              </button>
            </div>
          )}
        </div>

        {/* 5. ECC V3 Right-Side Workbench Drawer */}
        {selectedItem && (
          <aside
            ref={drawerRef}
            className="catalogue-workbench-panel"
            aria-label="Entity Workbench Drawer"
            tabIndex={-1}
          >
            {/* Drawer Header */}
            <div className="workbench-header">
              <div>
                <span className="operator-kicker" style={{ color: "#d7ef71" }}>
                  {selectedItem.provider.toUpperCase()} · CANONICAL ENTITY
                </span>
                <h2>{selectedItem.entity_name || selectedItem.discovery_query || "Discovered Entity"}</h2>
                <p>
                  Ref: <span className="mono">{selectedItem.external_reference_id}</span>
                </p>
              </div>
              <button
                type="button"
                className="workbench-close-button"
                onClick={closeDrawer}
                aria-label="Close workbench drawer (Esc)"
              >
                ✕ Esc
              </button>
            </div>

            {/* Workbench Tabs */}
            <div className="workbench-tabs" role="tablist">
              {(
                [
                  ["overview", "Overview"],
                  ["evidence", "Evidence"],
                  ["classification", "Classification"],
                  ["channels", "Channels"],
                  ["research", "Research"],
                  ["listing", "Listing"],
                  ["communications", "Communications"],
                  ["activity", "Activity"],
                ] as const
              ).map(([tabKey, tabLabel]) => (
                <button
                  key={tabKey}
                  type="button"
                  role="tab"
                  aria-selected={drawerTab === tabKey}
                  className={`workbench-tab ${drawerTab === tabKey ? "active" : ""}`}
                  onClick={() => setDrawerTab(tabKey)}
                >
                  {tabLabel}
                </button>
              ))}
            </div>

            {/* Workbench Body */}
            <div className="workbench-body">
              {/* Tab 1: Overview */}
              {drawerTab === "overview" && (
                <>
                  <div className="workbench-section">
                    <h3>Entity Summary</h3>
                    <dl className="workbench-dl">
                      <dt>Entity Name</dt>
                      <dd><strong>{selectedItem.entity_name || "—"}</strong></dd>

                      <dt>Profile</dt>
                      <dd>{selectedItem.normalized_profile.replace(/_/g, " ")}</dd>

                      <dt>Location</dt>
                      <dd>
                        {selectedItem.formatted_address ||
                          [selectedItem.locality, selectedItem.region, selectedItem.country].filter(Boolean).join(", ") ||
                          "—"}
                      </dd>

                      <dt>Discovery Origin</dt>
                      <dd>
                        {selectedItem.discovery_query ? `"${selectedItem.discovery_query}"` : "Direct discovery"}
                        {selectedItem.discovery_campaign ? ` (${selectedItem.discovery_campaign})` : ""}
                      </dd>

                      <dt>Event Capability</dt>
                      <dd>
                        <span className="operator-badge current" style={{ fontSize: "9px" }}>
                          {selectedItem.event_capability.replace(/_/g, " ")}
                        </span>
                      </dd>

                      <dt>Canonical State</dt>
                      <dd>{selectedItem.canonical_identity_state.replace(/_/g, " ")}</dd>

                      <dt>Next Action</dt>
                      <dd>
                        <strong>
                          {selectedItem.research_disposition === "FIRST_PARTY_WEB_VERIFICATION"
                            ? "Execute first-party website verification (Next Stage)"
                            : selectedItem.research_disposition === "OWNER_CONFIRMATION"
                            ? "Request owner confirmation of event hosting"
                            : selectedItem.research_disposition === "EVIDENCE_ALREADY_AVAILABLE"
                            ? "Ready for product routing / no further provider calls required"
                            : selectedItem.research_disposition === "INVALID_PROVIDER_REFERENCE"
                            ? "Reject synthetic/malformed ID — do not dispatch spend"
                            : "Supervised operator triage"}
                        </strong>
                      </dd>
                    </dl>
                  </div>
                </>
              )}

              {/* Tab 2: Evidence */}
              {drawerTab === "evidence" && (
                <>
                  <div className="workbench-section">
                    <h3>Google / Provider Evidence</h3>
                    <dl className="workbench-dl">
                      <dt>Provider</dt>
                      <dd>{selectedItem.provider}</dd>

                      <dt>Place ID</dt>
                      <dd className="mono">{selectedItem.external_reference_id}</dd>

                      <dt>Primary Type</dt>
                      <dd>{selectedItem.provider_primary_type || "—"}</dd>

                      <dt>Types</dt>
                      <dd>{selectedItem.provider_types?.join(", ") || "—"}</dd>

                      <dt>Business Status</dt>
                      <dd>{selectedItem.provider_business_status || "OPERATIONAL"}</dd>

                      <dt>Coordinates</dt>
                      <dd className="mono">
                        {selectedItem.latitude && selectedItem.longitude
                          ? `${selectedItem.latitude}, ${selectedItem.longitude}`
                          : "Not recorded"}
                      </dd>
                    </dl>
                  </div>

                  <div className="workbench-section">
                    <h3>Paid Evidence State</h3>
                    <dl className="workbench-dl">
                      <dt>Pro Evidence</dt>
                      <dd>
                        <span
                          className={`operator-badge ${
                            selectedItem.pro_evidence_state === "EVIDENCE_ALREADY_AVAILABLE" ? "verified" : "legacy"
                          }`}
                        >
                          {selectedItem.pro_evidence_state}
                        </span>
                      </dd>

                      <dt>Enterprise State</dt>
                      <dd>
                        <span className="operator-badge legacy">{selectedItem.enterprise_evidence_state}</span>
                      </dd>

                      <dt>Observed At</dt>
                      <dd>{selectedItem.observed_at ? new Date(selectedItem.observed_at).toLocaleString() : "—"}</dd>

                      <dt>Provider Checked</dt>
                      <dd>
                        {selectedItem.provider_checked_at
                          ? new Date(selectedItem.provider_checked_at).toLocaleString()
                          : "—"}
                      </dd>
                    </dl>
                  </div>
                </>
              )}

              {/* Tab 3: Classification */}
              {drawerTab === "classification" && (
                <>
                  <div className="workbench-section">
                    <h3>Independent Dimensions</h3>
                    <dl className="workbench-dl">
                      <dt>Provider Profile</dt>
                      <dd><strong>{selectedItem.normalized_profile}</strong></dd>

                      <dt>Event Capability</dt>
                      <dd><strong>{selectedItem.event_capability}</strong></dd>

                      <dt>Canonical Identity</dt>
                      <dd><strong>{selectedItem.canonical_identity_state}</strong></dd>

                      <dt>Operating Status</dt>
                      <dd>{selectedItem.is_permanently_closed ? "PERMANENTLY CLOSED" : "OPERATIONAL"}</dd>

                      <dt>Invalid Reference</dt>
                      <dd>{selectedItem.is_invalid_reference ? "YES (Blocked)" : "No (Valid format)"}</dd>

                      <dt>Duplicate</dt>
                      <dd>
                        {selectedItem.is_duplicate
                          ? `Yes (Duplicate of ${selectedItem.duplicate_of_reference_id})`
                          : "No"}
                      </dd>
                    </dl>
                  </div>
                </>
              )}

              {/* Tab 4: Channels */}
              {drawerTab === "channels" && (
                <div className="workbench-section">
                  <h3>Cross-Product Route Rationale</h3>
                  <div className="route-item">
                    <div>
                      <div className="route-name">Resources Directory</div>
                      <small style={{ color: "#65746c" }}>Event venue marketplace directory</small>
                    </div>
                    <span
                      className={`route-badge ${
                        selectedItem.resources_route === "STRONG_FIT"
                          ? "strong"
                          : selectedItem.resources_route === "NEEDS_MORE_EVIDENCE"
                          ? "needs-evidence"
                          : "not-applicable"
                      }`}
                    >
                      {selectedItem.resources_route}
                    </span>
                  </div>

                  <div className="route-item">
                    <div>
                      <div className="route-name">Venue Management</div>
                      <small style={{ color: "#65746c" }}>SaaS venue operating platform</small>
                    </div>
                    <span
                      className={`route-badge ${
                        selectedItem.venue_management_route === "STRONG_FIT" ? "strong" : "not-applicable"
                      }`}
                    >
                      {selectedItem.venue_management_route}
                    </span>
                  </div>

                  <div className="route-item">
                    <div>
                      <div className="route-name">ContextPOS</div>
                      <small style={{ color: "#65746c" }}>Point-of-sale for hospitality/beverage</small>
                    </div>
                    <span
                      className={`route-badge ${
                        selectedItem.context_pos_route === "STRONG_FIT" ? "strong" : "not-applicable"
                      }`}
                    >
                      {selectedItem.context_pos_route}
                    </span>
                  </div>

                  <div className="route-item">
                    <div>
                      <div className="route-name">Ticketing</div>
                      <small style={{ color: "#65746c" }}>Primary and self-service ticketing</small>
                    </div>
                    <span className="route-badge not-applicable">{selectedItem.ticketing_route}</span>
                  </div>

                  <div className="route-item">
                    <div>
                      <div className="route-name">Workforce</div>
                      <small style={{ color: "#65746c" }}>Event shift staffing & crew</small>
                    </div>
                    <span className="route-badge not-applicable">{selectedItem.workforce_route}</span>
                  </div>

                  <div className="route-item">
                    <div>
                      <div className="route-name">Production Ops</div>
                      <small style={{ color: "#65746c" }}>AV, stage & technical production</small>
                    </div>
                    <span className="route-badge not-applicable">{selectedItem.production_ops_route}</span>
                  </div>

                  <div className="route-item">
                    <div>
                      <div className="route-name">Event Business</div>
                      <small style={{ color: "#65746c" }}>Suppliers, catering, decor & rentals</small>
                    </div>
                    <span
                      className={`route-badge ${
                        selectedItem.event_business_route === "STRONG_FIT" ? "strong" : "not-applicable"
                      }`}
                    >
                      {selectedItem.event_business_route}
                    </span>
                  </div>

                  <div className="route-item">
                    <div>
                      <div className="route-name">Commercial Prospecting</div>
                      <small style={{ color: "#65746c" }}>AIRE direct outbound qualification</small>
                    </div>
                    <span
                      className={`route-badge ${
                        selectedItem.commercial_prospecting_route === "STRONG_FIT"
                          ? "strong"
                          : selectedItem.commercial_prospecting_route === "POSSIBLE_FIT"
                          ? "possible"
                          : "not-applicable"
                      }`}
                    >
                      {selectedItem.commercial_prospecting_route}
                    </span>
                  </div>
                </div>
              )}

              {/* Tab 5: Research & Budgets */}
              {drawerTab === "research" && (
                <>
                  <div className="workbench-section">
                    <h3>Research Status & Eligibility</h3>
                    <dl className="workbench-dl">
                      <dt>Disposition</dt>
                      <dd><strong>{selectedItem.research_disposition}</strong></dd>

                      <dt>Pro Eligibility</dt>
                      <dd>{selectedItem.pro_eligibility}</dd>

                      <dt>Enterprise Eligibility</dt>
                      <dd>{selectedItem.enterprise_eligibility}</dd>

                      <dt>Pro Evidence</dt>
                      <dd>{selectedItem.pro_evidence_state}</dd>
                    </dl>
                  </div>

                  {/* Live Budget Overview */}
                  <div className="workbench-section">
                    <h3>Live Nexus Budget Limits</h3>
                    <dl className="workbench-dl">
                      <dt>Google Pro</dt>
                      <dd>
                        Limit: <strong>{budgets?.pro?.monthlyCallLimit ?? 0}</strong> · Consumed:{" "}
                        {budgets?.pro?.callsConsumed ?? 0} · Remaining:{" "}
                        <strong>{budgets?.pro?.remaining ?? 0}</strong>
                      </dd>

                      <dt>Enterprise</dt>
                      <dd>
                        Limit: <strong>{budgets?.enterprise?.monthlyCallLimit ?? 0}</strong> · Consumed:{" "}
                        {budgets?.enterprise?.callsConsumed ?? 0} · Remaining:{" "}
                        <strong>{budgets?.enterprise?.remaining ?? 0}</strong>
                      </dd>

                      <dt>Atmosphere</dt>
                      <dd style={{ color: "#8d493f" }}>
                        <strong>DISABLED</strong> (Limit: 0 · Not available in V1)
                      </dd>
                    </dl>
                  </div>

                  {/* Feedback Banner */}
                  {proFeedback && (
                    <div className={`catalogue-banner ${proFeedback.type}`}>
                      <span>{proFeedback.message}</span>
                    </div>
                  )}
                  {entFeedback && (
                    <div className={`catalogue-banner ${entFeedback.type}`}>
                      <span>{entFeedback.message}</span>
                    </div>
                  )}

                  {/* Manual Promotion to Pro Box */}
                  <div className="promotion-box">
                    <h4>Promote to Pro (Governed Intent)</h4>
                    <p>
                      Overrides automatic business eligibility. Strictly respects monthly budget caps (limit 0: enqueues
                      with waiting status). Zero external provider calls dispatched.
                    </p>

                    {selectedItem.is_invalid_reference ? (
                      <div className="catalogue-banner error">
                        Invalid provider ID. Promotion is blocked by safety guardrails.
                      </div>
                    ) : (
                      <>
                        {selectedItem.pro_evidence_state === "EVIDENCE_ALREADY_AVAILABLE" && (
                          <div className="catalogue-banner suppressed" style={{ marginBottom: "12px" }}>
                            Existing Pro evidence is already available. Promotion request will verify evidence and suppress spend.
                          </div>
                        )}
                        {!proModalOpen ? (
                          <button
                            type="button"
                            className="operator-button"
                            onClick={() => setProModalOpen(true)}
                          >
                            Promote to Pro
                          </button>
                        ) : (
                          <div className="promotion-form">
                            <label>
                              Purpose
                              <input
                                type="text"
                                value={proPurpose}
                                onChange={(e) => setProPurpose(e.target.value)}
                                placeholder="E.g. Commercial Prospecting"
                              />
                            </label>
                            <label>
                              Reason
                              <input
                                type="text"
                                value={proReason}
                                onChange={(e) => setProReason(e.target.value)}
                                placeholder="Reason for manual promotion..."
                              />
                            </label>
                            <label>
                              Originating Channel
                              <select
                                value={proChannel}
                                onChange={(e) => setProChannel(e.target.value)}
                              >
                                <option value="resources">Resources</option>
                                <option value="venue_management">Venue Management</option>
                                <option value="context_pos">ContextPOS</option>
                                <option value="commercial_prospecting">Commercial Prospecting</option>
                              </select>
                            </label>
                            <div className="promotion-actions">
                              <button
                                type="button"
                                className="operator-button"
                                disabled={proSubmitting || !proReason.trim()}
                                onClick={handlePromotePro}
                              >
                                {proSubmitting ? "Queueing..." : "Confirm & Queue Intent"}
                              </button>
                              <button
                                type="button"
                                className="operator-button secondary"
                                onClick={() => setProModalOpen(false)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Manual Promote to Enterprise Box */}
                  <div className="promotion-box enterprise-box">
                    <h4>Promote to Enterprise (Escalation)</h4>
                    <p>
                      Resolves explicit unresolved evidence gaps. Strictly requires mandatory reason and evidence gap.
                      Zero provider calls dispatched under current 0 budget.
                    </p>

                    {selectedItem.is_invalid_reference ? (
                      <div className="catalogue-banner error">
                        Invalid provider ID. Enterprise promotion blocked.
                      </div>
                    ) : selectedItem.enterprise_evidence_state === "EVIDENCE_ALREADY_AVAILABLE" ? (
                      <div className="catalogue-banner suppressed">
                        Existing evidence satisfies this request. Spend suppressed.
                      </div>
                    ) : (
                      <>
                        {!entModalOpen ? (
                          <button
                            type="button"
                            className="operator-button"
                            onClick={() => setEntModalOpen(true)}
                          >
                            Promote to Enterprise
                          </button>
                        ) : (
                          <div className="promotion-form">
                            <label>
                              Purpose
                              <input
                                type="text"
                                value={entPurpose}
                                onChange={(e) => setEntPurpose(e.target.value)}
                              />
                            </label>
                            <label>
                              Mandatory Reason
                              <input
                                type="text"
                                value={entReason}
                                onChange={(e) => setEntReason(e.target.value)}
                                placeholder="Why is Enterprise tier needed?"
                              />
                            </label>
                            <label>
                              Evidence Gap Reason
                              <input
                                type="text"
                                value={entEvidenceGap}
                                onChange={(e) => setEntEvidenceGap(e.target.value)}
                                placeholder="Unresolved space, capacity, or booking evidence..."
                              />
                            </label>
                            <label>
                              Originating Channel
                              <select
                                value={entChannel}
                                onChange={(e) => setEntChannel(e.target.value)}
                              >
                                <option value="resources">Resources</option>
                                <option value="venue_management">Venue Management</option>
                              </select>
                            </label>
                            <div className="promotion-actions">
                              <button
                                type="button"
                                className="operator-button"
                                disabled={entSubmitting || !entReason.trim() || !entEvidenceGap.trim()}
                                onClick={handlePromoteEnterprise}
                              >
                                {entSubmitting ? "Queueing..." : "Confirm & Queue Enterprise"}
                              </button>
                              <button
                                type="button"
                                className="operator-button secondary"
                                onClick={() => setEntModalOpen(false)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}

              {/* Tab 6: Listing */}
              {drawerTab === "listing" && (
                <div className="workbench-section">
                  <h3>Resources Listing & Directory Handoff</h3>
                  <dl className="workbench-dl">
                    <dt>Resources Status</dt>
                    <dd>
                      <span
                        className={`route-badge ${
                          selectedItem.resources_route === "STRONG_FIT" ? "strong" : "not-applicable"
                        }`}
                      >
                        {selectedItem.resources_route}
                      </span>
                    </dd>

                    <dt>Venue Capability</dt>
                    <dd>{selectedItem.event_capability.replace(/_/g, " ")}</dd>

                    <dt>Governance Rule</dt>
                    <dd style={{ color: "#65746c" }}>
                      Event Suite / Resources owns listing, claim, and publication state. AIRE Catalogue routes candidates
                      without direct table writes.
                    </dd>
                  </dl>
                </div>
              )}

              {/* Tab 7: Communications */}
              {drawerTab === "communications" && (
                <div className="workbench-section">
                  <h3>Communications & Outreach</h3>
                  <dl className="workbench-dl">
                    <dt>Owner Confirmation</dt>
                    <dd>{selectedItem.owner_confirmation_route}</dd>

                    <dt>Outbound Policy</dt>
                    <dd style={{ color: "#65746c" }}>
                      Automated communication dispatch is disabled. Any outbound correspondence requires explicit operator
                      review in Outreach Drafts.
                    </dd>
                  </dl>
                </div>
              )}

              {/* Tab 8: Activity */}
              {drawerTab === "activity" && (
                <div className="workbench-section">
                  <h3>Audit & Activity History</h3>
                  <dl className="workbench-dl">
                    <dt>Last Routed At</dt>
                    <dd>{new Date(selectedItem.last_routed_at).toLocaleString()}</dd>

                    <dt>Observed At</dt>
                    <dd>{selectedItem.observed_at ? new Date(selectedItem.observed_at).toLocaleString() : "—"}</dd>

                    <dt>Status</dt>
                    <dd>{selectedItem.catalogue_status}</dd>
                  </dl>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
