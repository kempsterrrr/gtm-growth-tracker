const FREEMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com",
  "hotmail.co.uk", "outlook.com", "live.com", "msn.com", "aol.com",
  "icloud.com", "me.com", "mac.com", "protonmail.com", "proton.me",
  "mail.com", "zoho.com", "yandex.com", "gmx.com", "gmx.de",
  "fastmail.com", "tutanota.com", "hey.com", "pm.me",
  "users.noreply.github.com", "github.com",
]);

export function extractDomain(email: string): string {
  const parts = email.split("@");
  return (parts[1] || "").toLowerCase().trim();
}

export function isFreemailDomain(domain: string): boolean {
  return FREEMAIL_DOMAINS.has(domain.toLowerCase());
}

export function normalizeCompanyName(raw: string): string {
  let name = raw.trim();
  // Strip leading @ (GitHub org reference)
  if (name.startsWith("@")) name = name.slice(1);
  // Remove common suffixes
  name = name
    .replace(/,?\s*(Inc\.?|LLC|Ltd\.?|Corp\.?|Co\.?|GmbH|S\.A\.?|B\.V\.?|PLC|Pty\.?)$/i, "")
    .trim();
  return name;
}

export function domainToCompanyName(domain: string): string {
  // acme.com -> Acme, big-corp.io -> Big Corp
  const name = domain.split(".")[0]
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return name;
}
