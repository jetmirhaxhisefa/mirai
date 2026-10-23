// The candidate within edit distance 2 of `name`, if exactly one is closest; otherwise null.
// Used for "did you mean" hints (commands, config keys).
export function closest(name, candidates) {
  let best = null;
  let bestDist = 3;
  let tie = false;
  for (const candidate of candidates) {
    const d = distance(name, candidate);
    if (d < bestDist) {
      best = candidate;
      bestDist = d;
      tie = false;
    } else if (d === bestDist) {
      tie = true;
    }
  }
  return tie ? null : best;
}

function distance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}
