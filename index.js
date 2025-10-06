import express from 'express';
import fetch from 'node-fetch';

const app = express();
app.use(express.json({ limit: '1mb' }));

// Map bekende Jupiter paden naar de juiste upstream
const map = {
  '/v6/quote': 'https://quote-api.jup.ag',
  '/v6/swap': 'https://quote-api.jup.ag',
  '/v4/price': 'https://price.jup.ag'
};

app.all('*', async (req, res) => {
  try {
    const u = new URL(req.originalUrl, 'http://x');
    const base = Object.keys(map).find(p => u.pathname.startsWith(p));
    if (!base) return res.status(404).send('Unknown path');

    const upstream = map[base] + u.pathname + (u.search || '');
    const resp = await fetch(upstream, {
      method: req.method,
      headers: {
        'user-agent': 'Mozilla/5.0',
        'accept': 'application/json'
      },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body)
    });

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


