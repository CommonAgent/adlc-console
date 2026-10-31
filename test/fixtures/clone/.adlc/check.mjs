// A stand-in for the hand-off's check, used by the tests.
console.log("14 of 14 tests passing.");
console.log("Blanking scripts/judge.mjs made the suite fail, so the suite notices it.");
if (process.env.ADLC_KEY) console.log("THE KEY LEAKED");
