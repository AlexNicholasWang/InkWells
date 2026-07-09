# InkWells

Logo blending, template extraction, and IP screening for custom apparel.

## Deploy to Vercel

1. Push this folder to a GitHub repo (or run `vercel` in this directory).
2. In Vercel: New Project -> import the repo. Framework preset: **Vite** (auto-detected).
3. In Project Settings -> Environment Variables, add:
   - `ANTHROPIC_API_KEY` = your key from https://console.anthropic.com/settings/keys
4. Deploy. Template Extractor and IP Screen call `/api/claude`, a serverless
   function that keeps your key server-side. Logo Blender is fully client-side.

## Local dev

```
npm install
npm run dev
```

Note: `/api/claude` only runs on Vercel (or `vercel dev`). Plain `npm run dev`
will serve the UI but the two AI tabs will fail locally unless you use `vercel dev`.
