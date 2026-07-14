export const DOMAIN_FILES = [
  "aisafety.dance.yaml",
  "bank.engineering.yaml",
  "bulckcah.com.yaml",
  "cpu.land.yaml",
  "dino.icu.yaml",
  "dinosaurbbq.org.yaml",
  "hack.af.yaml",
  "hack.club.yaml",
  "hackclub.app.yaml",
  "hackclub.com.yaml",
  "hackclub.io.yaml",
  "hackclub.org.yaml",
  "hackedu.us.yaml",
  "hackfoundation.org.yaml",
  "nonprofit.new.yaml",
] as const;

export const DEFAULT_DOMAIN = "hackclub.com.yaml";

export type DomainFile = (typeof DOMAIN_FILES)[number];

export function isDomainFile(value: string): value is DomainFile {
  return DOMAIN_FILES.some((domain) => domain === value);
}
