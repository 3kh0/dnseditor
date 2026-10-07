"use client";

import {
  Banner,
  Button,
  Empty,
  InputGroup,
  LinkButton,
  Loader,
  Sidebar,
  Text,
} from "@cloudflare/kumo";
import {
  CodeIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  WarningCircleIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import {
  bareDomain,
  DEFAULT_DOMAIN,
  DOMAIN_FILES,
  fmtDnsValue,
  isDomainFile,
  type DomainFile,
} from "@/shared/dns";
import type { DnsRecordGroup, DnsValue } from "@/shared/types/dns";
import { DnsRecordTable, type EditPayload } from "./DnsRecordTable";
import { DomainSidebar } from "./DomainSidebar";
import { EditRecordDialog } from "./EditRecordDialog";
import { UserMenu } from "./UserMenu";

const searchable = (v: DnsValue) => fmtDnsValue(v).toLocaleLowerCase();

// Relevance tiers. Name matches always outrank record-content matches, so the
// subdomain you're looking for floats to the top instead of drowning under
// records that merely happen to contain the query inside a long value.
const SCORE = { nameExact: 100, namePrefix: 80, namePart: 55, typeHit: 30, valueHit: 15 } as const;

interface RecordsResult {
  domain: DomainFile;
  records: DnsRecordGroup[];
  error: string | null;
}

const errMessage = (e: unknown) => (e instanceof Error ? e.message : "Failed to load records");

const fetchRecords = (domain: DomainFile, fresh: boolean) =>
  // An explicit reload must skip every cache layer.
  fresh
    ? api<DnsRecordGroup[]>(`/api/domains/${domain}?fresh=1`, { cache: "no-store" })
    : api<DnsRecordGroup[]>(`/api/domains/${domain}`);

function useDomainRecords(domain: DomainFile) {
  const [result, setResult] = useState<RecordsResult | null>(null);
  const [reloading, setReloading] = useState<DomainFile | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    fetchRecords(domain, false).then(
      (records) => id === seq.current && setResult({ domain, records, error: null }),
      (e) => id === seq.current && setResult({ domain, records: [], error: errMessage(e) }),
    );
  }, [domain]);

  // Switching domains blanks the table; a background reload keeps the current rows.
  const current = result?.domain === domain ? result : null;

  const reload = useCallback(async () => {
    const id = ++seq.current;
    setReloading(domain);
    try {
      const records = await fetchRecords(domain, true);
      if (id === seq.current) setResult({ domain, records, error: null });
    } catch (e) {
      if (id === seq.current) {
        setResult((r) => ({
          domain,
          records: r?.domain === domain ? r.records : [],
          error: errMessage(e),
        }));
      }
    } finally {
      setReloading((d) => (d === domain ? null : d));
    }
  }, [domain]);

  return {
    records: current?.records ?? EMPTY_RECORDS,
    error: current?.error ?? null,
    pending: !current || reloading === domain,
    reload,
  };
}

const EMPTY_RECORDS: DnsRecordGroup[] = [];

export function DnsEditor({
  initialDomain,
  initialAuthError,
  initialOpenAdd = false,
}: {
  initialDomain?: string;
  initialAuthError?: string;
  initialOpenAdd?: boolean;
}) {
  const [selectedDomain, setSelectedDomain] = useState<DomainFile>(
    initialDomain && isDomainFile(initialDomain) ? initialDomain : DEFAULT_DOMAIN,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [authError, setAuthError] = useState(initialAuthError ?? null);
  const [dialog, setDialog] = useState<{
    open: boolean;
    editing: EditPayload | null;
    mode: "edit" | "delete";
  }>({ open: initialOpenAdd, editing: null, mode: "edit" });

  const { records, error, pending, reload } = useDomainRecords(selectedDomain);
  const loading = pending && records.length === 0;
  const bare = bareDomain(selectedDomain);

  const openAdd = () => setDialog({ open: true, editing: null, mode: "edit" });
  const openEdit = (editing: EditPayload) => setDialog({ open: true, editing, mode: "edit" });
  const openDelete = (editing: EditPayload) => setDialog({ open: true, editing, mode: "delete" });
  const closeDialog = () => setDialog({ open: false, editing: null, mode: "edit" });

  // The OAuth redirect params were consumed into initial state; drop them from the URL.
  useEffect(() => {
    const url = new URL(window.location.href);
    const keys = ["authError", "openAdd", "domain"];
    if (!keys.some((k) => url.searchParams.has(k))) return;
    for (const k of keys) url.searchParams.delete(k);
    window.history.replaceState(null, "", url);
  }, []);

  const matched = useMemo(() => {
    const raw = searchQuery.trim().toLocaleLowerCase();
    if (!raw) return records;

    const b = bare.toLocaleLowerCase();
    // Let people paste a full FQDN — strip the trailing bare domain so
    // "de.hackclub.com" (or the root "hackclub.com") targets the right name.
    let nameQ = raw;
    if (raw === b) nameQ = "@";
    else if (raw.endsWith(`.${b}`)) nameQ = raw.slice(0, -(b.length + 1)) || "@";

    const scored: { group: DnsRecordGroup; score: number }[] = [];

    for (const g of records) {
      const label = g.subdomain.toLocaleLowerCase() || "@";

      let score = 0;
      if (label === nameQ) score = SCORE.nameExact;
      else if (label.startsWith(nameQ)) score = SCORE.namePrefix;
      else if (label.includes(nameQ)) score = SCORE.namePart;

      // A name hit shows the whole subdomain — every record under it is relevant.
      if (score > 0) {
        scored.push({ group: g, score });
        continue;
      }

      // Otherwise keep only the records that actually match, so a single value
      // hit doesn't drag the subdomain's entire (often huge) record set along.
      const hits = g.records.filter(
        (r) =>
          r.type.toLocaleLowerCase().includes(raw) ||
          r.values.some((v) => searchable(v).includes(raw)),
      );
      if (hits.length) {
        const typeHit = hits.some((r) => r.type.toLocaleLowerCase().includes(raw));
        scored.push({
          group: { ...g, records: hits },
          score: typeHit ? SCORE.typeHit : SCORE.valueHit,
        });
      }
    }

    // Stable sort keeps the original file order within a tier.
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.group);
  }, [records, searchQuery, bare]);

  return (
    <Sidebar.Provider collapsible="offcanvas">
      <DomainSidebar
        domainFiles={DOMAIN_FILES}
        selectedDomain={selectedDomain}
        onSelect={setSelectedDomain}
      />

      <main className="min-w-0 flex-1 px-4 py-5 sm:px-8 sm:py-8">
        <div className="mx-auto max-w-6xl">
          <header className="flex items-center justify-between gap-3 sm:items-start">
            <div className="flex min-w-0 items-center gap-2 sm:items-start">
              <Sidebar.Trigger className="-ml-1 sm:mt-0.5" />
              <div className="min-w-0">
                <Text variant="heading" size="lg" as="h1" truncate>
                  DNS records for {bare}
                </Text>
                <p className="mt-1 hidden text-sm text-kumo-subtle sm:block">
                  Browse records for this domain and open pull requests to add or edit subdomains
                  from your fork.
                </p>
              </div>
            </div>
            <div className="shrink-0">
              <UserMenu />
            </div>
          </header>

          {authError && (
            <Banner
              className="mt-4"
              variant="error"
              icon={<WarningCircleIcon weight="fill" />}
              description={authError}
              action={
                <Banner.Action
                  variant="ghost"
                  icon={<XIcon />}
                  aria-label="Dismiss"
                  onClick={() => setAuthError(null)}
                />
              }
            />
          )}

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
            <InputGroup className="w-full min-w-0 sm:flex-1">
              <InputGroup.Addon>
                <MagnifyingGlassIcon />
              </InputGroup.Addon>
              <InputGroup.Input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search names, types, or values"
                aria-label="Search DNS records"
                enterKeyHint="search"
              />
              {searchQuery && (
                <InputGroup.Addon align="end" className="pr-1">
                  <InputGroup.Button
                    shape="square"
                    icon={XIcon}
                    aria-label="Clear search"
                    onClick={() => setSearchQuery("")}
                  />
                </InputGroup.Addon>
              )}
            </InputGroup>

            <div className="grid grid-cols-2 gap-2 sm:flex">
              <LinkButton
                href={`https://github.com/hackclub/dns/blob/main/${selectedDomain}`}
                target="_blank"
                rel="noreferrer"
                variant="secondary"
                icon={CodeIcon}
                title="View source on GitHub"
                className="w-full justify-center sm:w-auto"
              >
                Source
              </LinkButton>
              <Button
                variant="primary"
                icon={PlusIcon}
                className="w-full justify-center sm:w-auto"
                onClick={openAdd}
              >
                Add record
              </Button>
            </div>
          </div>

          {searchQuery && !loading && !error && (
            <p className="mt-3 text-xs text-kumo-subtle" aria-live="polite">
              Showing results for “{searchQuery}”
            </p>
          )}

          {loading ? (
            <div className="flex items-center justify-center p-12">
              <Loader size="lg" />
            </div>
          ) : error ? (
            <Banner
              className="mt-6"
              variant="alert"
              icon={<WarningIcon weight="fill" />}
              description={error}
              action={<Banner.Action onClick={() => void reload()}>Retry</Banner.Action>}
            />
          ) : matched.length === 0 ? (
            <Empty
              className="mt-6"
              icon={<MagnifyingGlassIcon size={40} className="text-kumo-inactive" />}
              title="No matching records"
              description="No names, types, or values match your search."
            />
          ) : (
            <DnsRecordTable
              className="mt-4"
              groups={matched}
              domain={selectedDomain}
              searchQuery={searchQuery}
              onEdit={openEdit}
              onDelete={openDelete}
            />
          )}
        </div>
      </main>

      <EditRecordDialog
        show={dialog.open}
        domain={selectedDomain}
        groups={records}
        groupsPending={pending}
        editing={dialog.editing}
        initialMode={dialog.mode}
        onClose={closeDialog}
        onRefresh={reload}
      />
    </Sidebar.Provider>
  );
}
