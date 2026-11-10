const configuredSiteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.VERCEL_PROJECT_PRODUCTION_URL ??
  process.env.VERCEL_URL ??
  "https://jejaringnusa.my.id";

const normalizedSiteUrl = /^https?:\/\//i.test(configuredSiteUrl)
  ? configuredSiteUrl
  : `https://${configuredSiteUrl}`;

export const siteUrl = new URL(normalizedSiteUrl).origin;
