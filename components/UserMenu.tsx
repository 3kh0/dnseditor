"use client";

import { Button, DropdownMenu } from "@cloudflare/kumo";
import { CaretDownIcon, GithubLogoIcon, SignOutIcon } from "@phosphor-icons/react";
import { useAuth } from "@/lib/client/auth";

export function UserMenu() {
  const { authenticated, user, pending, login, logout } = useAuth();

  if (pending && !user) {
    return <div className="size-9 animate-pulse rounded-lg bg-kumo-tint" aria-hidden />;
  }

  if (authenticated && user) {
    return (
      <DropdownMenu>
        <DropdownMenu.Trigger
          render={
            <Button variant="secondary" aria-label={`Account menu for ${user.login}`}>
              {user.avatarUrl && (
                // oxlint-disable-next-line nextjs/no-img-element -- tiny avatar, no optimisation needed
                <img
                  src={user.avatarUrl}
                  alt=""
                  width={20}
                  height={20}
                  className="size-5 rounded-full"
                />
              )}
              <span className="hidden max-w-28 truncate sm:inline">{user.login}</span>
              <CaretDownIcon className="size-3.5 text-kumo-subtle" />
            </Button>
          }
        />
        <DropdownMenu.Content align="end">
          <DropdownMenu.Label>Signed in as @{user.login}</DropdownMenu.Label>
          <DropdownMenu.LinkItem
            href={`https://github.com/${user.login}`}
            target="_blank"
            icon={GithubLogoIcon}
          >
            GitHub profile
          </DropdownMenu.LinkItem>
          <DropdownMenu.Separator />
          <DropdownMenu.Item icon={SignOutIcon} onClick={() => void logout()}>
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu>
    );
  }

  return (
    <Button variant="secondary" icon={GithubLogoIcon} onClick={() => login()}>
      <span className="hidden sm:inline">Sign in with GitHub</span>
      <span className="sm:hidden">Sign in</span>
    </Button>
  );
}
