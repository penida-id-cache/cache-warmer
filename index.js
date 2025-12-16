import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { parseStringPromise } from "xml2js";
import * as dotenv from "dotenv";

dotenv.config();

/* ====== ENV ====== */
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

/* ====== DOMAIN / PROXY / UA (SEMUA NEGARA, TIDAK DIKURANGI) ====== */
const DOMAINS_MAP = {
  id: "https://penidadivecenter.com",
  au: "https://penidadivecenter.com",
  no: "https://penidadivecenter.com",
  dk: "https://penidadivecenter.com",
  en: "https://penidadivecenter.com",
  se: "https://penidadivecenter.com",
  fl: "https://penidadivecenter.com",
  my: "https://penidadivecenter.com",
  nz: "https://penidadivecenter.com",
  ae: "https://penidadivecenter.com",
  at: "https://penidadivecenter.com",
  hk: "https://penidadivecenter.com",
  be: "https://penidadivecenter.com",
  it: "https://penidadivecenter.com",
  tr: "https://penidadivecenter.com",
  ch: "https://penidadivecenter.com",
  sa: "https://penidadivecenter.com",
  in: "https://penidadivecenter.com",
  pl: "https://penidadivecenter.com",
  sg: "https://penidadivecenter.com",
  th: "https://penidadivecenter.com",
};

const PROXIES = {
  id: process.env.BRD_PROXY_ID,
  au: process.env.BRD_PROXY_AU,
  no: process.env.BRD_PROXY_NO,
  dk: process.env.BRD_PROXY_DK,
  en: process.env.BRD_PROXY_EN,
  se: process.env.BRD_PROXY_SE,
  fl: process.env.BRD_PROXY_FL,
  my: process.env.BRD_PROXY_MY,
  nz: process.env.BRD_PROXY_NZ,
  ae: process.env.BRD_PROXY_AE,
  at: process.env.BRD_PROXY_AT,
  hk: process.env.BRD_PROXY_HK,
  be: process.env.BRD_PROXY_BE,
  it: process.env.BRD_PROXY_IT,
  tr: process.env.BRD_PROXY_TR,
  ch: process.env.BRD_PROXY_CH,
  sa: process.env.BRD_PROXY_SA,
  in: process.env.BRD_PROXY_IN,
  pl: process.env.BRD_PROXY_PL,
  sg: process.env.BRD_PROXY_SG,
  th: process.env.BRD_PROXY_TH,
};

const USER_AGENTS = Object.fromEntries(
  Object.keys(DOMAINS_MAP).map((k) => [
    k,
    `PenidaDiveCenter-CacheWarmer-${k.toUpperCase()}/1.0`,
  ])
);

/* ====== UTIL ====== */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractCfEdge(cfRay) {
  if (typeof cfRay === "string" && cfRay.includes("-")) {
    return cfRay.split("-").pop();
  }
  return "N/A";
}

/* ====== LOGGER → GSHEETS (SAMA SEPERTI PUNYA KAMU) ====== */
class AppsScriptLogger {
  constructor() {
    this.rows = [];
    this.runId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    this.startedAt = new Date().toISOString();
    this.finishedAt = null;
  }

  log({
    country = "", // CF EDGE
    url = "",
    status = "",
    cfCache = "",
    lsCache = "",
    cfRay = "",
    responseMs = "",
    error = 0,
    message = "",
  } = {}) {
    this.rows.push([
      this.runId,
      this.startedAt,
      this.finishedAt,
      country,
      url,
      status,
      cfCache,
      lsCache,
      cfRay,
      typeof responseMs === "number" ? responseMs : "",
      error ? 1 : 0,
      message,
    ]);
  }

  setFinished() {
    this.finishedAt = new Date().toISOString();
    this.rows = this.rows.map((r) => ((r[2] = this.finishedAt), r));
  }

  async flush() {
    if (!APPS_SCRIPT_URL || this.rows.length === 0) return;
    await axios.post(
      APPS_SCRIPT_URL,
      { rows: this.rows },
      { timeout: 20000, headers: { "Content-Type": "application/json" } }
    );
    this.rows = [];
  }
}

/* ====== HTTP ====== */
function buildAxiosCfg(countryKey) {
  const cfg = {
    timeout: 30000,
    headers: {
      "User-Agent": USER_AGENTS[countryKey],
      Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
  };
  if (PROXIES[countryKey]) {
    cfg.httpsAgent = new HttpsProxyAgent(PROXIES[countryKey]);
  }
  return cfg;
}

/* ====== SITEMAP (SAMA, TIDAK DIUBAH) ====== */
async function fetchIndexSitemaps(domain, countryKey) {
  const candidates = [`${domain}/sitemap.xml`, `${domain}/sitemap_index.xml`];

  try {
    const robots = (
      await axios.get(`${domain}/robots.txt`, buildAxiosCfg(countryKey))
    ).data;
    robots
      .split(/\r?\n/)
      .filter((l) => /^sitemap:/i.test(l))
      .forEach((l) => {
        const loc = l.split(/:\s*/i)[1];
        if (loc) candidates.unshift(loc.trim());
      });
  } catch {}

  for (const url of [...new Set(candidates)]) {
    try {
      const xml = (await axios.get(url, buildAxiosCfg(countryKey))).data;
      const parsed = await parseStringPromise(xml, {
        explicitArray: false,
        ignoreAttrs: true,
      });

      if (parsed?.sitemapindex?.sitemap) {
        const list = Array.isArray(parsed.sitemapindex.sitemap)
          ? parsed.sitemapindex.sitemap
          : [parsed.sitemapindex.sitemap];
        return list.map((e) => e.loc);
      }

      if (parsed?.urlset?.url) return [url];
    } catch {}
  }
  return [];
}

async function fetchUrlsFromSitemap(sitemapUrl, countryKey) {
  try {
    const xml = (await axios.get(sitemapUrl, buildAxiosCfg(countryKey))).data;
    const parsed = await parseStringPromise(xml, {
      explicitArray: false,
      ignoreAttrs: true,
    });
    const list = parsed?.urlset?.url;
    if (!list) return [];
    return (Array.isArray(list) ? list : [list]).map((u) => u.loc);
  } catch {
    return [];
  }
}

/* ====== CLOUDFLARE ====== */
async function purgeCloudflareCache(url) {
  if (!CLOUDFLARE_ZONE_ID || !CLOUDFLARE_API_TOKEN) return;
  await axios.post(
    `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache`,
    { files: [url] },
    {
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

/* ====== WARMING (APA ADANYA) ====== */
async function warmUrls(urls, countryKey, logger) {
  for (const url of urls) {
    const t0 = Date.now();
    try {
      const res = await axios.get(url, buildAxiosCfg(countryKey));
      const dt = Date.now() - t0;

      const cfCache = res.headers["cf-cache-status"] || "N/A";
      const lsCache = res.headers["x-litespeed-cache"] || "N/A";
      const cfRay = res.headers["cf-ray"] || "N/A";
      const edge = extractCfEdge(cfRay);

      console.log(
        `[${edge}] ${res.status} cf=${cfCache} ls=${lsCache} - ${url}`
      );

      logger.log({
        country: edge,
        url,
        status: res.status,
        cfCache,
        lsCache,
        cfRay,
        responseMs: dt,
      });

      if (String(lsCache).toLowerCase() !== "hit") {
        await purgeCloudflareCache(url);
      }
    } catch (e) {
      logger.log({
        country: "ERROR",
        url,
        error: 1,
        message: e?.message || "request failed",
      });
    }

    await sleep(2000);
  }
}

/* ====== MAIN ====== */
(async () => {
  const logger = new AppsScriptLogger();

  try {
    for (const [countryKey, domain] of Object.entries(DOMAINS_MAP)) {
      const sitemaps = await fetchIndexSitemaps(domain, countryKey);
      const urls = (
        await Promise.all(
          sitemaps.map((s) => fetchUrlsFromSitemap(s, countryKey))
        )
      ).flat();

      console.log(`[${countryKey}] Found ${urls.length} URLs`);
      await warmUrls(urls, countryKey, logger);
    }
  } finally {
    logger.setFinished();
    await logger.flush();
  }
})();
