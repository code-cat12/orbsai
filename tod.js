// Time-of-day sky: the animated background follows the clock on your device.
// Palettes blend smoothly between keyframes and line up with the Home greeting buckets:
//   night (before 5) -> dawn (5-8, peach/pink/lavender) -> day (8-17, sky blue/teal/soft violet)
//   -> golden hour (17-19, amber/coral/magenta) -> evening/night (from 19, deep indigo/violet/midnight blue).
// Runs as a plain script in <head> so the first paint already has the right sky. Rechecks every minute.
(function(){
  var P = {
    night:  { sky1:"#0c0a24", sky2:"#191345", b1:"#3d2c97", b2:"#6c40cc", b3:"#1c2e7a", b4:"#9a4fd2", b5:"#2b6db4", dark:1 },
    dawn:   { sky1:"#fde6dc", sky2:"#eee0f7", b1:"#ffb088", b2:"#ff8db8", b3:"#c6a6f2", b4:"#ffd0a6", b5:"#b5aef6", dark:0 },
    day:    { sky1:"#dff0ff", sky2:"#eceffc", b1:"#6cc2ff", b2:"#4ed5c6", b3:"#a797ff", b4:"#8edfff", b5:"#c0b2ff", dark:0 },
    golden: { sky1:"#ffe6cc", sky2:"#fbdbe2", b1:"#ffb244", b2:"#ff7862", b3:"#e64f9d", b4:"#ffcd78", b5:"#c26ae0", dark:0 },
    // In-between skies so the blends glow instead of going muddy grey
    dusk:    { sky1:"#3a1f5c", sky2:"#5a2a62", b1:"#ff7a59", b2:"#c4489c", b3:"#5b3bb8", b4:"#ff9e5e", b5:"#7a46c9", dark:.6 },
    predawn: { sky1:"#2c2150", sky2:"#5b3d6e", b1:"#ff9a7a", b2:"#c86aa8", b3:"#6a58c4", b4:"#ffb48a", b5:"#8b7be0", dark:.6 }
  };
  // [hour, palette]: holds between equal neighbours, blends between different ones.
  var STOPS = [[0,"night"],[4.5,"night"],[5,"predawn"],[5.75,"dawn"],[7.5,"dawn"],[8.5,"day"],[16.5,"day"],[17.25,"golden"],[18.4,"golden"],[19,"dusk"],[19.75,"night"],[24,"night"]];
  var KEYS = ["sky1","sky2","b1","b2","b3","b4","b5"];
  function hex(h){ return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; }
  function mix(a, b, t){ var x = hex(a), y = hex(b), o = "#"; for (var i = 0; i < 3; i++){ var v = Math.round(x[i] + (y[i] - x[i]) * t); o += (v < 16 ? "0" : "") + v.toString(16); } return o; }
  function ease(t){ return t * t * (3 - 2 * t); }
  function at(hours){
    for (var i = 0; i < STOPS.length - 1; i++){
      var s = STOPS[i], e = STOPS[i + 1];
      if (hours >= s[0] && hours <= e[0]){
        var t = e[0] === s[0] ? 0 : ease((hours - s[0]) / (e[0] - s[0]));
        var A = P[s[1]], B = P[e[1]], out = { phase: (t < .5 ? s[1] : e[1]).replace("predawn", "dawn").replace("dusk", "night"), dark: A.dark + (B.dark - A.dark) * t };
        for (var k = 0; k < KEYS.length; k++) out[KEYS[k]] = mix(A[KEYS[k]], B[KEYS[k]], t);
        return out;
      }
    }
    return Object.assign({ phase:"night" }, P.night);
  }
  var last = "";
  function apply(){
    var d = new Date(), h = d.getHours() + d.getMinutes() / 60;
    var p = at(h), root = document.documentElement, sig = KEYS.map(function(k){ return p[k]; }).join() + p.dark;
    if (sig === last) return; last = sig;
    for (var k = 0; k < KEYS.length; k++) root.style.setProperty("--" + KEYS[k], p[KEYS[k]]);
    root.dataset.tod = p.phase;                       // dawn | day | golden | night
    root.dataset.sky = p.dark >= .35 ? "dark" : "light"; // which glass + text colors keep things readable
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = p.sky1;
    window.__orbsSky = p;
    try { window.dispatchEvent(new CustomEvent("orbs:sky", { detail: p })); } catch(e) {}
  }
  apply();
  setInterval(apply, 60000);
  document.addEventListener("visibilitychange", function(){ if (!document.hidden) apply(); });
  window.__orbsSkyAt = at;
})();
