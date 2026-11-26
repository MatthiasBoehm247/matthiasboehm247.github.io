// Shared Web Audio graph for audible playback and native OfflineAudioContext QA.
// No AudioContext is created or resumed here; the UI owns user activation/lifecycle.
const check = (condition, message) => {if (!condition) throw Error(message);};
const value = (n, label, min, max, whole = false) => {
  check(String(n ?? '').trim() !== '' && Number.isFinite(Number(n)) && Number(n) >= min && Number(n) <= max && (!whole || Number.isInteger(Number(n))), `${label}: Wert zwischen ${min} und ${max} erforderlich.`);
  return Number(n);
};
const roots = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const chords = {'Dur': [0, 4, 7], 'Moll': [0, 3, 7], 'vermindert': [0, 3, 6], 'Dur7': [0, 4, 7, 10], 'Moll7': [0, 3, 7, 10]};

function plan(kind, p) {
  const q = {...p}; let duration;
  if (kind === 'T095') {
    check(['sine', 'triangle', 'square', 'sawtooth'].includes(p.wave), 'Ungültige Wellenform.');
    q.freq = value(p.freq, 'Frequenz', 40, 1200); q.cutoff = value(p.cutoff, 'Filterfrequenz', 100, 6000);
    q.attack = value(p.attack, 'Attack', .005, 1); q.release = value(p.release, 'Release', .02, 2);
    duration = q.attack + .5 + q.release;
  } else if (kind === 'T096') {
    q.tempo = value(p.tempo, 'Tempo', 40, 200, true); q.swing = value(p.swing, 'Swing', 0, 40);
    q.sequence = String(p.pattern).trim().split(/\s+/);
    check(q.sequence.length === 16 && q.sequence.every(x => x === '-' || (/^\d+$/.test(x) && Number(x) >= 36 && Number(x) <= 84)), 'Genau 16 Schritte: MIDI-Noten 36–84 oder -.');
    duration = 60 / q.tempo / 4 * 16 + .2;
  } else if (kind === 'T097') {
    q.tempo = value(p.tempo, 'Tempo', 40, 200, true);
    check([p.kick, p.hat, p.snare].every(s => typeof s === 'string' && /^[01]{16}$/.test(s)), 'Jede Spur benötigt genau 16 Nullen/Einsen.');
    duration = 60 / q.tempo / 4 * 16 + .3;
  } else if (kind === 'T099') {
    check(roots.includes(p.root) && Object.hasOwn(chords, p.quality), 'Ungültiger Grundton oder Akkord.');
    duration = 1.1;
  } else if (kind === 'T100') {
    q.attack = value(p.attack, 'Attack', .005, 1); q.decay = value(p.decay, 'Decay', .005, 1);
    q.hold = value(p.hold, 'Haltezeit', .05, 2); q.release = value(p.release, 'Release', .02, 2);
    q.sustain = value(p.sustain, 'Sustain', 0, 100);
    duration = q.attack + q.decay + q.hold + q.release;
  } else throw Error('Unbekanntes Audiowerkzeug.');
  return {params: q, duration};
}

export function audioDuration(kind, params) {return plan(kind, params).duration;}

export function scheduleAudio(ctx, kind, params, {startTime = ctx.currentTime + .06, random = Math.random} = {}) {
  const {params: p, duration} = plan(kind, params);
  check(Number.isFinite(startTime) && startTime >= ctx.currentTime, 'Audiostart muss auf der aktuellen oder einer zukünftigen Audiozeit liegen.');
  check(typeof random === 'function', 'Ungültige Rauschquelle.');
  const master = ctx.createGain(); master.gain.value = .22; master.connect(ctx.destination);
  const base = startTime;
  function tone(freq, start, length, shape = 'sine', attack = .02, release = .08, cutoff = 8000, decay = 0, sustain = 1) {
    const o = ctx.createOscillator(), gain = ctx.createGain(), filter = ctx.createBiquadFilter();
    o.type = shape; o.frequency.value = freq; filter.type = 'lowpass'; filter.frequency.value = cutoff;
    const end = start + length + release;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(.6, start + attack);
    if (decay) gain.gain.linearRampToValueAtTime(.6 * sustain, start + attack + decay);
    gain.gain.setValueAtTime(.6 * sustain, start + length);
    gain.gain.linearRampToValueAtTime(0, end);
    o.connect(filter).connect(gain).connect(master); o.start(start); o.stop(end + .02);
  }
  function noise(start, length, filterType, frequency, amplitude) {
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * length), ctx.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {const r = random(); check(Number.isFinite(r) && r >= 0 && r < 1, 'Ungültiger Zufallswert.'); data[i] = (r * 2 - 1) * (1 - i / data.length);}
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = buffer; filter.type = filterType; filter.frequency.value = frequency; gain.gain.value = amplitude;
    source.connect(filter).connect(gain).connect(master); source.start(start);
  }
  if (kind === 'T095') tone(p.freq, base, p.attack + .5, p.wave, p.attack, p.release, p.cutoff);
  else if (kind === 'T096') {
    const step = 60 / p.tempo / 4;
    p.sequence.forEach((x, i) => {if (x !== '-') {const start = base + i * step + (i % 2 ? step * p.swing / 100 : 0); tone(440 * 2 ** ((Number(x) - 69) / 12), start, step * .55, 'triangle', .008, .06);}});
  } else if (kind === 'T097') {
    const step = 60 / p.tempo / 4;
    for (let i = 0; i < 16; i++) {
      const time = base + i * step;
      if (p.kick[i] === '1') {
        const o = ctx.createOscillator(), gain = ctx.createGain();
        o.frequency.setValueAtTime(125, time); o.frequency.exponentialRampToValueAtTime(42, time + .15);
        gain.gain.setValueAtTime(.85, time); gain.gain.exponentialRampToValueAtTime(.001, time + .25);
        // Finish at zero before stopping the oscillator to avoid a truncated tail.
        gain.gain.linearRampToValueAtTime(0, time + .26);
        o.connect(gain).connect(master); o.start(time); o.stop(time + .27);
      }
      if (p.hat[i] === '1') noise(time, .045, 'highpass', 6500, .22);
      if (p.snare[i] === '1') noise(time, .15, 'bandpass', 1800, .45);
    }
  } else if (kind === 'T099') {
    const root = roots.indexOf(p.root) + 60;
    chords[p.quality].forEach((x, i) => tone(440 * 2 ** ((root + x - 69) / 12), base + i * .018, .65, 'sine', .035, .25));
  } else if (kind === 'T100') tone(220, base, p.attack + p.decay + p.hold, 'triangle', p.attack, p.release, 6000, p.decay, p.sustain / 100);
  return {duration, master};
}
