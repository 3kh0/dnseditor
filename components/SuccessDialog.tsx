"use client";

import { Button, Dialog, LinkButton } from "@cloudflare/kumo";
import { ArrowSquareOutIcon, CheckCircleIcon } from "@phosphor-icons/react";

export function SuccessDialog({
  open,
  prUrl,
  needsManualPr,
  onClose,
}: {
  open: boolean;
  prUrl?: string;
  needsManualPr?: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog size="lg" className="p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <CheckCircleIcon weight="fill" className="size-14 text-kumo-success" />

          <Dialog.Title className="text-xl font-semibold">
            {needsManualPr ? "Almost there!" : "And that's all done!"}
          </Dialog.Title>

          <Dialog.Description className="text-kumo-subtle">
            {needsManualPr
              ? "Your changes are on a branch in your fork. Open the pull request on GitHub to finish submitting it for review. Opening in the browser will not show the GitHub App badge — only API-opened PRs do."
              : "Your DNS record has been submitted for review. Wait for the PR to be approved and merged. Once it merges, your changes will be live."}
          </Dialog.Description>

          <div className="mt-3 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {prUrl && (
              <LinkButton
                href={prUrl}
                target="_blank"
                rel="noreferrer"
                variant="primary"
                icon={ArrowSquareOutIcon}
              >
                {needsManualPr ? "Open Pull Request" : "View Pull Request"}
              </LinkButton>
            )}
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    </Dialog.Root>
  );
}
