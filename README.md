# Hack Club DNS Editor

A Nuxt app for browsing Hack Club's DNS records and opening pull requests to add subdomains on [`hackclub/dns`](https://github.com/hackclub/dns).

## Development

This project uses [Bun](https://bun.sh/):

```bash
bun install
cp .env.example .env   # then fill in the GitHub App credentials
bun run dev
```

The GitHub App needs these repository permissions:

- **Contents:** Read and write
- **Pull requests:** Read and write
- **Workflows:** Read and write

## Live demo

Use it at [dns.hackclub.com](https://dns.hackclub.com)
