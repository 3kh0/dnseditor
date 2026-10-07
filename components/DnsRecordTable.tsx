"use client";

import { Badge, Button, cn, DropdownMenu, LayerCard, Table, Tooltip } from "@cloudflare/kumo";
import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretRightIcon,
  CloudIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMediaQuery } from "@/lib/client/use-media-query";
import {
  bareDomain,
  CNAME_PROVIDER_LABELS,
  detectCnameProvider,
  fmtDnsValue,
  supportsCfProxy,
  type CnameProvider,
} from "@/shared/dns";
import type { DnsMxValue, DnsRecordGroup, DnsValue } from "@/shared/types/dns";
import { HighlightedText } from "./HighlightedText";
import { ProviderIcon } from "./ProviderIcon";

export interface EditPayload {
  subdomain: string;
  type: string;
  value: string;
  ttl?: number;
  mxPreference?: number;
  proxied?: boolean;
  contact?: string;
}

interface Row {
  siteUrl: string | null;
  subdomain: string;
  ttl?: number;
  type: string;
  value: DnsValue;
  proxied?: boolean;
  provider: CnameProvider | null;
  contact?: string;
}

// A single record whose name + type matches its neighbours; a run longer than
// COLLAPSE_THRESHOLD becomes one collapsible cluster.
type Entry = { kind: "single"; row: Row } | { kind: "cluster"; key: string; rows: Row[] };

// Flattened (paginated) entries to render: a collapsed cluster is one summary row;
// an expanded one is a summary row followed by its children.
interface ViewRow {
  kind: "row" | "summary";
  row: Row;
  key: string;
  count: number;
  open: boolean;
}

const MOBILE_PAGE_SIZE = 50;
const DESKTOP_PAGE_SIZE = 100;
const COLLAPSE_THRESHOLD = 6;

const SKIP = [
  "amazonses.com",
  "_acme.deno.dev",
  "acm-validations",
  "custom-email-domain.stripe.com",
  "verify.bing.com",
];

const SITE_TYPES = new Set(["A", "AAAA", "CNAME", "ALIAS"]);

const isMx = (v: DnsValue): v is DnsMxValue => typeof v === "object" && v !== null;

function formatTtl(ttl?: number): string {
  if (ttl === undefined) return "Auto";
  if (ttl % 86400 === 0) {
    const days = ttl / 86400;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (ttl % 3600 === 0) {
    const hours = ttl / 3600;
    return `${hours} hr${hours === 1 ? "" : "s"}`;
  }
  if (ttl % 60 === 0) return `${ttl / 60} min`;
  return `${ttl}s`;
}

function contentText(row: Row): string {
  if (row.type === "MX" && isMx(row.value)) {
    const priority = row.value.priority ?? row.value.preference;
    const exchange = row.value.exchange || "Invalid";
    return priority === undefined ? exchange : `${priority} ${exchange}`;
  }
  if (row.value === "") return "No value";
  return fmtDnsValue(row.value);
}

function toPayload(row: Row): EditPayload {
  if (row.type === "MX" && isMx(row.value)) {
    return {
      subdomain: row.subdomain,
      type: row.type,
      value: row.value.exchange ? String(row.value.exchange) : "",
      ttl: row.ttl,
      mxPreference: Number(row.value.preference ?? row.value.priority ?? 10),
      proxied: row.proxied,
      contact: row.contact,
    };
  }

  return {
    subdomain: row.subdomain,
    type: row.type,
    value: row.value === "" ? "" : fmtDnsValue(row.value),
    ttl: row.ttl,
    proxied: row.proxied,
    contact: row.contact,
  };
}

export function DnsRecordTable({
  domain,
  groups,
  searchQuery,
  onEdit,
  onDelete,
  className,
}: {
  domain: string;
  groups: DnsRecordGroup[];
  searchQuery?: string;
  onEdit: (payload: EditPayload) => void;
  onDelete: (payload: EditPayload) => void;
  className?: string;
}) {
  const isMobile = useMediaQuery("(max-width: 767px)", true);
  const pageSize = isMobile ? MOBILE_PAGE_SIZE : DESKTOP_PAGE_SIZE;
  const [limit, setLimit] = useState(pageSize);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);

  const bare = bareDomain(domain);
  const displayName = useCallback(
    (sub: string) => (!sub || sub === "@" ? bare : `${sub}.${bare}`),
    [bare],
  );

  // A new record set or search starts back at the first page with clusters folded.
  const [resetKey, setResetKey] = useState({ groups, searchQuery, pageSize });
  if (
    resetKey.groups !== groups ||
    resetKey.searchQuery !== searchQuery ||
    resetKey.pageSize !== pageSize
  ) {
    setResetKey({ groups, searchQuery, pageSize });
    setLimit(pageSize);
    setExpanded(new Set());
  }

  const rows = useMemo<Row[]>(() => {
    const siteUrl = (sub: string, type: string, value: DnsValue) => {
      if (!SITE_TYPES.has(type)) return null;
      if (type === "CNAME" && typeof value === "string" && SKIP.some((t) => value.includes(t))) {
        return null;
      }
      const prefix = !sub || sub === "@" ? "" : `${sub}.`;
      return `https://${prefix}${bare}`;
    };

    return groups.flatMap((g) =>
      g.records.flatMap((r) =>
        (r.values.length ? r.values : [""]).map((value) => ({
          siteUrl: siteUrl(g.subdomain, r.type, value),
          subdomain: g.subdomain,
          ttl: r.ttl,
          type: r.type,
          value,
          proxied: r.proxied,
          provider: detectCnameProvider(r.type, value),
          contact: g.contact,
        })),
      ),
    );
  }, [groups, bare]);

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    let i = 0;
    while (i < rows.length) {
      const start = i;
      const head = rows[i]!;
      i++;
      while (
        i < rows.length &&
        rows[i]!.subdomain === head.subdomain &&
        rows[i]!.type === head.type
      )
        i++;
      const run = rows.slice(start, i);
      if (run.length > COLLAPSE_THRESHOLD) {
        out.push({ kind: "cluster", key: `${head.subdomain} ${head.type}`, rows: run });
      } else {
        for (const row of run) out.push({ kind: "single", row });
      }
    }
    return out;
  }, [rows]);

  const viewRows = useMemo<ViewRow[]>(() => {
    const out: ViewRow[] = [];
    for (const e of entries.slice(0, limit)) {
      if (e.kind === "single") {
        out.push({ kind: "row", row: e.row, key: "", count: 1, open: false });
        continue;
      }
      const open = expanded.has(e.key);
      out.push({ kind: "summary", row: e.rows[0]!, key: e.key, count: e.rows.length, open });
      if (open) {
        for (const row of e.rows) out.push({ kind: "row", row, key: e.key, count: 1, open: true });
      }
    }
    return out;
  }, [entries, limit, expanded]);

  const hasMore = entries.length > limit;

  useEffect(() => {
    if (!sentinel || !hasMore) return;
    const observer = new IntersectionObserver(
      (obs) => {
        if (obs[0]?.isIntersecting) setLimit((l) => l + pageSize);
      },
      { rootMargin: "300px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, hasMore, pageSize]);

  const toggleCluster = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const showProxy = (row: Row) => supportsCfProxy(domain, row.type);
  const recordCount = `${rows.length} ${rows.length === 1 ? "record" : "records"}`;

  const actionsMenu = (row: Row, label: string) => (
    <DropdownMenu>
      <DropdownMenu.Trigger
        render={
          <Button
            variant="ghost"
            size="sm"
            shape="square"
            icon={<DotsThreeIcon weight="bold" />}
            aria-label={`More actions for ${label}`}
          />
        }
      />
      <DropdownMenu.Content align="end">
        {row.siteUrl && (
          <DropdownMenu.LinkItem href={row.siteUrl} target="_blank" icon={ArrowSquareOutIcon}>
            Open site
          </DropdownMenu.LinkItem>
        )}
        <DropdownMenu.Item icon={PencilSimpleIcon} onClick={() => onEdit(toPayload(row))}>
          Edit
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item
          icon={TrashIcon}
          variant="danger"
          onClick={() => onDelete(toPayload(row))}
        >
          Delete
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );

  const sentinelEl = hasMore && <div ref={setSentinel} className="h-1" aria-hidden="true" />;

  if (isMobile) {
    return (
      <div className={className}>
        <p className="mb-2.5 text-sm font-medium">{recordCount}</p>

        <div className="space-y-2">
          {viewRows.map((vr, i) => {
            if (vr.kind === "summary") {
              return (
                <button
                  key={`s-${vr.key}`}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-xl bg-kumo-base px-3 py-3 text-left ring ring-kumo-hairline active:bg-kumo-tint"
                  aria-expanded={vr.open}
                  onClick={() => toggleCluster(vr.key)}
                >
                  <Badge variant="neutral" className="font-mono">
                    {vr.row.type}
                  </Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium break-all">
                      {displayName(vr.row.subdomain)}
                    </span>
                    <span className="text-xs text-kumo-subtle">
                      {vr.count} records — tap to {vr.open ? "collapse" : "expand"}
                    </span>
                  </span>
                  <CaretDownIcon
                    className={cn(
                      "size-5 shrink-0 text-kumo-subtle transition-transform",
                      vr.open && "rotate-180",
                    )}
                  />
                </button>
              );
            }

            const row = vr.row;
            const name = displayName(row.subdomain);
            return (
              <article
                key={i}
                className={cn(
                  "relative rounded-xl bg-kumo-base ring ring-kumo-hairline",
                  vr.open && "ml-3 border-l-2 border-kumo-brand",
                )}
              >
                <button
                  type="button"
                  className="w-full rounded-xl px-3 pt-2.5 text-left active:bg-kumo-tint"
                  aria-label={`Edit ${row.type} record for ${name}`}
                  onClick={() => onEdit(toPayload(row))}
                >
                  <div className="flex items-center gap-2 pr-9">
                    <Badge variant="neutral" className="font-mono">
                      <HighlightedText text={row.type} query={searchQuery} />
                    </Badge>
                    {showProxy(row) && (
                      <span className="ml-auto inline-flex items-center gap-1 text-xs text-kumo-subtle">
                        <CloudIcon
                          weight={row.proxied ? "fill" : "regular"}
                          className={cn("size-4", row.proxied && "text-kumo-brand")}
                        />
                        {row.proxied ? "Proxied" : "DNS only"}
                      </span>
                    )}
                  </div>

                  <h3 className="mt-1.5 text-sm leading-5 font-medium break-all">
                    <HighlightedText text={name} query={searchQuery} />
                  </h3>

                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5 pb-2 text-[13px] text-kumo-strong">
                    {row.provider ? (
                      <>
                        <ProviderIcon provider={row.provider} />
                        <span className="truncate">{CNAME_PROVIDER_LABELS[row.provider]}</span>
                      </>
                    ) : (
                      <span className={cn("truncate", row.type === "TXT" && "font-mono text-xs")}>
                        <HighlightedText text={contentText(row)} query={searchQuery} />
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-kumo-hairline py-2 text-xs text-kumo-subtle">
                    <span>TTL {formatTtl(row.ttl)}</span>
                    <CaretRightIcon className="size-4" />
                  </div>
                </button>

                <div className="absolute top-1.5 right-1.5">{actionsMenu(row, name)}</div>
              </article>
            );
          })}
        </div>

        {sentinelEl}
      </div>
    );
  }

  return (
    <LayerCard className={className}>
      <LayerCard.Secondary className="text-sm font-medium">{recordCount}</LayerCard.Secondary>
      <LayerCard.Primary className="overflow-x-auto p-0">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.Head>Name</Table.Head>
              <Table.Head>Type</Table.Head>
              <Table.Head>Content</Table.Head>
              <Table.Head>TTL</Table.Head>
              <Table.Head>
                <span className="sr-only">Actions</span>
              </Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {viewRows.map((vr, i) => {
              if (vr.kind === "summary") {
                return (
                  <Table.Row
                    key={`s-${vr.key}`}
                    className="cursor-pointer"
                    onClick={() => toggleCluster(vr.key)}
                  >
                    <Table.Cell className="max-w-64 truncate" title={displayName(vr.row.subdomain)}>
                      {displayName(vr.row.subdomain)}
                    </Table.Cell>
                    <Table.Cell className="font-medium">{vr.row.type}</Table.Cell>
                    <Table.Cell colSpan={3}>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 text-kumo-subtle"
                        aria-expanded={vr.open}
                      >
                        <CaretDownIcon
                          className={cn("size-4 transition-transform", vr.open && "rotate-180")}
                        />
                        <span className="text-kumo-default">{vr.count} records</span>
                        <span>— {vr.open ? "hide" : "show all"}</span>
                      </button>
                    </Table.Cell>
                  </Table.Row>
                );
              }

              const row = vr.row;
              const name = displayName(row.subdomain);
              return (
                <Table.Row key={i} className={cn(vr.open && "bg-kumo-elevated")}>
                  <Table.Cell className={cn("max-w-64 truncate", vr.open && "pl-8")} title={name}>
                    <HighlightedText text={name} query={searchQuery} />
                  </Table.Cell>
                  <Table.Cell className="font-medium">
                    <HighlightedText text={row.type} query={searchQuery} />
                  </Table.Cell>
                  <Table.Cell
                    className="max-w-96 truncate text-kumo-subtle"
                    title={fmtDnsValue(row.value)}
                  >
                    {row.type === "MX" && isMx(row.value) ? (
                      <>
                        <span>Priority: </span>
                        {row.value.priority !== undefined || row.value.preference !== undefined ? (
                          <span className="text-kumo-default">
                            <HighlightedText
                              text={String(row.value.priority ?? row.value.preference)}
                              query={searchQuery}
                            />
                          </span>
                        ) : (
                          <span className="text-kumo-warning">Invalid Priority</span>
                        )}
                        <span>, Exchange: </span>
                        {row.value.exchange ? (
                          <span className="text-kumo-default">
                            <HighlightedText text={row.value.exchange} query={searchQuery} />
                          </span>
                        ) : (
                          <span className="text-kumo-warning">Invalid Exchange</span>
                        )}
                      </>
                    ) : row.provider ? (
                      <span className="inline-flex items-center gap-1.5 text-kumo-default">
                        <ProviderIcon provider={row.provider} />
                        {CNAME_PROVIDER_LABELS[row.provider]}
                      </span>
                    ) : row.value !== "" ? (
                      <span
                        className={cn(
                          "text-kumo-default",
                          row.type === "TXT" && "font-mono text-xs",
                        )}
                      >
                        <HighlightedText text={fmtDnsValue(row.value)} query={searchQuery} />
                      </span>
                    ) : (
                      <span>No value</span>
                    )}
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-kumo-subtle">
                    <span className="inline-flex items-center gap-1.5">
                      {domain === "hackclub.com.yaml" && row.proxied && row.ttl === undefined && (
                        <Tooltip
                          content="Proxied through Cloudflare"
                          render={
                            <span className="inline-flex" aria-label="Proxied through Cloudflare">
                              <CloudIcon weight="fill" className="size-4 text-kumo-brand" />
                            </span>
                          }
                        />
                      )}
                      {row.ttl ?? "Auto"}
                    </span>
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <div className="inline-flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={PencilSimpleIcon}
                        onClick={() => onEdit(toPayload(row))}
                      >
                        Edit
                      </Button>
                      {actionsMenu(row, name)}
                    </div>
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
        {sentinelEl}
      </LayerCard.Primary>
    </LayerCard>
  );
}
