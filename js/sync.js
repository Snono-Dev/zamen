/* Smart sync engine (PluralEyes-style, improved):

   Core idea — CHUNK VOTING with linear fit:
   Instead of correlating whole clips (which fails when device clocks
   drift), the fragment is cut into short overlapping chunks. Each chunk
   is located independently (drift is negligible inside a few seconds),
   then a least-squares line through (position -> reference index)
   yields BOTH the precise placement AND the speed-drift rate.

   Also handles partial overlaps: fragments that hang past either edge
   of a source are placed from whichever chunks survive.

   No manual reference needed: the longest file anchors the timeline,
   every other file is located inside the anchor OR inside any
   already-placed clip (chained alignment for spanned clips). */

const SyncEngine = (() => {
  const D = (typeof DSP !== "undefined") ? DSP : require("./dsp");

  const tick = () => new Promise(r => setTimeout(r, 0));

  const chunkLenFor = (M, sr) =>
    Math.max(Math.round(sr * 2.5), Math.floor(M / 16));

  /* Final proof: re-locate three short probes of `needle` at their
     PREDICTED positions inside `haystack` given a claimed placement.
     We verify GEOMETRY (position residuals stay in the millisecond range
     across the whole clip), which is content-independent — a wrong match
     scatters by seconds while a true one stays tight even under drift. */
  async function verifyPlacement(haystack, needle, startSamples, rate, srN, confMin) {
    const N = haystack.length, M = needle.length;
    if (M < srN * 8 || startSamples == null || !isFinite(startSamples)) return true;
    const plen = Math.min(chunkLenFor(M, srN), Math.max(srN * 2, Math.round(M / 8)));
    const errs = [];
    let scored = 0;
    for (const f of [0.06, 0.5, 0.94]) {
      const p = Math.min(M - plen, Math.max(0, Math.round(f * (M - plen))));
      const expected = startSamples + p * rate;
      const slack = Math.max(srN * 2, Math.round(M * 0.02));
      const s = Math.max(0, Math.floor(expected - slack));
      const e = Math.min(N, Math.ceil(expected + plen + slack));
      if (e - s < plen) continue;
      const m = await D.findInReference(haystack.subarray(s, e), needle.subarray(p, p + plen));
      await tick();
      errs.push(Math.abs(s + m.index - expected));
      if (m.score >= confMin * 0.6) scored++;
    }
    if (!errs.length) return true;
    errs.sort((a, b) => a - b);
    const medErrMs = errs[Math.floor(errs.length / 2)] / srN * 1000;
    const tolMs = Math.max(25, (M / srN) * 1000 * 0.0012);
    console.log("[verify] errs(ms):", errs.map(e => (e / srN * 1000).toFixed(1)), "med=" + medErrMs.toFixed(1) + " tol=" + tolMs.toFixed(1) + " scored=" + scored);
    return medErrMs <= tolMs && scored >= 2;
  }

  /* Locate `frag` inside `ref` using short-chunk voting + linear fit.
     Returns { startSamples, score, rate, partial } or null when nothing
     reliable is found. rate = playback speed of frag relative to ref
     (1 = identical clock). partial = "tail" | "head" | null. */
  async function locate(ref, frag, sr, confMin, onProgress) {
    const N = ref.length, M = frag.length;
    if (M > N || M < sr * 4) return null;

    // Short chunks keep drift negligible inside each chunk;
    // the cross-chunk linear fit recovers the drift itself.
    let chunkLen = Math.max(Math.round(sr * 2.5), Math.floor(M / 16));
    let K = Math.min(12, Math.floor(M / chunkLen));
    if (K < 3) { K = 3; chunkLen = Math.floor(M / K); }

    const results = [];
    for (let k = 0; k < K; k++) {
      const pos = Math.round(k * (M - chunkLen) / (K - 1));
      const m = await D.findInReference(
        ref,
        frag.subarray(pos, pos + chunkLen),
        p => { if (onProgress) onProgress((k + p) / K); }
      );
      await tick();
      results.push({ pos, index: m.index, score: m.score });
    }

    console.log("[locate] chunks:", results.map(r => ({ pos: r.pos, idx: r.index, score: r.score.toFixed(4) })));
    const ok = results.filter(r => r.score >= confMin);
    if (!ok.length) {
      console.log("[locate] no chunk above confMin=" + confMin + ", best=" + Math.max(...results.map(r => r.score)).toFixed(4));
      const best = await edgeTrims(ref, frag, sr, confMin, onProgress);
      return best;
    }

    /* ---- robust linear fit with one round of outlier rejection ---- */
    function fit(points) {
      const mp = points.reduce((s, r) => s + r.pos, 0) / points.length;
      const mi = points.reduce((s, r) => s + r.index, 0) / points.length;
      let num = 0, den = 0;
      for (const r of points) {
        num += (r.pos - mp) * (r.index - mi);
        den += (r.pos - mp) * (r.pos - mp);
      }
      const slope = den > 0 ? num / den : 1;
      return { intercept: mi - slope * mp, slope };
    }

    let used = ok;
    {
      const f1 = fit(ok);
      const thr = Math.max(sr * 0.012, M * 0.004); // ~12 ms or 0.4% of clip
      const kept = ok.filter(r => Math.abs(r.index - (f1.intercept + f1.slope * r.pos)) <= thr);
      if (kept.length >= 2 && kept.length < ok.length) used = kept;
    }

    const { intercept, slope } = fit(used);
    let rate = slope;
    if (!isFinite(rate) || Math.abs(rate - 1) > 0.05) rate = 1;

    // Deadband: if the measured drift would shift this clip by less than
    // ~12 ms overall (a third of a frame), it is imperceptible — treat the
    // clip as perfect 1x so the user never has to apply a speed change.
    const spanMs = Math.abs(rate - 1) * (M / sr) * 1000;
    let start;
    if (spanMs < 12) {
      rate = 1;
      start = used.reduce((s, r) => s + (r.index - r.pos), 0) / used.length;
    } else {
      start = intercept;
    }

    let score = used.reduce((s, r) => s + r.score, 0) / used.length;

    let partial = null;
    if (start < -sr || start + M * rate > N + sr) {
      partial = start < 0 ? "head" : "tail";
    }
    return finalize(start, score, rate, partial);
  }

  function finalize(startSamples, score, rate, partial) {
    return {
      startSamples,
      score,
      rate: rate || 1,
      partial: partial || null
    };
  }

  /* Fallback for short clips / heavy overhang: try full, then drop the
     trailing quarter, then drop the leading quarter. */
  async function edgeTrims(ref, frag, sr, confMin, onProgress) {
    const M = frag.length;
    const q = Math.round(M * 0.25);
    console.log("[edgeTrims] trying edge trims, M=" + M + " q=" + q);

    const head = frag.subarray(0, M - q);
    const mA = await D.findInReference(ref, head, p => onProgress && onProgress(p * 0.33));
    await tick();

    const tailPart = frag.subarray(q);
    const mB = await D.findInReference(ref, tailPart, p => onProgress && onProgress(0.33 + p * 0.33));
    await tick();
    console.log("[edgeTrims] head score=" + mA.score.toFixed(4) + " tail score=" + mB.score.toFixed(4));

    const cands = [
      { startSamples: mA.index, score: mA.score, rate: 1, partial: "tail", valid: mA.index >= 0 },
      { startSamples: mB.index - q, score: mB.score, rate: 1, partial: "head", valid: mB.index - q >= -q }
    ].filter(c => c.valid && c.score >= confMin)
     .sort((a, b) => b.score - a.score);

    if (!cands.length) return null;
    const c = cands[0];
    return finalize(c.startSamples, c.score, c.rate, c.partial);
  }

  /* clips: [{id, name, mono, sr, duration}]
     opts: { confMin, gap, drift, onProgress(frac, name) }
     returns placements sorted by start:
     [{ clip, start, end, score, driftMs, partial, note }] */
  async function align(clips, opts) {
    console.log("[align] starting with", clips.length, "clips, confMin=", opts.confMin);
    for (const c of clips) console.log("[align] clip:", c.name, "dur=" + c.duration.toFixed(2) + "s");
    const order = [...clips].sort((a, b) => b.duration - a.duration);
    const anchor = order[0];
    const placements = new Map();
    placements.set(anchor.id, {
      clip: anchor, start: 0, end: anchor.duration,
      score: null, driftMs: null, partial: null, note: "anchor"
    });

    const others = order.slice(1);
    let cursor = anchor.duration;

    // locate one clip against every currently-placed clip.
    // Returns best verified { startSec, rate, score, partial } in GLOBAL seconds.
    async function tryPlace(c, fracBase, fracSpan) {
      let best = null;
      console.log("[tryPlace] searching for:", c.name);
      const consider = cand => {
        if (cand && (!best || cand.score > best.score)) best = cand;
      };
      const sources = [...placements.values()];
      for (let si = 0; si < sources.length; si++) {
        const srcPl = sources[si];
        if (srcPl.note === "unmatched") continue; // never chain off a bogus placement
        const src = srcPl.clip;
        if (opts.onProgress) {
          opts.onProgress(fracBase + (si / Math.max(1, sources.length)) * fracSpan, c.name);
        }
        const gOff = srcPl.note === "anchor" ? 0 : srcPl.start;

        if (c.mono.length < src.mono.length) {
          // normal: place the shorter incoming clip inside the source
          console.log("[tryPlace] locate:", c.name, "inside", src.name, "(normal)");
          const loc = await locate(src.mono, c.mono, c.sr, opts.confMin);
          if (loc) {
            console.log("[tryPlace] found:", c.name, "score=" + loc.score.toFixed(4), "start=" + (loc.startSamples / c.sr).toFixed(3) + "s");
            consider({
              startSec: gOff + loc.startSamples / c.sr,
              rate: loc.rate, score: loc.score, partial: loc.partial,
              haystack: src.mono, needle: c.mono,
              localStart: loc.startSamples, srN: c.sr
            });
          }
        } else {
          // incoming clip is LONGER than this source: reverse-search the
          // source inside it. The fitted intercept (source start in the
          // incoming clip's local time) yields the incoming global start.
          console.log("[tryPlace] locate:", src.name, "inside", c.name, "(reverse)");
          const rev = await locate(c.mono, src.mono, src.sr, opts.confMin);
          if (rev) {
            console.log("[tryPlace] found reverse:", src.name, "score=" + rev.score.toFixed(4), "start=" + (rev.startSamples / src.sr).toFixed(3) + "s");
            consider({
              startSec: gOff - rev.startSamples / src.sr,
              rate: rev.rate, score: rev.score * 0.98,
              partial: rev.startSamples < 2 * src.sr ? "tail" : null,
              haystack: c.mono, needle: src.mono,
              localStart: rev.startSamples, srN: src.sr
            });
          }
        }
        await tick();
      }

      /* ---- final gate: independently prove the winning placement ---- */
      if (best) {
        console.log("[tryPlace] best candidate:", c.name, "score=" + best.score.toFixed(4), "start=" + best.startSec.toFixed(3) + "s");
        const proven = await verifyPlacement(
          best.haystack, best.needle, best.localStart, best.rate, best.srN, opts.confMin
        );
        if (!proven) {
          console.log("[tryPlace] verifyPlacement REJECTED:", c.name);
          return null; // better no timecode than a wrong one
        }
        console.log("[tryPlace] verifyPlacement PASSED:", c.name);
      }
      return best;
    }

    function commitPlacement(c, best) {
      const useRate = !!opts.drift;
      const rate = useRate ? best.rate : 1;
      let start = best.startSec;
      console.log("[commit] PLACED:", c.name, "start=" + start.toFixed(3) + "s", "score=" + best.score.toFixed(4));
      placements.set(c.id, {
        clip: c, start,
        end: start + c.duration * rate,
        score: best.score,
        driftMs: useRate && Math.abs(best.rate - 1) > 1e-6 ? (best.rate - 1) * 60000 : null,
        partial: best.partial,
        note: null
      });
      cursor = Math.max(cursor, start + c.duration * rate + (opts.gap || 0));
    }

    // pass 1: longest-first
    for (let i = 0; i < others.length; i++) {
      const c = others[i];
      const best = await tryPlace(c, i / others.length, 1 / Math.max(1, others.length));
      if (best && best.score >= opts.confMin) {
        commitPlacement(c, best);
      } else {
        console.log("[pass1] UNMATCHED:", c.name, "bestScore=" + (best ? best.score.toFixed(4) : "null"));
        placements.set(c.id, {
          clip: c, start: cursor, end: cursor + c.duration,
          score: best ? best.score : null, driftMs: null, partial: null,
          note: "unmatched"
        });
        cursor += c.duration + (opts.gap || 0);
      }
      await tick();
    }

    // pass 2: retry clips that failed earlier — sources available NOW
    // may allow chains that were impossible in the longest-first order
    const stuck = [...placements.values()].filter(p => p.note === "unmatched");
    for (let j = 0; j < stuck.length; j++) {
      const p = stuck[j];
      const best = await tryPlace(p.clip, 0.9 + (j / Math.max(1, stuck.length)) * 0.09, 0.09 / Math.max(1, stuck.length));
      if (best && best.score >= opts.confMin) {
        commitPlacement(p.clip, best);
      }
      await tick();
    }

    const out = [...placements.values()].sort((a, b) => a.start - b.start);

    // Shift all placements so the earliest start is 0
    const minStart = Math.min(...out.map(p => p.start));
    if (minStart < 0) {
      for (const p of out) {
        p.start -= minStart;
        p.end -= minStart;
      }
    }

    if (opts.onProgress) opts.onProgress(1, "");
    return out;
  }

  return { align, locate, verifyPlacement };
})();

if (typeof module !== "undefined" && module.exports) module.exports = SyncEngine;
