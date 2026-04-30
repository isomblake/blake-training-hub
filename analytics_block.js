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
