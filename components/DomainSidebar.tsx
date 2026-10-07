"use client";

import { Link, Sidebar, useSidebar } from "@cloudflare/kumo";
import { GlobeHemisphereWestIcon } from "@phosphor-icons/react";
import { bareDomain, type DomainFile } from "@/shared/dns";

const PINNED: readonly DomainFile[] = ["hackclub.com.yaml", "dino.icu.yaml"];

export function DomainSidebar({
  domainFiles,
  selectedDomain,
  onSelect,
}: {
  domainFiles: readonly DomainFile[];
  selectedDomain: DomainFile;
  onSelect: (domain: DomainFile) => void;
}) {
  const { setOpenMobile } = useSidebar();

  const sections = [
    { title: "Pinned", items: domainFiles.filter((d) => PINNED.includes(d)) },
    { title: "All domains", items: domainFiles },
  ];

  return (
    <Sidebar className="md:sticky md:top-0 md:h-svh">
      <Sidebar.Header>
        <div className="flex items-center gap-2 px-1 py-1">
          <span className="flex size-7 items-center justify-center rounded-md bg-kumo-brand text-white">
            <GlobeHemisphereWestIcon weight="bold" className="size-4" />
          </span>
          <span className="text-sm font-semibold">Hack Club DNS</span>
        </div>
      </Sidebar.Header>

      <Sidebar.Content>
        {sections.map((sec) => (
          <Sidebar.Group key={sec.title}>
            <Sidebar.GroupLabel>{sec.title}</Sidebar.GroupLabel>
            <Sidebar.Menu>
              {sec.items.map((d) => (
                <Sidebar.MenuButton
                  key={d}
                  size="sm"
                  active={d === selectedDomain}
                  aria-current={d === selectedDomain ? "page" : undefined}
                  onClick={() => {
                    onSelect(d);
                    setOpenMobile(false);
                  }}
                >
                  {bareDomain(d)}
                </Sidebar.MenuButton>
              ))}
            </Sidebar.Menu>
          </Sidebar.Group>
        ))}
      </Sidebar.Content>

      <Sidebar.Footer>
        <p className="px-2 py-1 text-xs text-kumo-subtle">
          Made by{" "}
          <Link href="https://3kh0.net" target="_blank" rel="noreferrer">
            3kh0
          </Link>
        </p>
      </Sidebar.Footer>
    </Sidebar>
  );
}
