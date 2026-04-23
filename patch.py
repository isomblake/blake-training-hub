import re

src = open('src/App.jsx', encoding='utf-8').read()
assert 'AnalyticsView' not in src, 'File already patched! Run: git checkout -- src/App.jsx first'
print('Clean file:', len(src), 'chars')

AV = (
    'function AnalyticsView(){\n'
    '  var s2=React.useState([]);var readings=s2[0];var setReadings=s2[1];\n'
    '  var s3=React.useState(true);var loading=s3[0];var setLoading=s3[1];\n'
    '  React.useEffect(function(){\n'
    '    db.getBodyCompHistory(200).then(function(d){setReadings(d||[]);setLoading(false);}).catch(function(){setLoading(false);});\n'
    '  },[]);\n'
    '  if(loading)return React.createElement("div",{style:{padding:40,textAlign:"center",color:C.mut}},"Loading...");\n'
    '  var sorted=readings.slice().sort(function(a,b){return a.date<b.date?-1:1;});\n'
    '  var latest=sorted[sorted.length-1];\n'
    '  if(!latest)return React.createElement("div",{style:{padding:40,textAlign:"center",color:C.mut}},"No readings yet");\n'
    '  return React.createElement("div",{style:{padding:20}},\n'
    '    React.createElement("div",{style:{background:C.card,borderRadius:12,padding:16,border:"1px solid "+C.bdr,marginBottom:16}},\n'
    '      React.createElement("div",{style:{color:C.mut,fontSize:11,textTransform:"uppercase",letterSpacing:1}},"Latest - "+latest.date),\n'
    '      React.createElement("div",{style:{color:C.txt,fontSize:36,fontWeight:700}},latest.weight_lbs+""),\n'
    '      React.createElement("div",{style:{color:C.mut,fontSize:13}},"lbs"+(latest.body_fat_pct?" | "+latest.body_fat_pct+"% BF":"")),\n'
    '      latest.lean_mass_lbs and React.createElement("div",{style:{color:C.mut,fontSize:12,marginTop:4}},latest.lean_mass_lbs+" lean / "+latest.fat_mass_lbs+" fat") or None\n'
    '    ),\n'
    '    React.createElement("div",{style:{color:C.mut,fontSize:12,fontWeight:600,textTransform:"uppercase",letterSpacing:1,marginBottom:8}},"All Readings ("+readings.length+")"),\n'
    '    sorted.slice().reverse().map(function(r,i){\n'
    '      return React.createElement("div",{key:i,style:{display:"flex",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid "+C.bdr}},\n'
    '        React.createElement("div",null,\n'
    '          React.createElement("div",{style:{color:C.txt,fontSize:14,fontWeight:600}},r.date),\n'
    '          r.body_fat_pct&&React.createElement("div",{style:{color:C.mut,fontSize:12}},r.body_fat_pct+"% BF")\n'
    '        ),\n'
    '        React.createElement("div",{style:{color:C.txt,fontSize:16,fontWeight:700}},r.weight_lbs+"")\n'
    '      );\n'
    '    })\n'
    '  );\n'
    '}\n'
)

# 1. Insert AnalyticsView before function App() {
anchor = '\nfunction App() {'
i = src.index(anchor)
src = src[:i] + '\n' + AV + src[i:]
print('Component inserted at char', i)

# 2. Add Analytics tab button after History button
h = src.index('setView("history")')
e = src.index('</button>', h) + 9
BTN = '<button onClick={() => setView("analytics")} style={{ flex: 1, padding: "6px", borderRadius: 8, border: "1px solid " + C.bdr, color: C.mut, fontSize: 11, fontWeight: 700, cursor: "pointer", background: "transparent" }}>Analytics</button>'
src = src[:e] + BTN + src[e:]
print('Tab button inserted at char', e)

# 3. Add Analytics render block after HistoryView
hv = src.index('<HistoryView')
hv_close = src.index('/>', hv) + 2
div_close = src.index('</div>', hv_close) + 6
RENDER = '<div style={{ display: view === "analytics" ? "block" : "none" }}><AnalyticsView /></div>'
src = src[:div_close] + RENDER + src[div_close:]
print('Render block inserted at char', div_close)

open('src/App.jsx', 'w', encoding='utf-8').write(src)

assert src.count('function AnalyticsView') == 1
assert 'setView("analytics")' in src
assert '<AnalyticsView />' in src
print('ALL CHECKS PASSED. Length:', len(src))
