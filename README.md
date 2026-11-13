# Bodega

Herd immunity for AI store agents. A con that works once at one AI-run store is blocked at every store within seconds, after the fix is proven on held-out cases with the same model, while honest customers still get served.

Built at Agents in Context Toronto (MongoDB) on Nov 14, 2026, by Mahyar Jaberi and Kasra Bashizadeh.

## Built before the event

The `pre-event` tag marks the last commit made before the event. Up to that tag, this repository holds only:

- `data/`: the store data (catalog, discount codes and members) and the test cases (40 dev and 120 held-out), written before any Bodega code;
- a generic app skeleton with no Bodega logic: the dependencies and config, an Express server with a health check and an Atlas client, and empty React pages;
- `BACKLOG.md`, our task plan, and `.env.example`, the names of the settings.

Everything after the tag is built on Nov 14, 2026, from 10:45: [see the changes](https://github.com/mahyar-jbr/Bodega/compare/pre-event...main).

## Run it

You need Node 24 or newer and a MongoDB Atlas connection string.

```bash
npm install
cp .env.example .env   # fill it in; single-quote values that contain & or $
npm run dev            # the server on :3000, and the web app on :5173, which forwards /api to it
```

| Command | What it does |
|---|---|
| `npm run dev` | Runs the server (restarting on changes) and the Vite dev server |
| `npm run build` | Builds the web app into `dist/` |
| `npm start` | Serves the API and the built web app on `PORT` (default 3000) |
| `npm test` | Runs the tests (Vitest) |
| `npm run check` | Type-checks the code (tsc) |

The server loads `.env` by itself when the file exists. `GET /api/health` answers 200 when Atlas answers a ping, and 503 with the reason otherwise, including when `MONGODB_URI` is empty. The `seed`, `eval`, `compare` and `try` scripts arrive on Nov 14.
