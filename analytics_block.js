// ============================================================
// ANALYTICS PORTAL — Body Comp + Performance + Recovery + Compare
// ============================================================
function fmtShortDate(s) {
  if (!s) return "";
  var parts = s.slice(0, 10).split("-");
  if (parts.length !== 3) return s;
  var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return months[parseInt(parts[1], 10) - 1] + " " + parseInt(parts[2], 10);
}
function fmtSignedNum(n, dp) {
  if (n == null || isNaN(n)) return "—";
  var p = (dp == null ? 1 : dp);
  return (n > 0 ? "+" : "") + n.toFixed(p);
}
function daysBetween(a, b) {
  if (!a || !b) return 0;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}
function deriveBodyComp(r) {
  var w = r.weight_lbs != null ? parseFloat(r.weight_lbs) : null;
  var bf = r.body_fat_pct != null ? parseFloat(r.body_fat_pct) : null;
  var lean = r.lean_mass_lbs != null ? parseFloat(r.lean_mass_lbs)
    : (w != null && bf != null ? +(w * (1 - bf / 100)).toFixed(2) : null);
  var fat = r.fat_mass_lbs != null ? parseFloat(r.fat_mass_lbs)
    : (w != null && bf != null ? +(w * bf / 100).toFixed(2) : null);
  return { date: r.date, weight: w, bf: bf, lean: lean, fat: fat, raw: r };
}
function smaSeries(arr, getVal, winSize) {
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var sum = 0, n = 0;
    for (var j = Math.max(0, i - winSize + 1); j <= i; j++) {
      var v = getVal(arr[j]);
      if (v != null && !isNaN(v)) { sum += v; n++; }
    }
    out.push({ date: arr[i].date, val: n > 0 ? sum / n : null });
  }
  return out;
}
var META_MESO_START = "2026-04-14";
function TrendChart(props) {
  var data = (props.data || []).filter(function(d) { return d.val != null && !isNaN(d.val); });
  if (data.length < 2) {
    return React.createElement("div", { style: { color: C.mut, fontSize: 11, padding: "12px 0" } }, "Not enough data yet");
  }
  var W = 320, H = 130, pad = { l: 32, r: 8, t: 10, b: 20 };
  var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  var vals = data.map(function(d) { return d.val; });
  var vMin = Math.min.apply(null, vals), vMax = Math.max.apply(null, vals);
  var vRange = vMax - vMin || Math.max(Math.abs(vMax) * 0.1, 1);
  vMin = vMin - vRange * 0.15; vMax = vMax + vRange * 0.15; vRange = vMax - vMin || 1;
  var dates = data.map(function(d) { return new Date(d.date).getTime(); });
  var tMin = dates[0], tMax = dates[dates.length - 1], tRange = tMax - tMin || 1;
  function xTC(t) { return pad.l + ((t - tMin) / tRange) * iw; }
  function yTC(val) { return pad.t + (1 - (val - vMin) / vRange) * ih; }
  var d2 = data.map(function(d, i) {
    var px = xTC(new Date(d.date).getTime()), py = yTC(d.val);
    return (i === 0 ? "M" : "L") + px.toFixed(1) + "," + py.toFixed(1);
  }).join("");
  var color = props.color || C.blu;
  var unit = props.unit || "";
  var markerX = null;
  if (props.markerDate) {
    var mt = new Date(props.markerDate).getTime();
    if (mt >= tMin && mt <= tMax) markerX = xTC(mt);
  }
  var fmt = function(val) {
    if (unit === "%") return val.toFixed(1);
    if (Math.abs(val) >= 100) return val.toFixed(0);
    return val.toFixed(1);
  };
  return React.createElement("svg", {
    viewBox: "0 0 " + W + " " + H,
    style: { width: "100%", height: "auto", display: "block" },
    preserveAspectRatio: "xMidYMid meet"
  },
    [0, 0.5, 1].map(function(t, i) {
      var gv = vMin + vRange * (1 - t);
      return React.createElement("g", { key: "g" + i },
        React.createElement("line", { x1: pad.l, x2: W - pad.r, y1: pad.t + ih * t, y2: pad.t + ih * t, stroke: C.bdr, strokeWidth: 1, strokeDasharray: "2,3" }),
        React.createElement("text", { x: pad.l - 4, y: pad.t + ih * t + 3, fill: C.mut, fontSize: 9, textAnchor: "end" }, fmt(gv))
      );
    }),
    markerX != null ? React.createElement("g", { key: "m" },
      React.createElement("line", { x1: markerX, x2: markerX, y1: pad.t, y2: pad.t + ih, stroke: C.pur, strokeWidth: 1, strokeDasharray: "3,3", opacity: 0.8 }),
      React.createElement("text", { x: markerX + 3, y: pad.t + 9, fill: C.pur, fontSize: 8, fontWeight: 700 }, "M1")
    ) : null,
    React.createElement("path", { d: d2, fill: "none", stroke: color, strokeWidth: 1.6, strokeLinejoin: "round", strokeLinecap: "round" }),
    data.map(function(d, i) {
      var px = xTC(new Date(d.date).getTime()), py = yTC(d.val);
      return React.createElement("circle", { key: i, cx: px, cy: py, r: 3.2, fill: color, stroke: C.bg, strokeWidth: 0.8, style: { cursor: props.onTap ? "pointer" : "default" }, onClick: function() { if (props.onTap) props.onTap(d, i); } });
    }),
    React.createElement("text", { x: pad.l, y: H - 4, fill: C.mut, fontSize: 9, textAnchor: "start" }, fmtShortDate(data[0].date)),
    data.length > 4 ? React.createElement("text", { x: pad.l + iw / 2, y: H - 4, fill: C.mut, fontSize: 9, textAnchor: "middle" }, fmtShortDate(data[Math.floor(data.length / 2)].date)) : null,
    React.createElement("text", { x: W - pad.r, y: H - 4, fill: C.mut, fontSize: 9, textAnchor: "end" }, fmtShortDate(data[data.length - 1].date))
  );
}
function BarsChart(props) {
  var data = props.data || [];
  if (data.length === 0) {
    return React.createElement("div", { style: { color: C.mut, fontSize: 11, padding: "12px 0" } }, "No data");
  }
  var W = 320, H = 24 * data.length + 14, pad = { l: 90, r: 28, t: 4, b: 4 };
  var iw = W - pad.l - pad.r;
  var maxV = Math.max(props.maxOverride || 0, Math.max.apply(null, data.map(function(d) { return d.val || 0; })));
  if (props.bands && props.bands.mrv) maxV = Math.max(maxV, props.bands.mrv * 1.1);
  if (maxV < 1) maxV = 1;
  return React.createElement("svg", { viewBox: "0 0 " + W + " " + H, style: { width: "100%", height: "auto", display: "block" }, preserveAspectRatio: "xMidYMid meet" },
    props.bands ? React.createElement("g", { key: "bands", opacity: 0.18 },
      props.bands.mev ? React.createElement("rect", { x: pad.l, y: pad.t, width: (props.bands.mev / maxV) * iw, height: H - pad.t - pad.b, fill: C.red }) : null,
      props.bands.mav ? React.createElement("rect", { x: pad.l + ((props.bands.mev || 0) / maxV) * iw, y: pad.t, width: ((props.bands.mav - (props.bands.mev || 0)) / maxV) * iw, height: H - pad.t - pad.b, fill: C.grn }) : null,
      props.bands.mrv ? React.createElement("rect", { x: pad.l + ((props.bands.mav || 0) / maxV) * iw, y: pad.t, width: ((props.bands.mrv - (props.bands.mav || 0)) / maxV) * iw, height: H - pad.t - pad.b, fill: C.gld }) : null
    ) : null,
    data.map(function(d, i) {
      var by = pad.t + i * 24 + 3, bw = ((d.val || 0) / maxV) * iw, color = d.color || C.blu;
      return React.createElement("g", { key: i },
        React.createElement("text", { x: pad.l - 6, y: by + 12, fill: C.txt, fontSize: 11, textAnchor: "end" }, d.label),
        React.createElement("rect", { x: pad.l, y: by, width: bw, height: 16, fill: color, rx: 2 }),
        React.createElement("text", { x: pad.l + bw + 4, y: by + 12, fill: C.mut, fontSize: 10, textAnchor: "start" }, (d.val || 0).toFixed(d.dp == null ? 0 : d.dp) + (d.unit || ""))
      );
    })
  );
}
function MultiSeriesChart(props) {
  var series = props.series || [], allPoints = [];
  series.forEach(function(s) { (s.points || []).forEach(function(p) { if (p.val != null && !isNaN(p.val)) allPoints.push(p); }); });
  if (allPoints.length < 2) {
    return React.createElement("div", { style: { color: C.mut, fontSize: 11, padding: "12px 0" } }, "Not enough data yet");
  }
  var W = 320, H = 150, pad = { l: 32, r: 8, t: 10, b: 22 };
  var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  var vals = allPoints.map(function(p) { return p.val; });
  var vMin = Math.min.apply(null, vals), vMax = Math.max.apply(null, vals);
  var vRange = vMax - vMin || Math.max(Math.abs(vMax) * 0.1, 1);
  vMin = vMin - vRange * 0.1; vMax = vMax + vRange * 0.1; vRange = vMax - vMin || 1;
  var dates = allPoints.map(function(p) { return new Date(p.date).getTime(); });
  var tMin = Math.min.apply(null, dates), tMax = Math.max.apply(null, dates), tRange = tMax - tMin || 1;
  function xMS(t) { return pad.l + ((t - tMin) / tRange) * iw; }
  function yMS(val) { return pad.t + (1 - (val - vMin) / vRange) * ih; }
  var markerX = null;
  if (props.markerDate) { var mt2 = new Date(props.markerDate).getTime(); if (mt2 >= tMin && mt2 <= tMax) markerX = xMS(mt2); }
  return React.createElement("svg", { viewBox: "0 0 " + W + " " + H, style: { width: "100%", height: "auto", display: "block" }, preserveAspectRatio: "xMidYMid meet" },
    [0, 0.5, 1].map(function(t, i) {
      var gv = vMin + vRange * (1 - t);
      return React.createElement("g", { key: "g" + i },
        React.createElement("line", { x1: pad.l, x2: W - pad.r, y1: pad.t + ih * t, y2: pad.t + ih * t, stroke: C.bdr, strokeWidth: 1, strokeDasharray: "2,3" }),
        React.createElement("text", { x: pad.l - 4, y: pad.t + ih * t + 3, fill: C.mut, fontSize: 9, textAnchor: "end" }, gv >= 100 ? gv.toFixed(0) : gv.toFixed(1))
      );
    }),
    markerX != null ? React.createElement("line", { x1: markerX, x2: markerX, y1: pad.t, y2: pad.t + ih, stroke: C.pur, strokeWidth: 1, strokeDasharray: "3,3", opacity: 0.7 }) : null,
    series.map(function(s, si) {
      var pts = (s.points || []).filter(function(p) { return p.val != null && !isNaN(p.val); });
      if (pts.length < 2) return null;
      var d2 = pts.map(function(p, i) { var px = xMS(new Date(p.date).getTime()), py = yMS(p.val); return (i === 0 ? "M" : "L") + px.toFixed(1) + "," + py.toFixed(1); }).join("");
      return React.createElement("g", { key: "s" + si },
        React.createElement("path", { d: d2, fill: "none", stroke: s.color || C.blu, strokeWidth: 1.5, strokeLinejoin: "round", strokeLinecap: "round", opacity: s.opacity == null ? 1 : s.opacity }),
        s.showPoints !== false ? pts.map(function(p, i) { var px = xMS(new Date(p.date).getTime()), py = yMS(p.val); return React.createElement("circle", { key: i, cx: px, cy: py, r: 2.5, fill: s.color || C.blu, stroke: C.bg, strokeWidth: 0.6 }); }) : null
      );
    }),
    React.createElement("text", { x: pad.l, y: H - 6, fill: C.mut, fontSize: 9, textAnchor: "start" }, fmtShortDate(allPoints[0].date)),
    React.createElement("text", { x: W - pad.r, y: H - 6, fill: C.mut, fontSize: 9, textAnchor: "end" }, fmtShortDate(allPoints[allPoints.length - 1].date))
  );
}
function BodyCompView() {
  var s1 = React.useState([]); var rawReadings = s1[0]; var setRawReadings = s1[1];
  var s2 = React.useState(true); var loading = s2[0]; var setLoading = s2[1];
  var s3 = React.useState(null); var detailIdx = s3[0]; var setDetailIdx = s3[1];
  React.useEffect(function() {
    db.getBodyCompHistory(500).then(function(d) { setRawReadings(d || []); setLoading(false); }).catch(function() { setLoading(false); });
  }, []);
  if (loading) return React.createElement("div", { style: { padding: 32, textAlign: "center", color: C.mut } }, "Loading…");
  if (!rawReadings.length) return React.createElement("div", { style: { padding: 32, textAlign: "center", color: C.mut } }, "No body comp readings yet.");
  var asc = rawReadings.slice().sort(function(a, b) { return a.date < b.date ? -1 : 1; }).map(deriveBodyComp);
  var L = asc[asc.length - 1];
  if (detailIdx != null) {
    return React.createElement(ReadingDetailView, { cur: asc[detailIdx], prev: detailIdx > 0 ? asc[detailIdx - 1] : null, onBack: function() { setDetailIdx(null); } });
  }
  function findOnOrBefore(targetDate) {
    for (var i = asc.length - 1; i >= 0; i--) { if (asc[i].date <= targetDate) return asc[i]; }
    return null;
  }
  function dateNDaysBefore(refDate, n) {
    var d = new Date(refDate + "T12:00:00"); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10);
  }
  var ref7 = findOnOrBefore(dateNDaysBefore(L.date, 7));
  var ref28 = findOnOrBefore(dateNDaysBefore(L.date, 28));
  var peak = asc.reduce(function(m, r) { return (r.weight != null && (m == null || r.weight > m.weight)) ? r : m; }, null);
  var sinceMeso = asc.find(function(r) { return r.date >= META_MESO_START; }) || null;
  function mini(label, val, color) {
    return React.createElement("div", { style: { background: C.c2, borderRadius: 8, padding: "6px 8px" } },
      React.createElement("div", { style: { color: C.mut, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5 } }, label),
      React.createElement("div", { style: { color: color || C.txt, fontSize: 14, fontWeight: 700, marginTop: 2 } }, val)
    );
  }
  function rocCard(title, ref) {
    if (!ref) {
      return React.createElement("div", { style: { background: C.card, border: "1px solid " + C.bdr, borderRadius: 10, padding: 10 } },
        React.createElement("div", { style: { color: C.mut, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 } }, title),
        React.createElement("div", { style: { color: C.mut, fontSize: 12, marginTop: 6 } }, "No reference reading")
      );
    }
    var dW = L.weight != null && ref.weight != null ? (L.weight - ref.weight) : null;
    var dBF = L.bf != null && ref.bf != null ? (L.bf - ref.bf) : null;
    var dLean = L.lean != null && ref.lean != null ? (L.lean - ref.lean) : null;
    var dFat = L.fat != null && ref.fat != null ? (L.fat - ref.fat) : null;
    var days = daysBetween(ref.date, L.date);
    var leanColor = dLean == null ? C.mut : (dLean >= 0 ? C.grn : C.red);
    var fatColor = dFat == null ? C.mut : (dFat <= 0 ? C.grn : C.red);
    var wColor = dW == null ? C.mut : (dW < 0 ? C.grn : C.red);
    return React.createElement("div", { style: { background: C.card, border: "1px solid " + C.bdr, borderRadius: 10, padding: 10 } },
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 } },
        React.createElement("div", { style: { color: C.mut, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 } }, title),
        React.createElement("div", { style: { color: C.mut, fontSize: 9 } }, days + "d · " + fmtShortDate(ref.date))
      ),
      React.createElement("div", { style: { marginTop: 6, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4 } },
        React.createElement("div", null, React.createElement("div", { style: { color: C.mut, fontSize: 9 } }, "Weight"), React.createElement("div", { style: { color: wColor, fontSize: 13, fontWeight: 700 } }, fmtSignedNum(dW, 1) + " lb")),
        React.createElement("div", null, React.createElement("div", { style: { color: C.mut, fontSize: 9 } }, "BF%"), React.createElement("div", { style: { color: dBF == null ? C.mut : (dBF <= 0 ? C.grn : C.red), fontSize: 13, fontWeight: 700 } }, fmtSignedNum(dBF, 1) + "%")),
        React.createElement("div", null, React.createElement("div", { style: { color: C.mut, fontSize: 9 } }, "Lean"), React.createElement("div", { style: { color: leanColor, fontSize: 13, fontWeight: 700 } }, fmtSignedNum(dLean, 1) + " lb")),
        React.createElement("div", null, React.createElement("div", { style: { color: C.mut, fontSize: 9 } }, "Fat"), React.createElement("div", { style: { color: fatColor, fontSize: 13, fontWeight: 700 } }, fmtSignedNum(dFat, 1) + " lb"))
      )
    );
  }
  function chartBlock(title, key, color, unit) {
    var pts = asc.map(function(r) { return { date: r.date, val: r[key] }; });
    return React.createElement("div", { style: { background: C.card, border: "1px solid " + C.bdr, borderRadius: 10, padding: 10, marginBottom: 8 } },
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 } },
        React.createElement("div", { style: { color: C.txt, fontSize: 12, fontWeight: 700 } }, title),
        React.createElement("div", { style: { color: color, fontSize: 13, fontWeight: 700 } }, L[key] != null ? L[key].toFixed(unit === "%" ? 1 : 1) + (unit ? " " + unit : "") : "—")
      ),
      React.createElement(TrendChart, { data: pts, color: color, unit: unit, markerDate: META_MESO_START, onTap: function(d) { var idx = asc.findIndex(function(r) { return r.date === d.date; }); if (idx >= 0) setDetailIdx(idx); } })
    );
  }
  return React.createElement("div", null,
    React.createElement("div", { style: { background: C.card, borderRadius: 12, padding: 14, border: "1px solid " + C.bdr, marginBottom: 8, cursor: "pointer" }, onClick: function() { setDetailIdx(asc.length - 1); } },
      React.createElement("div", { style: { color: C.mut, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 } }, "Latest · " + fmtShortDate(L.date)),
      React.createElement("div", { style: { display: "flex", alignItems: "baseline", gap: 6, marginBottom: 8 } },
        React.createElement("div", { style: { color: C.txt, fontSize: 32, fontWeight: 800, lineHeight: 1 } }, L.weight != null ? L.weight.toFixed(1) : "—"),
        React.createElement("div", { style: { color: C.mut, fontSize: 13 } }, "lb")
      ),
      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 } },
        mini("BF%", L.bf != null ? L.bf.toFixed(1) + "%" : "—", C.gld),
        mini("Lean", L.lean != null ? L.lean.toFixed(1) + " lb" : "—", C.grn),
        mini("Fat", L.fat != null ? L.fat.toFixed(1) + " lb" : "—", C.red)
      )
    ),
    React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 } },
      rocCard("7-Day", ref7), rocCard("28-Day", ref28), rocCard("From Peak", peak), rocCard("Since Meso 1", sinceMeso)
    ),
    chartBlock("Weight", "weight", C.blu, "lb"),
    chartBlock("Body Fat", "bf", C.gld, "%"),
    chartBlock("Lean Mass", "lean", C.grn, "lb"),
    chartBlock("Fat Mass", "fat", C.red, "lb"),
    React.createElement("div", { style: { color: C.mut, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, marginTop: 8 } }, "All Readings (" + asc.length + ")"),
    asc.slice().reverse().map(function(r, i) {
      var origIdx = asc.length - 1 - i;
      return React.createElement("div", { key: r.date, onClick: function() { setDetailIdx(origIdx); }, style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 6px", borderBottom: "1px solid " + C.bdr, cursor: "pointer" } },
        React.createElement("div", null,
          React.createElement("div", { style: { color: C.txt, fontSize: 13, fontWeight: 600 } }, fmtShortDate(r.date)),
          r.bf != null ? React.createElement("div", { style: { color: C.mut, fontSize: 11, marginTop: 2 } }, r.bf.toFixed(1) + "% BF" + (r.lean != null ? " · " + r.lean.toFixed(1) + " lean" : "")) : null
        ),
        React.createElement("div", { style: { color: C.txt, fontSize: 15, fontWeight: 700 } }, r.weight != null ? r.weight.toFixed(1) + " lb" : "—")
      );
    })
  );
}
function ReadingDetailView(props) {
  var cur = props.cur, prev = props.prev;
  function delta(curV, prevV) { if (curV == null || prevV == null) return null; return curV - prevV; }
  function row(label, curV, prevV, unit, dp, betterDir) {
    var d = delta(curV, prevV), color = C.mut, dp1 = dp == null ? 1 : dp;
    if (d != null && Math.abs(d) > 0.001) {
      var good = betterDir === "up" ? d > 0 : (betterDir === "down" ? d < 0 : false);
      color = good ? C.grn : (betterDir ? C.red : C.mut);
    }
    return React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid " + C.bdr } },
      React.createElement("div", { style: { color: C.mut, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, paddingTop: 2 } }, label),
      React.createElement("div", { style: { textAlign: "right" } },
        React.createElement("div", { style: { color: C.txt, fontSize: 15, fontWeight: 700 } }, curV != null ? curV.toFixed(dp1) + (unit ? " " + unit : "") : "—"),
        d != null ? React.createElement("div", { style: { color: color, fontSize: 11, marginTop: 2 } }, fmtSignedNum(d, dp1) + (unit ? " " + unit : "") + (prev ? " vs " + fmtShortDate(prev.date) : "")) : null
      )
    );
  }
  return React.createElement("div", null,
    React.createElement("button", { onClick: props.onBack, style: { background: "transparent", border: "1px solid " + C.bdr, color: C.mut, fontSize: 12, borderRadius: 8, padding: "6px 14px", marginBottom: 10, cursor: "pointer" } }, "← Back"),
    React.createElement("div", { style: { background: C.card, borderRadius: 12, padding: 14, border: "1px solid " + C.bdr } },
      React.createElement("div", { style: { color: C.mut, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 } }, fmtShortDate(cur.date)),
      row("Weight", cur.weight, prev ? prev.weight : null, "lb", 1, "down"),
      row("Body Fat", cur.bf, prev ? prev.bf : null, "%", 1, "down"),
      row("Lean Mass", cur.lean, prev ? prev.lean : null, "lb", 1, "up"),
      row("Fat Mass", cur.fat, prev ? prev.fat : null, "lb", 1, "down"),
      cur.raw && cur.raw.resting_hr != null ? row("Resting HR", parseFloat(cur.raw.resting_hr), prev && prev.raw && prev.raw.resting_hr != null ? parseFloat(prev.raw.resting_hr) : null, "bpm", 0, "down") : null,
      cur.raw && cur.raw.waist_inches != null ? row("Waist", parseFloat(cur.raw.waist_inches), prev && prev.raw && prev.raw.waist_inches != null ? parseFloat(prev.raw.waist_inches) : null, "in", 1, "down") : null,
      cur.raw && cur.raw.notes ? React.createElement("div", { style: { marginTop: 10, color: C.mut, fontSize: 12 } }, cur.raw.notes) : null
    )
  );
}
function PerformanceView() {
  var s1 = React.useState(null); var loaded = s1[0]; var setLoaded = s1[1];
  var s2 = React.useState(""); var selExName = s2[0]; var setSelExName = s2[1];
  React.useEffect(function() {
    Promise.all([db.getAllSets(), db.getAllSessions(), db.getAllExercises(), db.getVolumeLandmarks(), db.getAllMesocycles()])
      .then(function(arr) { setLoaded({ sets: arr[0] || [], sessions: arr[1] || [], exercises: arr[2] || [], landmarks: arr[3] || [], mesos: arr[4] || [] }); })
      .catch(function(e) { console.error("Performance load:", e); setLoaded({ sets: [], sessions: [], exercises: [], landmarks: [], mesos: [] }); });
  }, []);
  if (!loaded) return React.createElement("div", { style: { padding: 32, textAlign: "center", color: C.mut } }, "Loading…");
  var sets = loaded.sets, sessions = loaded.sessions, exercises = loaded.exercises;
  var landmarks = loaded.landmarks, mesos = loaded.mesos;
  if (sessions.length === 0) return React.createElement("div", { style: { padding: 32, textAlign: "center", color: C.mut } }, "No sessions logged yet.");
  var sessById = {}; sessions.forEach(function(s) { sessById[s.id] = s; });
  var exById = {}; exercises.forEach(function(e) { exById[e.id] = e; });
  var mesoById = {}; mesos.forEach(function(m) { mesoById[m.id] = m; });
  var lmByMG = {}; landmarks.forEach(function(l) { lmByMG[l.muscle_group] = l; });
  var annotatedSets = sets.map(function(st) {
    var s = sessById[st.session_id], e = exById[st.exercise_id];
    return { id: st.id, reps: st.reps, weight: parseFloat(st.weight) || 0, set_number: st.set_number, rpe: st.rpe, date: s ? s.date : null, sessionId: st.session_id, mesoId: s ? s.mesocycle_id : null, week: s ? s.week_number : null, exId: st.exercise_id, exName: e ? e.name : "Unknown", muscleGroup: e ? e.muscle_group : null, sessionRir: s ? s.rir : null };
  }).filter(function(s) { return s.date != null; });
  if (!selExName && annotatedSets.length) {
    var firstEx = annotatedSets[annotatedSets.length - 1];
    setSelExName(firstEx.exName);
    return React.createElement("div", { style: { padding: 32, textAlign: "center", color: C.mut } }, "Loading…");
  }
  var lastSeenByEx = {};
  annotatedSets.forEach(function(s) { lastSeenByEx[s.exName] = s.date; });
  var exNamesByRecency = Object.keys(lastSeenByEx).sort(function(a, b) { return lastSeenByEx[a] < lastSeenByEx[b] ? 1 : -1; });
  var exSets = annotatedSets.filter(function(s) { return s.exName === selExName; });
  var bySession = {};
  exSets.forEach(function(s) {
    if (!bySession[s.sessionId]) bySession[s.sessionId] = { date: s.date, mesoId: s.mesoId, week: s.week, sets: [] };
    bySession[s.sessionId].sets.push(s);
  });
  var sessionTops = Object.keys(bySession).map(function(sid) {
    var b = bySession[sid];
    var top = b.sets.reduce(function(m, s) { var e1rm = s.weight * (1 + s.reps / 30); return (m == null || e1rm > m.e1rm) ? { weight: s.weight, reps: s.reps, e1rm: e1rm } : m; }, null);
    return { date: b.date, mesoId: b.mesoId, week: b.week, top: top };
  }).sort(function(a, b) { return a.date < b.date ? -1 : 1; });
  var mesoColors = [C.blu, C.gld, C.grn, C.red, C.pur, C.org, C.teal];
  var mesoOrder = mesos.map(function(m) { return m.id; });
  var mesoColor = function(mid) { var i = mesoOrder.indexOf(mid); return i < 0 ? C.mut : mesoColors[i % mesoColors.length]; };
  var seriesByMeso = {};
  sessionTops.forEach(function(st) {
    var mid = st.mesoId || "none";
    if (!seriesByMeso[mid]) seriesByMeso[mid] = { mid: mid, points: [] };
    seriesByMeso[mid].points.push({ date: st.date, val: +st.top.e1rm.toFixed(1) });
  });
  var strengthSeries = Object.keys(seriesByMeso).map(function(mid) { var m = mesoById[mid]; return { label: m ? m.name : "Other", color: mesoColor(mid), points: seriesByMeso[mid].points }; });
  var lastSession = sessions[sessions.length - 1];
  var curMesoId = lastSession ? lastSession.mesocycle_id : null;
  var curWeek = lastSession ? lastSession.week_number : null;
  var weekSets = annotatedSets.filter(function(s) { return curMesoId && s.mesoId === curMesoId && s.week === curWeek; });
  var volByMG = {};
  weekSets.forEach(function(s) { if (!s.muscleGroup) return; volByMG[s.muscleGroup] = (volByMG[s.muscleGroup] || 0) + 1; });
  var mgList = Object.keys(lmByMG).sort();
  var volBars = mgList.map(function(mg) {
    var lm = lmByMG[mg], v = volByMG[mg] || 0, color = C.mut;
    if (lm) { if (v < (lm.mev_sets || 0)) color = C.red; else if (v <= (lm.mav_sets || 99)) color = C.grn; else if (v <= (lm.mrv_sets || 99)) color = C.gld; else color = C.red; }
    return { label: mg, val: v, color: color, unit: " sets" };
  }).filter(function(b) { return b.val > 0 || lmByMG[b.label]; });
  var curMesoSessions = sessions.filter(function(s) { return s.mesocycle_id === curMesoId; });
  var byWeek = {};
  curMesoSessions.forEach(function(s) { if (s.week_number == null) return; if (!byWeek[s.week_number]) byWeek[s.week_number] = []; byWeek[s.week_number].push(s); });
  var rirRows = Object.keys(byWeek).sort().map(function(wn) { var ses = byWeek[wn], rir = ses[0] && ses[0].rir; return { week: "W" + wn, rir: rir, count: ses.length }; });
  return React.createElement("div", null,
    React.createElement("div", { style: { background: C.card, borderRadius: 10, padding: 10, marginBottom: 8 } },
      React.createElement("div", { style: { color: C.mut, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 } }, "Exercise"),
      React.createElement("select", { value: selExName, onChange: function(e) { setSelExName(e.target.value); }, style: { width: "100%", padding: "8px 10px", borderRadius: 8, background: C.c2, color: C.txt, border: "1px solid " + C.bdr, fontSize: 13 } },
        exNamesByRecency.map(function(n) { return React.createElement("option", { key: n, value: n }, n); })
      )
    ),
    React.createElement("div", { style: { background: C.card, borderRadius: 10, padding: 10, marginBottom: 8 } },
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 } },
        React.createElement("div", { style: { color: C.txt, fontSize: 12, fontWeight: 700 } }, "e1RM Trend"),
        sessionTops.length ? React.createElement("div", { style: { color: C.blu, fontSize: 12, fontWeight: 700 } }, sessionTops[sessionTops.length - 1].top.e1rm.toFixed(0) + " lb") : null
      ),
      strengthSeries.length ? React.createElement(MultiSeriesChart, { series: strengthSeries, markerDate: META_MESO_START }) : React.createElement("div", { style: { color: C.mut, fontSize: 11, padding: "12px 0" } }, "No sets logged yet"),
      React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 } },
        strengthSeries.map(function(s, i) {
          return React.createElement("div", { key: i, style: { display: "flex", alignItems: "center", gap: 4 } },
            React.createElement("div", { style: { width: 10, height: 2, background: s.color, borderRadius: 1 } }),
            React.createElement("div", { style: { color: C.mut, fontSize: 10 } }, s.label)
          );
        })
      )
    ),
    React.createElement("div", { style: { background: C.card, borderRadius: 10, padding: 10, marginBottom: 8 } },
      React.createElement("div", { style: { color: C.txt, fontSize: 12, fontWeight: 700, marginBottom: 8 } }, selExName + " · Recent Sessions"),
      sessionTops.slice().reverse().slice(0, 12).map(function(st, i) {
        var meso = mesoById[st.mesoId];
        return React.createElement("div", { key: i, style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid " + C.bdr } },
          React.createElement("div", null, React.createElement("div", { style: { color: C.txt, fontSize: 12, fontWeight: 600 } }, fmtShortDate(st.date)), React.createElement("div", { style: { color: C.mut, fontSize: 10 } }, (meso ? meso.name : "—") + (st.week != null ? " · W" + st.week : ""))),
          React.createElement("div", { style: { textAlign: "right" } }, React.createElement("div", { style: { color: C.txt, fontSize: 13, fontWeight: 700 } }, st.top.weight + " × " + st.top.reps), React.createElement("div", { style: { color: mesoColor(st.mesoId), fontSize: 10 } }, "e1RM " + st.top.e1rm.toFixed(0)))
        );
      })
    ),
    React.createElement("div", { style: { background: C.card, borderRadius: 10, padding: 10, marginBottom: 8 } },
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 } },
        React.createElement("div", { style: { color: C.txt, fontSize: 12, fontWeight: 700 } }, "Weekly Volume"),
        React.createElement("div", { style: { color: C.mut, fontSize: 10 } }, (lastSession ? "W" + curWeek : "—") + (mesoById[curMesoId] ? " · " + mesoById[curMesoId].name : ""))
      ),
      React.createElement("div", { style: { display: "flex", gap: 12, marginBottom: 8, fontSize: 10 } },
        React.createElement("div", null, React.createElement("span", { style: { color: C.red } }, "■ "), "< MEV"),
        React.createElement("div", null, React.createElement("span", { style: { color: C.grn } }, "■ "), "MEV–MAV"),
        React.createElement("div", null, React.createElement("span", { style: { color: C.gld } }, "■ "), "MAV–MRV"),
        React.createElement("div", null, React.createElement("span", { style: { color: C.red } }, "■ "), "> MRV")
      ),
      React.createElement(BarsChart, { data: volBars })
    ),
    rirRows.length ? React.createElement("div", { style: { background: C.card, borderRadius: 10, padding: 10, marginBottom: 8 } },
      React.createElement("div", { style: { color: C.txt, fontSize: 12, fontWeight: 700, marginBottom: 8 } }, "RIR by Week"),
      rirRows.map(function(r, i) {
        return React.createElement("div", { key: i, style: { display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid " + C.bdr } },
          React.createElement("div", { style: { color: C.txt, fontSize: 12 } }, r.week),
          React.createElement("div", { style: { color: C.mut, fontSize: 12 } }, (r.rir || "—") + " · " + r.count + " session" + (r.count !== 1 ? "s" : ""))
        );
      })
    ) : null
  );
}
function RecoveryView() {
  var s1 = React.useState(null); var loaded = s1[0]; var setLoaded = s1[1];
  React.useEffect(function() {
    Promise.all([db.getHealthDaily(800), db.getAllSessions()]).then(function(arr) { setLoaded({ health: arr[0], sessions: arr[1] || [] }); }).catch(function() { setLoaded({ health: null, sessions: [] }); });
  }, []);
  if (!loaded) return React.createElement("div", { style: { padding: 32, textAlign: "center", color: C.mut } }, "Loading…");
  if (loaded.health == null) {
    return React.createElement("div", { style: { background: C.card, border: "1px solid " + C.bdr, borderRadius: 12, padding: 20 } },
      React.createElement("div", { style: { color: C.txt, fontSize: 14, fontWeight: 700, marginBottom: 8 } }, "Health Data Required"),
      React.createElement("div", { style: { color: C.mut, fontSize: 12, lineHeight: 1.4 } }, "Recovery analytics require the health_daily Supabase table.", React.createElement("br"), React.createElement("br"), "Run setup_health_daily.sql in the Supabase SQL editor to create the table, then seed it with Apple Health exports.")
    );
  }
  var health = loaded.health;
  if (health.length === 0) {
    return React.createElement("div", { style: { background: C.card, border: "1px solid " + C.bdr, borderRadius: 12, padding: 20 } },
      React.createElement("div", { style: { color: C.txt, fontSize: 14, fontWeight: 700, marginBottom: 8 } }, "No Health Data"),
      React.createElement("div", { style: { color: C.mut, fontSize: 12 } }, "Seed health_daily with Apple Health exports.")
    );
  }
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 120);
  var cutoffStr = cutoff.toISOString().slice(0, 10);
  var recent = health.filter(function(h) { return h.date >= cutoffStr; });
  var hLast = health[health.length - 1];
  var trainingDays = {}; loaded.sessions.forEach(function(s) { trainingDays[s.date] = true; });
  function statCard(label, key, unit, color, dp, betterDir) {
    var smaArr = smaSeries(recent, function(h) { return h[key] != null ? parseFloat(h[key]) : null; }, 7);
    var latestSma = smaArr.length ? smaArr[smaArr.length - 1].val : null;
    var prevSma = smaArr.length > 7 ? smaArr[smaArr.length - 8].val : null;
    var trend = latestSma != null && prevSma != null ? latestSma - prevSma : null;
    var trendColor = trend == null ? C.mut : (betterDir === "up" ? (trend > 0 ? C.grn : C.red) : (betterDir === "down" ? (trend < 0 ? C.grn : C.red) : C.mut));
    return React.createElement("div", { style: { background: C.card, border: "1px solid " + C.bdr, borderRadius: 10, padding: "8px 10px" } },
      React.createElement("div", { style: { color: C.mut, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5 } }, label),
      React.createElement("div", { style: { color: color, fontSize: 20, fontWeight: 800, margin: "4px 0 2px" } }, latestSma != null ? latestSma.toFixed(dp == null ? 0 : dp) : "—", React.createElement("span", { style: { color: C.mut, fontSize: 10, fontWeight: 600, marginLeft: 3 } }, unit)),
      trend != null ? React.createElement("div", { style: { color: trendColor, fontSize: 10, fontWeight: 600 } }, fmtSignedNum(trend, dp == null ? 0 : dp) + " 7d") : null
    );
  }
  function makeSeries(key, color) {
    var raw = recent.map(function(h) { return { date: h.date, val: h[key] != null ? parseFloat(h[key]) : null }; });
    var sma = smaSeries(recent, function(h) { return h[key] != null ? parseFloat(h[key]) : null; }, 7);
    return [{ label: "raw", color: color, points: raw, opacity: 0.35, showPoints: false }, { label: "7d avg", color: color, points: sma, opacity: 1, showPoints: false }];
  }
  function chartCard(title, key, unit, color) {
    return React.createElement("div", { style: { background: C.card, border: "1px solid " + C.bdr, borderRadius: 10, padding: 10, marginBottom: 8 } },
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 } },
        React.createElement("div", { style: { color: C.txt, fontSize: 12, fontWeight: 700 } }, title),
        React.createElement("div", { style: { color: color, fontSize: 12, fontWeight: 700 } }, hLast[key] != null ? parseFloat(hLast[key]).toFixed(unit === "ms" ? 1 : 0) + " " + unit : "—")
      ),
      React.createElement(MultiSeriesChart, { series: makeSeries(key, color), markerDate: META_MESO_START })
    );
  }
  var totalSessions = Object.keys(trainingDays).filter(function(d) { return d >= cutoffStr; }).length;
  return React.createElement("div", null,
    React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 } },
      statCard("HRV (7d)", "hrv_sdnn", "ms", C.grn, 1, "up"),
      statCard("RHR (7d)", "resting_hr", "bpm", C.blu, 0, "down"),
      statCard("Steps (7d)", "steps", "/d", C.gld, 0, "up")
    ),
    chartCard("HRV SDNN", "hrv_sdnn", "ms", C.grn),
    chartCard("Resting HR", "resting_hr", "bpm", C.blu),
    chartCard("Active Calories", "active_cal", "kcal", C.org),
    chartCard("Exercise Minutes", "exercise_min", "min", C.teal),
    React.createElement("div", { style: { background: C.card, border: "1px solid " + C.bdr, borderRadius: 10, padding: 10, marginBottom: 8 } },
      React.createElement("div", { style: { color: C.txt, fontSize: 12, fontWeight: 700, marginBottom: 8 } }, "Recovery Summary (120d)"),
      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 } },
        React.createElement("div", { style: { color: C.mut } }, "Training sessions"),
        React.createElement("div", { style: { color: C.txt, fontWeight: 700, textAlign: "right" } }, totalSessions),
        React.createElement("div", { style: { color: C.mut } }, "Days w/ HRV"),
        React.createElement("div", { style: { color: C.txt, fontWeight: 700, textAlign: "right" } }, recent.filter(function(h) { return h.hrv_sdnn != null; }).length),
        React.createElement("div", { style: { color: C.mut } }, "Avg HRV"),
        React.createElement("div", { style: { color: C.grn, fontWeight: 700, textAlign: "right" } },
          (function() { var arr = recent.filter(function(h) { return h.hrv_sdnn != null; }).map(function(h) { return parseFloat(h.hrv_sdnn); }); return arr.length ? (arr.reduce(function(a, b) { return a + b; }, 0) / arr.length).toFixed(1) + " ms" : "—"; })()
        ),
        React.createElement("div", { style: { color: C.mut } }, "Avg RHR"),
        React.createElement("div", { style: { color: C.blu, fontWeight: 700, textAlign: "right" } },
          (function() { var arr = recent.filter(function(h) { return h.resting_hr != null; }).map(function(h) { return parseFloat(h.resting_hr); }); return arr.length ? (arr.reduce(function(a, b) { return a + b; }, 0) / arr.length).toFixed(0) + " bpm" : "—"; })()
        )
      )
    )
  );
}
function CompareView() {
  var s1 = React.useState(null); var loaded = s1[0]; var setLoaded = s1[1];
  React.useEffect(function() {
    Promise.all([db.getAllSets(), db.getAllSessions(), db.getAllExercises(), db.getAllMesocycles(), db.getBodyCompHistory(500)])
      .then(function(arr) { setLoaded({ sets: arr[0] || [], sessions: arr[1] || [], exercises: arr[2] || [], mesos: arr[3] || [], body: arr[4] || [] }); })
      .catch(function() { setLoaded({ sets: [], sessions: [], exercises: [], mesos: [], body: [] }); });
  }, []);
  if (!loaded) return React.createElement("div", { style: { padding: 32, textAlign: "center", color: C.mut } }, "Loading…");
  if (loaded.mesos.length === 0) return React.createElement("div", { style: { padding: 32, textAlign: "center", color: C.mut } }, "No mesocycles yet.");
  var exById = {}; loaded.exercises.forEach(function(e) { exById[e.id] = e; });
  var mesoById = {}; loaded.mesos.forEach(function(m) { mesoById[m.id] = m; });
  var perMeso = loaded.mesos.map(function(m) {
    var mSessions = loaded.sessions.filter(function(s) { return s.mesocycle_id === m.id; });
    var mSessIds = {}; mSessions.forEach(function(s) { mSessIds[s.id] = true; });
    var mSets = loaded.sets.filter(function(s) { return mSessIds[s.session_id]; });
    var totalVolume = 0, topByEx = {}, mgVol = {};
    mSets.forEach(function(st) {
      var w = parseFloat(st.weight) || 0, r = parseInt(st.reps) || 0;
      totalVolume += w * r;
      var ex = exById[st.exercise_id]; if (!ex) return;
      var e1rm = w * (1 + r / 30);
      if (!topByEx[ex.name] || e1rm > topByEx[ex.name].e1rm) topByEx[ex.name] = { e1rm: e1rm, weight: w, reps: r };
      if (ex.muscle_group) mgVol[ex.muscle_group] = (mgVol[ex.muscle_group] || 0) + 1;
    });
    var startBC = null, endBC = null;
    if (m.start_date) {
      var ascB = loaded.body.slice().sort(function(a, b) { return a.date < b.date ? -1 : 1; });
      for (var i = 0; i < ascB.length; i++) { if (ascB[i].date >= m.start_date) { startBC = deriveBodyComp(ascB[i]); break; } }
      var endRef = m.end_date || (mSessions.length ? mSessions[mSessions.length - 1].date : null);
      if (endRef) { for (var j = ascB.length - 1; j >= 0; j--) { if (ascB[j].date <= endRef) { endBC = deriveBodyComp(ascB[j]); break; } } }
    }
    return { meso: m, sessions: mSessions.length, sets: mSets.length, totalVolume: totalVolume, topByEx: topByEx, mgVol: mgVol, startBC: startBC, endBC: endBC };
  }).filter(function(pm) { return pm.sessions > 0; });
  function deltaCell(curV, prevV, unit, dp, betterDir) {
    var d = curV != null && prevV != null ? curV - prevV : null, dpx = dp == null ? 1 : dp, color = C.mut;
    if (d != null && Math.abs(d) > 0.001) color = betterDir === "up" ? (d > 0 ? C.grn : C.red) : betterDir === "down" ? (d < 0 ? C.grn : C.red) : C.mut;
    return React.createElement("div", { style: { textAlign: "right" } },
      React.createElement("div", { style: { color: C.txt, fontSize: 13, fontWeight: 700 } }, curV != null ? curV.toFixed(dpx) + (unit ? " " + unit : "") : "—"),
      d != null ? React.createElement("div", { style: { color: color, fontSize: 10 } }, fmtSignedNum(d, dpx) + (unit ? " " + unit : "")) : null
    );
  }
  return React.createElement("div", null,
    perMeso.map(function(pm, idx) {
      var prev = idx > 0 ? perMeso[idx - 1] : null, prevTopByEx = prev ? prev.topByEx : {};
      var topExNames = Object.keys(pm.topByEx).sort(function(a, b) { return (pm.topByEx[b].e1rm || 0) - (pm.topByEx[a].e1rm || 0); }).slice(0, 6);
      return React.createElement("div", { key: pm.meso.id, style: { background: C.card, border: "1px solid " + C.bdr, borderRadius: 12, padding: 14, marginBottom: 10 } },
        React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 } },
          React.createElement("div", { style: { color: C.txt, fontSize: 13, fontWeight: 800 } }, pm.meso.name),
          React.createElement("div", { style: { color: C.mut, fontSize: 10 } }, (pm.meso.start_date || "?") + " → " + (pm.meso.end_date || "ongoing"))
        ),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 } },
          React.createElement("div", null, React.createElement("div", { style: { color: C.mut, fontSize: 9 } }, "Sessions"), React.createElement("div", { style: { color: C.txt, fontSize: 14, fontWeight: 700 } }, pm.sessions)),
          React.createElement("div", null, React.createElement("div", { style: { color: C.mut, fontSize: 9 } }, "Sets"), React.createElement("div", { style: { color: C.txt, fontSize: 14, fontWeight: 700 } }, pm.sets)),
          React.createElement("div", null, React.createElement("div", { style: { color: C.mut, fontSize: 9 } }, "Volume (lb·r)"), React.createElement("div", { style: { color: C.txt, fontSize: 14, fontWeight: 700 } }, (pm.totalVolume / 1000).toFixed(1) + "k"))
        ),
        pm.startBC && pm.endBC ? React.createElement("div", { style: { borderTop: "1px solid " + C.bdr, paddingTop: 8, marginTop: 4, marginBottom: 8 } },
          React.createElement("div", { style: { color: C.mut, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 } }, "Body Comp"),
          React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4 } },
            React.createElement("div", null, React.createElement("div", { style: { color: C.mut, fontSize: 9 } }, "Weight"), deltaCell(pm.endBC.weight, pm.startBC.weight, " lb", 1, "down")),
            React.createElement("div", null, React.createElement("div", { style: { color: C.mut, fontSize: 9 } }, "BF%"), deltaCell(pm.endBC.bf, pm.startBC.bf, "%", 1, "down")),
            React.createElement("div", null, React.createElement("div", { style: { color: C.mut, fontSize: 9 } }, "Lean"), deltaCell(pm.endBC.lean, pm.startBC.lean, " lb", 1, "up")),
            React.createElement("div", null, React.createElement("div", { style: { color: C.mut, fontSize: 9 } }, "Fat"), deltaCell(pm.endBC.fat, pm.startBC.fat, " lb", 1, "down"))
          )
        ) : null,
        topExNames.length ? React.createElement("div", { style: { borderTop: "1px solid " + C.bdr, paddingTop: 8 } },
          React.createElement("div", { style: { color: C.mut, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 } }, "Top Lifts (e1RM)"),
          topExNames.map(function(n) {
            var cur = pm.topByEx[n], prv = prevTopByEx[n];
            return React.createElement("div", { key: n, style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid " + C.bdr } },
              React.createElement("div", { style: { color: C.txt, flex: 1, marginRight: 8 } }, n),
              React.createElement("div", { style: { textAlign: "right" } },
                React.createElement("span", { style: { color: C.txt, fontWeight: 700 } }, cur.e1rm.toFixed(0) + " lb"),
                prv ? React.createElement("span", { style: { color: cur.e1rm >= prv.e1rm ? C.grn : C.red, fontSize: 10, marginLeft: 6 } }, fmtSignedNum(cur.e1rm - prv.e1rm, 0)) : null
              )
            );
          })
        ) : null
      );
    })
  );
}
function AnalyticsView() {
  var s1 = React.useState("body"); var sub = s1[0]; var setSub = s1[1];
  var TABS = [
    { k: "body", label: "Body", color: C.gld },
    { k: "perf", label: "Performance", color: C.blu },
    { k: "rec", label: "Recovery", color: C.grn },
    { k: "cmp", label: "Compare", color: C.pur }
  ];
  return React.createElement("div", { style: { padding: "10px 12px 40px" } },
    React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 12, position: "sticky", top: 0, background: C.bg, zIndex: 4, paddingBottom: 4 } },
      TABS.map(function(t) {
        var sel = sub === t.k;
        return React.createElement("button", { key: t.k, onClick: function() { setSub(t.k); }, style: { flex: 1, padding: "7px 4px", borderRadius: 8, border: "1px solid " + (sel ? t.color : C.bdr), background: sel ? t.color + "22" : "transparent", color: sel ? t.color : C.mut, fontSize: 11, fontWeight: 700, cursor: "pointer" } }, t.label);
      })
    ),
    sub === "body" ? React.createElement(BodyCompView, null) :
    sub === "perf" ? React.createElement(PerformanceView, null) :
    sub === "rec" ? React.createElement(RecoveryView, null) :
    React.createElement(CompareView, null)
  );
}
