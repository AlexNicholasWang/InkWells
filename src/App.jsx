import React, { useState, useRef, useEffect, useCallback } from "react";

// ---------- design tokens ----------
const T = {
  paper: "#F7F6F2",
  ink: "#16202E",
  inkSoft: "#4A5568",
  line: "#DDD9CE",
  magenta: "#C4256B",
  cyan: "#0E8CA8",
  yellowChip: "#E8B931",
  card: "#FFFFFF",
  ok: "#2F855A",
  warn: "#B7791F",
  bad: "#C53030",
};

const mono = "'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace";
const sans = "'Archivo', system-ui, sans-serif";

// ---------- helpers ----------
function fileToImage(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => res({ img, dataUrl: reader.result });
      img.onerror = () => rej(new Error("Image decode failed"));
      img.src = reader.result;
    };
    reader.onerror = () => rej(new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

// downscale an image to max dim and return base64 (no prefix) + media type
function imageToBase64(img, maxDim = 1024) {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL("image/png");
  return dataUrl.split(",")[1];
}

async function askClaude(prompt, images) {
  const content = [];
  const arr = Array.isArray(images) ? images : images ? [images] : [];
  for (const b64 of arr) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: b64 },
    });
  }
  content.push({ type: "text", text: prompt });
  const response = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content }],
    }),
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    const msg = data?.error?.message || data?.error || `API error (HTTP ${response.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const clean = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    throw new Error("AI returned an unparseable response — try again");
  }
}

// ---------- shared UI ----------
function Drop({ label, onFile }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState(null);
  const handle = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setErr("That file isn't an image."); return; }
    setErr(null);
    try {
      const { img, dataUrl } = await fileToImage(file);
      setPreview(dataUrl);
      onFile(img, dataUrl, file);
    } catch (e) {
      setErr("Couldn't read that file — try a PNG or JPG.");
    }
  };
  return (
    <div
      onClick={() => inputRef.current && inputRef.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files[0]); }}
      className="cursor-pointer rounded-lg p-4 flex flex-col items-center justify-center text-center transition-colors"
      style={{
        border: `2px dashed ${drag ? T.magenta : T.line}`,
        background: drag ? "#FBF0F5" : T.card,
        minHeight: 140,
      }}
    >
      {preview ? (
        <>
          <img src={preview} alt={label} className="max-h-24 object-contain rounded" />
          <div className="text-xs mt-2" style={{ fontFamily: mono, color: T.ok }}>✓ {label} — click to replace</div>
        </>
      ) : (
        <>
          <div style={{ fontFamily: mono, fontSize: 22, color: T.magenta }}>⊕</div>
          <div className="mt-1 text-sm font-medium" style={{ color: T.ink }}>{label}</div>
          <div className="text-xs mt-1" style={{ color: T.inkSoft }}>click or drop an image</div>
          {err && <div className="text-xs mt-1" style={{ color: T.bad }}>{err}</div>}
        </>
      )}
      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => { handle(e.target.files[0]); e.target.value = ""; }} />
    </div>
  );
}

function Slider({ label, value, onChange, min = 0, max = 100 }) {
  return (
    <label className="block">
      <div className="flex justify-between text-xs mb-1" style={{ fontFamily: mono, color: T.inkSoft }}>
        <span>{label}</span><span>{value}</span>
      </div>
      <input type="range" min={min} max={max} value={value} className="w-full"
        style={{ accentColor: T.magenta }}
        onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Chip({ hex, name }) {
  return (
    <div className="flex flex-col rounded overflow-hidden" style={{ border: `1px solid ${T.line}`, width: 84 }}>
      <div style={{ background: hex, height: 44 }} />
      <div className="px-1.5 py-1" style={{ fontFamily: mono, fontSize: 10, color: T.ink, background: "#fff" }}>
        <div className="truncate">{name}</div>
        <div style={{ color: T.inkSoft }}>{hex}</div>
      </div>
    </div>
  );
}

function Spinner({ text }) {
  return (
    <div className="flex items-center gap-2 py-3" style={{ color: T.inkSoft, fontFamily: mono, fontSize: 13 }}>
      <div className="animate-spin" style={{ width: 14, height: 14, border: `2px solid ${T.line}`, borderTopColor: T.magenta, borderRadius: "50%" }} />
      {text}
    </div>
  );
}

// ---------- Module 1: Logo Blender ----------
// Pure compositor: renders shirt + logo with the given config into a canvas.
// Used by both the live preview and the AI agent's trial renders.
function compositeMockup(shirt, logo, pos, scale, cfg) {
  const CW = 640;
  const CH = Math.round(CW * (shirt.height / shirt.width));
  const canvas = document.createElement("canvas");
  canvas.width = CW; canvas.height = CH;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(shirt, 0, 0, CW, CH);

  const lw = Math.max(2, Math.round((scale / 100) * CW));
  const lh = Math.max(2, Math.round(lw * (logo.height / logo.width)));
  const pp = cfg.panel.on ? Math.round(lw * 0.1) : 0;
  const ow = lw + pp * 2, oh = lh + pp * 2;
  const ox = pos.x * CW - ow / 2;
  const oy = pos.y * CH - oh / 2;

  const sx = Math.max(0, Math.round(ox)), sy = Math.max(0, Math.round(oy));
  const sw = Math.min(CW - sx, ow) || 1;
  const sh = Math.min(CH - sy, oh) || 1;
  const data = ctx.getImageData(sx, sy, sw, sh).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 16) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
  r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const fabric = {
    hex: "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join(""),
    lum: Math.round(lum),
  };

  // key the logo's background with de-fringing
  const logoC = document.createElement("canvas");
  logoC.width = lw; logoC.height = lh;
  const lctx = logoC.getContext("2d");
  lctx.drawImage(logo, 0, 0, lw, lh);
  if (cfg.bgKey > 0) {
    const id = lctx.getImageData(0, 0, lw, lh);
    const px = id.data;
    let br = 0, bg2 = 0, bb = 0, bn = 0;
    const patch = Math.max(1, Math.floor(Math.min(lw, lh) * 0.04));
    const corners = [[0, 0], [lw - patch, 0], [0, lh - patch], [lw - patch, lh - patch]];
    for (const [cx0, cy0] of corners) {
      for (let y = cy0; y < cy0 + patch; y++) {
        for (let x = cx0; x < cx0 + patch; x++) {
          const i = (y * lw + x) * 4;
          if (px[i + 3] < 10) continue;
          br += px[i]; bg2 += px[i + 1]; bb += px[i + 2]; bn++;
        }
      }
    }
    if (bn > 0) {
      br /= bn; bg2 /= bn; bb /= bn;
      const tol = cfg.bgKey * 1.8;
      const soft = tol * 1.7;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] === 0) continue;
        const d = Math.sqrt((px[i] - br) ** 2 + (px[i + 1] - bg2) ** 2 + (px[i + 2] - bb) ** 2);
        if (d < tol) { px[i + 3] = 0; continue; }
        if (d < soft) {
          const f = (d - tol) / (soft - tol);
          px[i + 3] = Math.round(px[i + 3] * f);
          px[i]     = Math.min(255, Math.max(0, (px[i]     - br  * (1 - f)) / f));
          px[i + 1] = Math.min(255, Math.max(0, (px[i + 1] - bg2 * (1 - f)) / f));
          px[i + 2] = Math.min(255, Math.max(0, (px[i + 2] - bb  * (1 - f)) / f));
        }
      }
      lctx.putImageData(id, 0, 0);
    }
  }

  // recolor invisible ink: shift pixels near cfg.recolor.from toward
  // cfg.recolor.to, preserving luminance so anti-aliasing stays smooth
  if (cfg.recolor && cfg.recolor.on) {
    const rid = lctx.getImageData(0, 0, lw, lh);
    const p2 = rid.data;
    const [fr, fg, fb] = hexToRgb(cfg.recolor.from || "#ffffff");
    const [tr, tg, tb] = hexToRgb(cfg.recolor.to || "#333333");
    const fromLum = Math.max(30, 0.299 * fr + 0.587 * fg + 0.114 * fb);
    for (let i = 0; i < p2.length; i += 4) {
      if (p2[i + 3] < 8) continue;
      const d = Math.sqrt((p2[i] - fr) ** 2 + (p2[i + 1] - fg) ** 2 + (p2[i + 2] - fb) ** 2);
      const f = d < 60 ? 1 : d < 110 ? 1 - (d - 60) / 50 : 0;
      if (f <= 0) continue;
      const l = 0.299 * p2[i] + 0.587 * p2[i + 1] + 0.114 * p2[i + 2];
      const ratio = Math.min(1.25, l / fromLum);
      p2[i]     = p2[i]     * (1 - f) + Math.min(255, tr * ratio) * f;
      p2[i + 1] = p2[i + 1] * (1 - f) + Math.min(255, tg * ratio) * f;
      p2[i + 2] = p2[i + 2] * (1 - f) + Math.min(255, tb * ratio) * f;
    }
    lctx.putImageData(rid, 0, 0);
  }

  // compose backing panel + logo
  const off = document.createElement("canvas");
  off.width = ow; off.height = oh;
  const octx = off.getContext("2d");
  if (cfg.panel.on) {
    octx.fillStyle = cfg.panel.hex;
    if (typeof octx.roundRect === "function") {
      octx.beginPath();
      octx.roundRect(0, 0, ow, oh, Math.max(2, Math.round(pp * 0.7)));
      octx.fill();
    } else {
      octx.fillRect(0, 0, ow, oh);
    }
  }
  octx.drawImage(logoC, pp, pp);
  if (cfg.adapt > 0) {
    octx.globalCompositeOperation = "source-atop";
    octx.fillStyle = `rgba(${r},${g},${b},${cfg.adapt / 100})`;
    octx.fillRect(0, 0, ow, oh);
    octx.globalCompositeOperation = "source-over";
  }

  let blend = cfg.mode;
  if (cfg.mode === "auto") blend = lum > 128 ? "multiply" : "screen";

  if (cfg.mode === "print") {
    const lums = [];
    for (let i = 0; i < data.length; i += 16) {
      lums.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
    lums.sort((a, b) => a - b);
    const base = Math.max(40, lums[Math.floor(lums.length * 0.9)] || 255);

    const shadeC = document.createElement("canvas");
    shadeC.width = sw; shadeC.height = sh;
    const sctx = shadeC.getContext("2d");
    const sid = sctx.createImageData(sw, sh);
    for (let i = 0; i < data.length; i += 4) {
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const v = Math.round(255 * Math.min(1, Math.max(0.35, l / base)));
      sid.data[i] = v; sid.data[i + 1] = v; sid.data[i + 2] = v; sid.data[i + 3] = 255;
    }
    sctx.putImageData(sid, 0, 0);

    const mask = document.createElement("canvas");
    mask.width = ow; mask.height = oh;
    mask.getContext("2d").drawImage(off, 0, 0);
    octx.globalCompositeOperation = "multiply";
    octx.drawImage(shadeC, 0, 0, ow, oh);
    octx.globalCompositeOperation = "destination-in";
    octx.drawImage(mask, 0, 0);
    octx.globalCompositeOperation = "source-over";
    blend = "source-over";
  }

  ctx.save();
  ctx.globalAlpha = cfg.fade / 100;
  ctx.globalCompositeOperation = blend;
  ctx.drawImage(off, ox, oy, ow, oh);
  ctx.restore();

  return { canvas, fabric, box: { ox, oy, ow, oh, CW, CH } };
}

// crop the placement region (plus margin) out of a mockup for AI review
function cropForReview(canvas, box) {
  const mx = box.ow * 0.18, my = box.oh * 0.18;
  const x = Math.max(0, box.ox - mx), y = Math.max(0, box.oy - my);
  const w = Math.min(box.CW - x, box.ow + mx * 2);
  const h = Math.min(box.CH - y, box.oh + my * 2);
  const c = document.createElement("canvas");
  const s = Math.min(1, 700 / Math.max(w, h));
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext("2d").drawImage(canvas, x, y, w, h, 0, 0, c.width, c.height);
  return c.toDataURL("image/png").split(",")[1];
}

function LogoBlender() {
  const [shirt, setShirt] = useState(null);
  const [logo, setLogo] = useState(null);
  const [pos, setPos] = useState({ x: 0.5, y: 0.4 });
  const [scale, setScale] = useState(30);
  const [fade, setFade] = useState(95);
  const [adapt, setAdapt] = useState(0);
  const [mode, setMode] = useState("print");
  const [bgKey, setBgKey] = useState(25);
  const [panel, setPanel] = useState({ on: false, hex: "#d6246e" });
  const [recolor, setRecolor] = useState({ on: false, from: "#ffffff", to: "#c4256b" });
  const [fabric, setFabric] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState(null);
  const canvasRef = useRef(null);
  const dragging = useRef(false);

  const cfg = { fade, adapt, mode, bgKey, panel, recolor };

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !shirt) return;
    if (!logo) {
      const CH = Math.round(640 * (shirt.height / shirt.width));
      canvas.width = 640; canvas.height = CH;
      canvas.getContext("2d").drawImage(shirt, 0, 0, 640, CH);
      return;
    }
    const out = compositeMockup(shirt, logo, pos, scale, cfg);
    canvas.width = out.canvas.width; canvas.height = out.canvas.height;
    canvas.getContext("2d").drawImage(out.canvas, 0, 0);
    setFabric(out.fabric);
  }, [shirt, logo, pos, scale, fade, adapt, mode, bgKey, panel, recolor]);

  useEffect(() => { render(); }, [render]);

  // Agentic auto-fit: propose settings, render, have the AI inspect the
  // actual result, and correct until every element is visible (max 2 rounds).
  const autoFit = async () => {
    if (!shirt || !logo) return;
    setAiBusy(true); setAiNote("Analyzing design…");
    try {
      const logoB64 = imageToBase64(logo, 512);
      const probe = compositeMockup(shirt, logo, pos, scale, { ...cfg, bgKey: 0, panel: { on: false, hex: panel.hex }, recolor: { on: false } });
      const fab = probe.fabric;

      // step 1: propose
      const prop = await askClaude(
        `You configure a t-shirt mockup compositor. The attached image is a customer's design file. It will print on fabric colored ${fab.hex} (luminance ${fab.lum}/255).

Every element of the design must remain visible on that fabric, and the result should look like it belongs on this shirt.

Your tools, in order of preference:
1. bgRemoval: strip an incidental backdrop (0 = keep the design's own background).
2. recolor: if some ink would be invisible against this fabric (e.g. white text on a white shirt), recolor exactly that ink: "from" = the invisible color, "to" = a replacement that clearly contrasts the fabric AND harmonizes with the design's own palette (prefer a color already present in the design, like an outline or accent color).
3. addPanel: only as a last resort for complex multi-tone designs that recoloring would ruin.

Respond ONLY with valid JSON, no markdown:
{"bgRemoval": 0-60, "recolor": {"on": true|false, "from": "#RRGGBB", "to": "#RRGGBB"}, "addPanel": true|false, "panelHex": "#RRGGBB or null", "note": "one short sentence"}`,
        logoB64
      );
      let trial = {
        fade: 95, adapt: 0, mode: "print",
        bgKey: Math.max(0, Math.min(60, Number(prop.bgRemoval) || 0)),
        panel: { on: !!prop.addPanel, hex: prop.panelHex || "#d6246e" },
        recolor: {
          on: !!prop.recolor?.on,
          from: prop.recolor?.from || "#ffffff",
          to: prop.recolor?.to || "#c4256b",
        },
      };
      let note = prop.note || "";

      // step 2: render, inspect, correct (up to 2 rounds)
      for (let round = 0; round < 2; round++) {
        setAiNote(`Checking result (pass ${round + 1})…`);
        const out = compositeMockup(shirt, logo, pos, scale, trial);
        const cropB64 = cropForReview(out.canvas, out.box);
        const check = await askClaude(
          `Image 1 is a customer's original design file. Image 2 is a crop of a t-shirt mockup where that design was printed onto fabric.

Judge ONLY visibility and crispness: is EVERY element of the original design (all text, outlines, artwork) clearly visible and readable in the mockup, with no invisible, ghosted, or fringed parts?

Respond ONLY with valid JSON, no markdown:
{"ok": true|false, "problem": "short description or null", "fix": {"bgRemoval": 0-60, "recolor": {"on": true|false, "from": "#RRGGBB", "to": "#RRGGBB"}, "addPanel": true|false, "panelHex": "#RRGGBB or null"}, "note": "one short sentence"}

If any element is invisible or barely readable (e.g. white text on white fabric), ok must be false. Prefer fix.recolor: set "from" to the invisible ink's color and "to" to a color that clearly contrasts the fabric and harmonizes with the design's palette. Use fix.addPanel only if recoloring would ruin the design.`,
          [logoB64, cropB64]
        );
        note = check.note || note;
        if (check.ok) break;
        trial = {
          ...trial,
          bgKey: Math.max(0, Math.min(60, Number(check.fix?.bgRemoval) ?? trial.bgKey)),
          panel: {
            on: !!check.fix?.addPanel,
            hex: check.fix?.panelHex || trial.panel.hex,
          },
          recolor: {
            on: !!check.fix?.recolor?.on,
            from: check.fix?.recolor?.from || trial.recolor.from,
            to: check.fix?.recolor?.to || trial.recolor.to,
          },
        };
      }

      setBgKey(trial.bgKey);
      setPanel(trial.panel);
      setRecolor(trial.recolor);
      setMode("print"); setAdapt(0); setFade(95);
      setAiNote(note || "Settings applied.");
    } catch (e) {
      setAiNote(`Auto-fit failed: ${e.message}`);
    }
    setAiBusy(false);
  };

  const toFrac = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = (e.clientX ?? e.touches?.[0]?.clientX) - rect.left;
    const cy = (e.clientY ?? e.touches?.[0]?.clientY) - rect.top;
    return { x: Math.min(1, Math.max(0, cx / rect.width)), y: Math.min(1, Math.max(0, cy / rect.height)) };
  };

  const download = () => {
    const a = document.createElement("a");
    a.download = "mockup.png";
    a.href = canvasRef.current.toDataURL("image/png");
    a.click();
  };

  return (
    <div className="grid gap-5 md:grid-cols-3">
      <div className="space-y-4">
        <Drop label="Shirt photo" onFile={(img) => setShirt(img)} />
        <Drop label="Customer logo" onFile={(img) => setLogo(img)} />
        <button onClick={autoFit} disabled={!shirt || !logo || aiBusy}
          className="w-full py-2 rounded font-medium text-sm"
          style={{ background: shirt && logo && !aiBusy ? T.cyan : T.line, color: "#fff" }}>
          {aiBusy ? "Working…" : "✦ AI auto-fit (checks its own result)"}
        </button>
        {aiNote && (
          <div className="text-xs rounded p-2" style={{ fontFamily: mono, color: T.inkSoft, background: T.card, border: `1px solid ${T.line}` }}>
            {aiNote}
          </div>
        )}
        <div className="rounded-lg p-4 space-y-4" style={{ background: T.card, border: `1px solid ${T.line}` }}>
          <Slider label="LOGO SIZE %" value={scale} onChange={setScale} min={5} max={80} />
          <Slider label="BG REMOVAL (0 = off)" value={bgKey} onChange={setBgKey} min={0} max={60} />
          <Slider label="FADE / OPACITY" value={fade} onChange={setFade} min={10} max={100} />
          <Slider label="VINTAGE TINT (0 = vivid print)" value={adapt} onChange={setAdapt} />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ fontFamily: mono, color: T.inkSoft }}>
              <input type="checkbox" checked={panel.on} style={{ accentColor: T.magenta }}
                onChange={(e) => setPanel({ ...panel, on: e.target.checked })} />
              BACKING PANEL
            </label>
            <input type="color" value={panel.hex} disabled={!panel.on}
              onChange={(e) => setPanel({ ...panel, hex: e.target.value })}
              style={{ width: 34, height: 24, border: `1px solid ${T.line}`, borderRadius: 4, background: "transparent", opacity: panel.on ? 1 : 0.4 }} />
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ fontFamily: mono, color: T.inkSoft }}>
              <input type="checkbox" checked={recolor.on} style={{ accentColor: T.magenta }}
                onChange={(e) => setRecolor({ ...recolor, on: e.target.checked })} />
              INK RECOLOR
            </label>
            <div className="flex items-center gap-1">
              <input type="color" value={recolor.from} disabled={!recolor.on}
                onChange={(e) => setRecolor({ ...recolor, from: e.target.value })}
                style={{ width: 28, height: 24, border: `1px solid ${T.line}`, borderRadius: 4, background: "transparent", opacity: recolor.on ? 1 : 0.4 }} />
              <span className="text-xs" style={{ fontFamily: mono, color: T.inkSoft }}>→</span>
              <input type="color" value={recolor.to} disabled={!recolor.on}
                onChange={(e) => setRecolor({ ...recolor, to: e.target.value })}
                style={{ width: 28, height: 24, border: `1px solid ${T.line}`, borderRadius: 4, background: "transparent", opacity: recolor.on ? 1 : 0.4 }} />
            </div>
          </div>
          <div>
            <div className="text-xs mb-1" style={{ fontFamily: mono, color: T.inkSoft }}>BLEND MODE</div>
            <div className="flex flex-wrap gap-1.5">
              {["print", "auto", "multiply", "screen", "overlay", "source-over"].map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  className="px-2 py-1 rounded text-xs"
                  style={{
                    fontFamily: mono,
                    background: mode === m ? T.ink : "transparent",
                    color: mode === m ? "#fff" : T.inkSoft,
                    border: `1px solid ${mode === m ? T.ink : T.line}`,
                  }}>
                  {m === "source-over" ? "normal" : m}
                </button>
              ))}
            </div>
          </div>
          {fabric && (
            <div className="flex items-center gap-2 text-xs" style={{ fontFamily: mono, color: T.inkSoft }}>
              <span style={{ display: "inline-block", width: 14, height: 14, background: fabric.hex, border: `1px solid ${T.line}`, borderRadius: 3 }} />
              fabric {fabric.hex} · lum {fabric.lum}
            </div>
          )}
          <button onClick={download} disabled={!shirt || !logo}
            className="w-full py-2 rounded font-medium text-sm"
            style={{ background: shirt && logo ? T.magenta : T.line, color: "#fff" }}>
            Download mockup PNG
          </button>
        </div>
      </div>
      <div className="md:col-span-2">
        <div className="rounded-lg p-3" style={{ background: T.card, border: `1px solid ${T.line}` }}>
          {shirt ? (
            <canvas
              ref={canvasRef}
              className="w-full rounded cursor-move touch-none"
              onMouseDown={(e) => { dragging.current = true; setPos(toFrac(e)); }}
              onMouseMove={(e) => { if (dragging.current) setPos(toFrac(e)); }}
              onMouseUp={() => (dragging.current = false)}
              onMouseLeave={() => (dragging.current = false)}
              onTouchStart={(e) => { dragging.current = true; setPos(toFrac(e)); }}
              onTouchMove={(e) => { if (dragging.current) setPos(toFrac(e)); }}
              onTouchEnd={() => (dragging.current = false)}
            />
          ) : (
            <div className="flex items-center justify-center text-sm" style={{ height: 380, color: T.inkSoft, fontFamily: mono }}>
              Upload a shirt photo to start — drag on the canvas to place the logo
            </div>
          )}
        </div>
        <p className="text-xs mt-2" style={{ color: T.inkSoft }}>
          Auto-fit verifies its own work: it composites the mockup, inspects the result against the original design, and corrects — preferring to recolor invisible ink into a shade that matches the shirt and the design's own palette, with a backing panel only as a last resort.
        </p>
      </div>
    </div>
  );
}

// ---------- Module 2: Template Extractor ----------
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function TemplateExtractor() {
  const [img, setImg] = useState(null);
  const [dataUrl, setDataUrl] = useState(null);
  const [spec, setSpec] = useState(null);
  const [variants, setVariants] = useState([]);
  const [showZones, setShowZones] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fill each strip zone with fabric sampled from a ring just outside it,
  // blurred so the patch melts into the garment.
  const buildBlank = (image, zones) => {
    const W = Math.min(900, image.width);
    const H = Math.round(W * (image.height / image.width));
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    ctx.drawImage(image, 0, 0, W, H);

    for (const z of zones.filter((z) => z.strip)) {
      const pad = Math.round(W * 0.012) + 2;
      const zx = Math.max(0, Math.round((z.x / 100) * W) - pad);
      const zy = Math.max(0, Math.round((z.y / 100) * H) - pad);
      const zw = Math.min(W - zx, Math.round((z.w / 100) * W) + pad * 2);
      const zh = Math.min(H - zy, Math.round((z.h / 100) * H) + pad * 2);
      if (zw < 4 || zh < 4) continue;

      // sample thin bands above and below the zone for a vertical gradient
      const band = Math.max(2, Math.round(H * 0.008));
      const avg = (bx, by, bw, bh) => {
        const x = Math.max(0, bx), y = Math.max(0, by);
        const w = Math.min(W - x, bw) || 1, h = Math.min(H - y, bh) || 1;
        const d = ctx.getImageData(x, y, w, h).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 8) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        return [r / n, g / n, b / n];
      };
      const top = avg(zx, zy - band - 1, zw, band);
      const bot = avg(zx, zy + zh + 1, zw, band);

      const patch = document.createElement("canvas");
      patch.width = zw; patch.height = zh;
      const pctx = patch.getContext("2d");
      const grad = pctx.createLinearGradient(0, 0, 0, zh);
      grad.addColorStop(0, `rgb(${top.map(Math.round).join(",")})`);
      grad.addColorStop(1, `rgb(${bot.map(Math.round).join(",")})`);
      pctx.fillStyle = grad;
      pctx.fillRect(0, 0, zw, zh);
      // faint noise so the patch doesn't look plastic-flat
      const nid = pctx.getImageData(0, 0, zw, zh);
      for (let i = 0; i < nid.data.length; i += 4) {
        const nz = (Math.random() - 0.5) * 6;
        nid.data[i] += nz; nid.data[i + 1] += nz; nid.data[i + 2] += nz;
      }
      pctx.putImageData(nid, 0, 0);

      ctx.save();
      ctx.filter = "blur(2px)";
      ctx.drawImage(patch, zx, zy, zw, zh);
      ctx.restore();
    }
    return c;
  };

  // Luminance-preserving recolor of pixels near the garment's body color.
  const recolor = (blank, bodyHex, targetHex) => {
    const c = document.createElement("canvas");
    c.width = blank.width; c.height = blank.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(blank, 0, 0);
    const id = ctx.getImageData(0, 0, c.width, c.height);
    const px = id.data;
    const [br, bg2, bb] = hexToRgb(bodyHex);
    const [tr, tg, tb] = hexToRgb(targetHex);
    const bodyLum = Math.max(30, 0.299 * br + 0.587 * bg2 + 0.114 * bb);
    for (let i = 0; i < px.length; i += 4) {
      const d = Math.sqrt((px[i] - br) ** 2 + (px[i + 1] - bg2) ** 2 + (px[i + 2] - bb) ** 2);
      let f = d < 70 ? 1 : d < 130 ? 1 - (d - 70) / 60 : 0;
      if (f <= 0) continue;
      const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      const ratio = Math.min(1.35, lum / bodyLum);
      px[i]     = px[i]     * (1 - f) + Math.min(255, tr * ratio) * f;
      px[i + 1] = px[i + 1] * (1 - f) + Math.min(255, tg * ratio) * f;
      px[i + 2] = px[i + 2] * (1 - f) + Math.min(255, tb * ratio) * f;
    }
    ctx.putImageData(id, 0, 0);
    return c;
  };

  const analyze = async () => {
    setLoading(true); setError(null); setSpec(null); setVariants([]);
    try {
      const b64 = imageToBase64(img);
      const result = await askClaude(
        `You are analyzing a garment photo for a print shop that turns samples into reusable design templates. Separate STRUCTURE (keep) from DESIGN CONTENT (strip and replace per customer).

Respond ONLY with valid JSON, no markdown, matching exactly:
{
 "garmentType": "string",
 "baseColors": [{"name":"string","hex":"#RRGGBB","role":"body|trim|accent"}],
 "designElements": [{"element":"string","location":"string","strip":true|false,"why":"string"}],
 "templateZones": [{"zone":"string","x":0-100,"y":0-100,"w":0-100,"h":0-100,"purpose":"string","strip":true|false}],
 "colorways": [exactly 4 of {"name":"string","bodyHex":"#RRGGBB"}],
 "styleNotes": "one sentence on the visual language to preserve"
}
Rules:
- templateZones x,y = top-left corner as percent of image; make strip zones TIGHT around the removable design content only (logos, crests, sponsor text, numbers), never covering seams/collar/structure.
- Mark strip:true only for zones containing removable design content.
- colorways: 4 alternative body colors that suit this garment type (do not include the original color).`,
        b64
      );
      setSpec(result);

      // build the clean blank + colorway variants
      const blank = buildBlank(img, result.templateZones || []);
      const bodyHex = (result.baseColors || []).find((c) => c.role === "body")?.hex || "#ffffff";
      const out = [{ name: "Original (stripped)", hex: bodyHex, url: blank.toDataURL("image/png") }];
      for (const cw of (result.colorways || []).slice(0, 4)) {
        try {
          out.push({ name: cw.name, hex: cw.bodyHex, url: recolor(blank, bodyHex, cw.bodyHex).toDataURL("image/png") });
        } catch (e) { /* skip bad colorway */ }
      }
      setVariants(out);
    } catch (e) {
      setError(`Analysis failed: ${e.message}`);
    }
    setLoading(false);
  };

  const downloadVariant = (v) => {
    const a = document.createElement("a");
    a.download = `template-${v.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
    a.href = v.url;
    a.click();
  };

  const downloadSpec = () => {
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "template-spec.json";
    a.click();
  };

  return (
    <div className="grid gap-5 md:grid-cols-3">
      <div className="space-y-4">
        <Drop label="Sample garment (e.g. jersey)"
          onFile={(image, url) => { setImg(image); setDataUrl(url); setSpec(null); setVariants([]); }} />
        <button onClick={analyze} disabled={!img || loading}
          className="w-full py-2 rounded font-medium text-sm"
          style={{ background: img && !loading ? T.cyan : T.line, color: "#fff" }}>
          {loading ? "Generating…" : "Generate 5 template options"}
        </button>
        {spec && (
          <>
            <button onClick={() => setShowZones(!showZones)} className="w-full py-2 rounded text-sm"
              style={{ border: `1px solid ${T.line}`, color: T.inkSoft }}>
              {showZones ? "Hide" : "Show"} zone overlay
            </button>
            <button onClick={downloadSpec} className="w-full py-2 rounded text-sm"
              style={{ border: `1px solid ${T.ink}`, color: T.ink }}>
              Download spec JSON
            </button>
          </>
        )}
        {error && <div className="text-sm" style={{ color: T.bad }}>{error}</div>}
      </div>

      <div className="md:col-span-2 space-y-4">
        {loading && <Spinner text="Stripping design content and building colorways…" />}
        {!spec && !loading && (
          <div className="rounded-lg p-6 text-sm" style={{ background: T.card, border: `1px solid ${T.line}`, color: T.inkSoft }}>
            Upload a reference garment. The design content (crests, sponsors, numbers) gets stripped out and you get 5 ready-to-use template options — the cleaned original plus 4 alternative colorways — each downloadable as PNG.
          </div>
        )}

        {variants.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {variants.map((v, i) => (
              <button key={i} onClick={() => downloadVariant(v)}
                className="rounded-lg overflow-hidden text-left group"
                style={{ border: `1px solid ${T.line}`, background: T.card }}>
                <img src={v.url} alt={v.name} className="w-full block" />
                <div className="px-2 py-1.5 flex items-center gap-2">
                  <span style={{ width: 12, height: 12, background: v.hex, border: `1px solid ${T.line}`, borderRadius: 3, display: "inline-block" }} />
                  <span className="text-xs font-medium truncate" style={{ color: T.ink }}>{v.name}</span>
                </div>
                <div className="px-2 pb-1.5 text-xs" style={{ fontFamily: mono, color: T.inkSoft }}>click to download</div>
              </button>
            ))}
          </div>
        )}

        {spec && showZones && (
          <div className="relative rounded-lg overflow-hidden" style={{ border: `1px solid ${T.line}` }}>
            <img src={dataUrl} alt="garment" className="w-full block" />
            {spec.templateZones?.map((z, i) => (
              <div key={i} className="absolute"
                style={{
                  left: `${z.x}%`, top: `${z.y}%`, width: `${z.w}%`, height: `${z.h}%`,
                  border: `2px solid ${z.strip ? T.bad : T.cyan}`,
                  background: z.strip ? "rgba(197,48,48,0.08)" : "rgba(14,140,168,0.06)",
                }}>
                <span className="px-1" style={{ fontFamily: mono, fontSize: 10, background: z.strip ? T.bad : T.cyan, color: "#fff" }}>
                  {z.zone}{z.strip ? " · strip" : ""}
                </span>
              </div>
            ))}
          </div>
        )}

        {spec && (
          <div className="rounded-lg p-4 space-y-4" style={{ background: T.card, border: `1px solid ${T.line}` }}>
            <div>
              <div className="text-xs mb-2" style={{ fontFamily: mono, color: T.inkSoft }}>BASE COLORS — {spec.garmentType}</div>
              <div className="flex flex-wrap gap-2">
                {spec.baseColors?.map((c, i) => <Chip key={i} hex={c.hex} name={`${c.name} · ${c.role}`} />)}
              </div>
            </div>
            <div>
              <div className="text-xs mb-2" style={{ fontFamily: mono, color: T.inkSoft }}>DESIGN ELEMENTS</div>
              <div className="space-y-1.5">
                {spec.designElements?.map((d, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm" style={{ color: T.ink }}>
                    <span className="px-1.5 rounded text-xs mt-0.5" style={{
                      fontFamily: mono,
                      background: d.strip ? "#FDECEC" : "#EAF5EE",
                      color: d.strip ? T.bad : T.ok,
                    }}>{d.strip ? "STRIP" : "KEEP"}</span>
                    <span><strong>{d.element}</strong> — {d.location}. <span style={{ color: T.inkSoft }}>{d.why}</span></span>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-sm italic" style={{ color: T.inkSoft }}>{spec.styleNotes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Module 3: Copyright Checker ----------
function CopyrightChecker() {
  const [img, setImg] = useState(null);
  const [dataUrl, setDataUrl] = useState(null);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const riskColor = (lvl) => ({ low: T.ok, medium: T.warn, high: T.bad }[lvl?.toLowerCase()] || T.inkSoft);

  const check = async () => {
    setLoading(true); setError(null); setReport(null);
    try {
      const b64 = imageToBase64(img);
      const result = await askClaude(
        `You are an IP screening assistant for a custom apparel print shop. A customer submitted this logo for printing. Screen it for potential intellectual-property concerns: resemblance to known brand logos/trademarks, use of copyrighted characters or artwork, protected sports/team/league marks, celebrity likenesses, or trademarked wordmarks in visible text.

Respond ONLY with valid JSON, no markdown, matching exactly:
{
 "riskLevel": "low|medium|high",
 "summary": "one-sentence overall assessment",
 "textFound": "any visible text, or null",
 "flags": [{"element":"string","concern":"string","resembles":"string or null"}],
 "recommendation": "what the shop should do next"
}
If nothing concerning is present, return riskLevel low with an empty flags array. Be specific but do not overstate — this is a screening aid, not a legal determination.`,
        b64
      );
      setReport(result);
    } catch (e) {
      setError(`Check failed: ${e.message}`);
    }
    setLoading(false);
  };

  return (
    <div className="grid gap-5 md:grid-cols-3">
      <div className="space-y-4">
        <Drop label="Customer-submitted logo"
          onFile={(image, url) => { setImg(image); setDataUrl(url); setReport(null); }} />
        <button onClick={check} disabled={!img || loading}
          className="w-full py-2 rounded font-medium text-sm"
          style={{ background: img && !loading ? T.ink : T.line, color: "#fff" }}>
          {loading ? "Screening…" : "Run IP screen"}
        </button>
        {error && <div className="text-sm" style={{ color: T.bad }}>{error}</div>}
      </div>

      <div className="md:col-span-2 space-y-4">
        {loading && <Spinner text="Screening for trademark and copyright signals…" />}
        {!report && !loading && (
          <div className="rounded-lg p-6 text-sm" style={{ background: T.card, border: `1px solid ${T.line}`, color: T.inkSoft }}>
            Flags likely brand marks, characters, team logos, and trademarked text in customer uploads before they hit production. Screening aid only — borderline cases go to a human (or a lawyer).
          </div>
        )}
        {report && (
          <div className="rounded-lg p-5 space-y-4" style={{ background: T.card, border: `1px solid ${T.line}` }}>
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 rounded-full text-sm font-semibold uppercase"
                style={{ fontFamily: mono, background: riskColor(report.riskLevel), color: "#fff" }}>
                {report.riskLevel} risk
              </span>
              <span className="text-sm" style={{ color: T.ink }}>{report.summary}</span>
            </div>
            {report.textFound && (
              <div className="text-sm" style={{ color: T.ink }}>
                <span style={{ fontFamily: mono, fontSize: 11, color: T.inkSoft }}>TEXT FOUND · </span>{report.textFound}
              </div>
            )}
            {report.flags?.length > 0 && (
              <div className="space-y-2">
                {report.flags.map((f, i) => (
                  <div key={i} className="p-3 rounded text-sm" style={{ background: "#FBF7F0", border: `1px solid ${T.line}` }}>
                    <strong style={{ color: T.ink }}>{f.element}</strong>
                    <div style={{ color: T.inkSoft }}>{f.concern}{f.resembles ? ` — resembles ${f.resembles}` : ""}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="text-sm pt-2" style={{ borderTop: `1px solid ${T.line}`, color: T.ink }}>
              <span style={{ fontFamily: mono, fontSize: 11, color: T.inkSoft }}>NEXT STEP · </span>{report.recommendation}
            </div>
            <p className="text-xs" style={{ color: T.inkSoft }}>
              Automated screening, not legal advice. High/medium results should be reviewed by a person before printing.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- App shell ----------
const TABS = [
  { id: "blend", label: "Logo Blender", chip: T.magenta, sub: "fade a logo into fabric" },
  { id: "template", label: "Template Extractor", chip: T.cyan, sub: "strip a sample into a reusable form" },
  { id: "ip", label: "Copyright Screen", chip: T.yellowChip, sub: "flag copyrighted logos" },
];

export default function App() {
  const [tab, setTab] = useState("blend");
  return (
    <div className="min-h-screen" style={{ background: T.paper, fontFamily: sans, color: T.ink }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');`}</style>
      <header className="px-6 pt-6 pb-4" style={{ borderBottom: `1px solid ${T.line}` }}>
        <div className="flex items-baseline gap-3">
          <span style={{ fontFamily: mono, fontSize: 18, color: T.magenta }}>⊕</span>
          <h1 className="text-xl font-semibold tracking-tight">InkWells</h1>
          <span className="text-xs" style={{ fontFamily: mono, color: T.inkSoft }}>logo blend · templates · copyright screen</span>
        </div>
        <nav className="flex gap-2 mt-4 flex-wrap">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
              style={{
                background: tab === t.id ? T.card : "transparent",
                border: `1px solid ${tab === t.id ? T.ink : "transparent"}`,
                color: tab === t.id ? T.ink : T.inkSoft,
              }}>
              <span style={{ width: 10, height: 10, background: t.chip, borderRadius: 2, display: "inline-block" }} />
              <span className="font-medium">{t.label}</span>
              <span className="hidden sm:inline text-xs" style={{ color: T.inkSoft }}>· {t.sub}</span>
            </button>
          ))}
        </nav>
      </header>
      <main className="p-6 max-w-6xl mx-auto">
        {tab === "blend" && <LogoBlender />}
        {tab === "template" && <TemplateExtractor />}
        {tab === "ip" && <CopyrightChecker />}
      </main>
    </div>
  );
}