export interface DnsMxValue {
  [key: string]: boolean | number | string | null | undefined;
  exchange?: string;
  preference?: number | string;
  priority?: number | string;
}

export type DnsValue = string | number | boolean | DnsMxValue;

export interface DnsRecord {
  ttl?: number;
  type: string;
  values: DnsValue[];
  proxied?: boolean;
}

export interface DnsRecordGroup {
  records: DnsRecord[];
  subdomain: string;
}
