import express from 'express';
import fetch from 'node-fetch';
import https from 'https';
import { Agent as UndiciAgent } from 'undici';

const app = express();
app.use(express.json({ limit: '1mb' }));

// Jupiter Pro API Key (uit environment variable)
const JUPITER_API_KEY = process.env.JUPITER_API_KEY;

// Map bekende Jupiter paden naar de juiste upstream
const map = {
  '/v6/quote': 'https://quote-api.jup.ag',
  '/v6/swap': 'https://quote-api.jup.ag',
  '/v4/price': 'https://price.jup.ag'
};

async function resolveA(host) {
  // Probeer meerdere DoH-providers
  const endpoints = [
    `https://cloudflare-dns.com/dns-query?name=${host}&type=A`,
    `https://dns.google/resolve?name=${host}&type=A`,
    `https://dns.quad9.net/dns-query?name=${host}&type=A`,
    `https://doh.opendns.com/dns-query?name=${host}&type=A`
  ];
  for (const ep of endpoints) {
    try {
      const r = await fetch(ep, { headers: { 'accept': 'application/dns-json' }, timeout: 5000 });
      if (!r.ok) continue;
      const j = await r.json();
      const ans = j.Answer || j.answers || [];
      const a = ans.find((x) => (x.type === 1 || x.type === 'A') && x.data);
      if (a && a.data) return a.data;
    } catch (_) {
      // doorgaan naar volgende endpoint
    }
  }
  return null;
}

app.all('*', async (req, res) => {
  try {
    const u = new URL(req.originalUrl, 'http://x');
    const base = Object.keys(map).find(p => u.pathname.startsWith(p));
    if (!base) return res.status(404).send('Unknown path');

    const upstreamBase = map[base];
    const upstream = upstreamBase + u.pathname + (u.search || '');
    const upstreamHost = new URL(upstreamBase).host;

    // Los DNS op via DoH en fetch via IP met Host-header; TLS validatie uitschakelen voor IP
    let useUrl = upstream;
    let fetchOpts = {
      method: req.method,
      headers: {
        'user-agent': 'Mozilla/5.0',
        'accept': 'application/json',
        // Jupiter Pro API Key header
        ...(JUPITER_API_KEY && { 'Authorization': `Bearer ${JUPITER_API_KEY}` })
      },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body)
    };

    // Kandidaten: DoH-resultaat + bekende Cloudflare edge IP's
    const candidates = [];
    try {
      const ip = await resolveA(upstreamHost);
      if (ip) candidates.push(ip);
    } catch (_) {}
    // Bekende CF IP's voor jup.ag
    candidates.push('104.18.10.194', '104.18.11.194');

    let resp;
    let lastErr;
    for (const ip of candidates) {
      try {
        const ipUrl = new URL(upstream);
        ipUrl.hostname = ip;
        const agent = new https.Agent({ rejectUnauthorized: false, servername: upstreamHost });
        const dispatcher = new UndiciAgent({ connect: { rejectUnauthorized: false, servername: upstreamHost } });
        const opts = { 
          ...fetchOpts, 
          agent, 
          dispatcher, 
          headers: { ...fetchOpts.headers, Host: upstreamHost, host: upstreamHost } 
        };
        resp = await fetch(ipUrl.toString(), opts);
        if (resp && resp.status) break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!resp) {
      // Laatste poging: directe URL (indien DNS toch werkt)
      try {
        resp = await fetch(upstream, fetchOpts);
      } catch (e) {
        return res.status(502).send(String(lastErr || e));
      }
    }

    const text = await resp.text();
    res
      .status(resp.status)
      .type(resp.headers.get('content-type') || 'application/json')
      .send(text);
  } catch (e) {
    res.status(502).send(String(e));
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('proxy on ' + port));


