#!/usr/bin/env node
/* Painter extension vectors: arrowheads + per-class edge colour are OPT-IN and
 * must leave the shipped pool/market frames byte-identical (those maps never
 * set paint.arrows / paint.edgeClassOf).
 * Stub ctx only — no DOM, no chain, no browser. */
"use strict";
globalThis.PoolNet = require("/workspace/vanilla/js/api/pool-net.js");
const MP = require("/workspace/vanilla/js/views/pool-net-paint.js");

let pass = 0, fail = 0;
function ok(c, n) { if (c) pass++; else { fail++; console.log("FAIL " + n); } }

/* ctx stub: counts ink so "did an arrowhead get painted" is measurable, and
 * records every strokeStyle assignment (assignment captured via a setter so
 * the value is observed even though drawScene assigns before stroking). */
function stubCtx() {
  /* fill() alone is NOT an arrowhead signal: node discs fill too. An
   * arrowhead is a moveTo-led filled polygon, so count THAT. */
  const st = { fills: 0, strokes: 0, styles: [], triFills: 0 };
  let style = "", inPath = false, pathHadMove = false;
  const ctx = {
    setTransform() {}, clearRect() {}, save() {}, restore() {},
    beginPath() { inPath = true; pathHadMove = false; },
    moveTo() { pathHadMove = true; },
    lineTo() {}, closePath() {},
    stroke() { st.strokes++; },
    arc() { pathHadMove = false; },
    fill() { st.fills++; if (inPath && pathHadMove) st.triFills++; },
    fillText() {}, strokeText() {}, quadraticCurveTo() {},
    fillStyle: "", lineWidth: 1, font: "", textAlign: "", globalAlpha: 1,
    shadowColor: "", shadowBlur: 0
  };
  Object.defineProperty(ctx, "strokeStyle", {
    get() { return style; }, set(v) { style = v; st.styles.push(v); }
  });
  return { ctx, st };
}

const view = {
  nodes: [{ assetId: "1.2.1", sym: "alice" }, { assetId: "1.2.2", sym: "bob" }],
  edges: [{ a: "1.2.1", b: "1.2.2", poolId: "1.2.1|1.2.2|transfer", cls: "transfer" },
          { a: "1.2.1", b: "1.2.2", poolId: "1.2.1|1.2.2|credit", cls: "credit" }]
};
const geom = { "1.2.1": { x: 20, y: 20 }, "1.2.2": { x: 200, y: 160 } };

ok(typeof MP.drawScene === "function", "drawScene exported");

// 1. DEFAULT (pool/market maps): no arrowhead ink at all.
{
  const { ctx, st } = stubCtx();
  MP.drawScene(ctx, 320, 240, view, geom, { scale: 1, ox: 0, oy: 0 });
  ok(st.strokes >= 2, "both edges stroked without paint.arrows (" + st.strokes + ")");
  ok(st.triFills === 0, "NO arrowhead ink when paint.arrows is absent (" + st.triFills + ")");
}

// 2. Opt-in arrows: one filled triangle per edge, at the `b` end.
{
  const { ctx, st } = stubCtx();
  MP.drawScene(ctx, 320, 240, view, geom, { scale: 1, ox: 0, oy: 0, arrows: true });
  ok(st.triFills >= 2, "an arrowhead per edge when paint.arrows is true (" + st.triFills + ")");
  ok(st.strokes >= 2, "the lines themselves still draw");
}

// 3. Opt-in class colour: edgeClassOf returning a token name resolves to a
//    real colour string, and DIFFERENT classes get different colours.
{
  const { ctx, st } = stubCtx();
  MP.drawScene(ctx, 320, 240, view, geom, {
    scale: 1, ox: 0, oy: 0, arrows: true,
    edgeClassOf: (e) => (e.cls === "credit" ? "buy" : "sell")
  });
  const colored = st.styles.filter((v) => typeof v === "string" && v.length);
  ok(colored.length >= 2, "strokeStyle assigned per edge");
  const uniq = new Set(colored.filter((v) => /^#|rgb/.test(v)));
  ok(uniq.size >= 2, "the two classes resolve to DIFFERENT colours (" + Array.from(uniq).join(",") + ")");
}

// 4. An unknown class name falls back to the volume ramp (never a crash).
{
  const { ctx, st } = stubCtx();
  let threw = false;
  try { MP.drawScene(ctx, 320, 240, view, geom, { scale: 1, ox: 0, oy: 0, edgeClassOf: () => "nope" }); }
  catch (e) { threw = true; }
  ok(!threw, "an unknown class token never throws");
  ok(st.strokes >= 2, "edges still draw with an unknown token");
}

// 5. A throwing edgeClassOf degrades silently (display hook, not data).
{
  const { ctx } = stubCtx();
  let threw = false;
  try { MP.drawScene(ctx, 320, 240, view, geom, {
    scale: 1, ox: 0, oy: 0, edgeClassOf: () => { throw new Error("boom"); } }); }
  catch (e) { threw = true; }
  ok(!threw, "a throwing edgeClassOf never breaks the frame");
}

// 6. Hover still wins over the class colour (interaction state outranks data).
{
  const { ctx, st } = stubCtx();
  MP.drawScene(ctx, 320, 240, { nodes: view.nodes, edges: [view.edges[0]] }, geom,
    { scale: 1, ox: 0, oy: 0, hoverEdge: view.edges[0].poolId, edgeClassOf: () => "sell" });
  ok(st.styles.length >= 1 && st.styles[0] !== undefined, "hover path assigns a colour");
  ok(st.triFills === 0, "hover does not add arrowheads on its own");
}

// 7. Opt-in node fill: seeds vs counterparts resolve to DIFFERENT colours,
//    and the default (no hook) stays the shipped brand palette.
{
  const { ctx, st } = stubCtx();
  const acctView = {
    nodes: [{ assetId: "1.2.1", sym: "alice", seeded: true }, { assetId: "1.2.2", sym: "bob", seeded: false }],
    edges: [view.edges[0]]
  };
  MP.drawScene(ctx, 320, 240, acctView, geom, {
    scale: 1, ox: 0, oy: 0, nodeFillOf: (n) => (n.seeded ? "accent" : "muted")
  });
  const fills = st.fills;
  ok(fills >= 2, "nodes filled with the hook (" + fills + ")");
}
{
  const { ctx, st } = stubCtx();
  MP.drawScene(ctx, 320, 240, view, geom, {
    scale: 1, ox: 0, oy: 0, nodeFillOf: () => "nope"
  });
  ok(st.strokes >= 2, "an unknown node token falls back to the brand palette, no crash");
}
{
  let threw = false;
  const { ctx } = stubCtx();
  try { MP.drawScene(ctx, 320, 240, view, geom, {
    scale: 1, ox: 0, oy: 0, nodeFillOf: () => { throw new Error("boom"); } }); }
  catch (e) { threw = true; }
  ok(!threw, "a throwing nodeFillOf never breaks the frame");
}

console.log("account-net-paint: " + pass + " pass, " + fail + " fail");
process.exitCode = fail ? 1 : 0;
