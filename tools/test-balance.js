// Sanity-check the cost-meter severity logic against realistic scenarios.
// Run: node tools/test-balance.js
const LOW_HOURS = 8, CRITICAL_HOURS = 3, LOW_DOLLARS = 10, CRITICAL_DOLLARS = 3;

// Mirrors renderBalance(): severity is the WORSE of the time and money signals.
function level(balance, spendPerHr) {
  const hours = spendPerHr > 0 ? balance / spendPerHr : Infinity;
  const rank = { ok: 0, low: 1, critical: 2 };

  let byMoney = 'ok';
  if (balance <= CRITICAL_DOLLARS) byMoney = 'critical';
  else if (balance <= LOW_DOLLARS) byMoney = 'low';

  let byTime = 'ok';
  if (spendPerHr > 0) {
    if (hours <= CRITICAL_HOURS) byTime = 'critical';
    else if (hours <= LOW_HOURS) byTime = 'low';
  }
  return rank[byTime] >= rank[byMoney] ? byTime : byMoney;
}

const cases = [
  [42.18, 0.44, 'ok'],        // healthy, pod running
  [100, 0, 'ok'],             // healthy, idle
  [2.0, 0.44, 'critical'],    // 4.5h left BUT only $2 -> money floor wins
  [0.80, 0.44, 'critical'],   // <2h left
  [8, 0.44, 'low'],           // $8 idle-ish burn -> low on money
  [8, 0, 'low'],              // idle, low dollars
  [2, 0, 'critical'],         // idle, critical dollars
  [50, 2.99, 'ok'],           // H100 burning, still ~16h
  [10, 2.99, 'low'],          // ~3.3h left
  [4, 2.99, 'critical'],      // ~1.3h left
  [30, 12.0, 'critical'],     // huge burn, 2.5h -> time signal catches it
];

let pass = 0, fail = 0;
for (const [bal, rate, expected] of cases) {
  const got = level(bal, rate);
  const hrs = rate > 0 ? (bal / rate).toFixed(1) + 'h' : 'idle';
  if (expected === null) {
    console.log(`  info  $${bal} @ $${rate}/hr (${hrs}) -> ${got}`);
    continue;
  }
  if (got === expected) { pass++; console.log(`  PASS  $${bal} @ $${rate}/hr (${hrs}) -> ${got}`); }
  else { fail++; console.log(`  FAIL  $${bal} @ $${rate}/hr (${hrs}) -> ${got}, expected ${expected}`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
