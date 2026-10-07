import { DnsEditor } from "@/components/DnsEditor";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  // Set by the OAuth callback: ?authError=… or ?openAdd=1&domain=…
  const q = await searchParams;
  return (
    <DnsEditor
      initialDomain={str(q.domain)}
      initialAuthError={str(q.authError)}
      initialOpenAdd={q.openAdd === "1"}
    />
  );
}
