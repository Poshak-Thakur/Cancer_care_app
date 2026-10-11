/**
 * IST day boundaries must not depend on the SERVER's timezone.
 * Each case runs in separate Node processes with different TZ values and compares the output.
 * Runs with:  node --test tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HELPER = path.join(__dirname, '..', 'src', 'utils', 'timezoneHelper.js');
const SCRIPT = `
const { getISTDayBoundaries } = require(process.argv[1]);
const out = JSON.parse(process.argv[2]).map((i) => { const r = getISTDayBoundaries(i); return [r.startOfDay.toISOString(), r.endOfDay.toISOString()]; });
process.stdout.write(JSON.stringify(out));
`;
const boundariesIn = (tz, instants) => JSON.parse(execFileSync(process.execPath, ['-e', SCRIPT, HELPER, JSON.stringify(instants)], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }));

// 2026-10-10T18:30:00Z is exactly midnight IST on 11 Oct.
const INSTANTS = [
    '2026-10-10T18:29:59.999Z',   // last millisecond of 10 Oct IST
    '2026-10-10T18:30:00.000Z',   // first millisecond of 11 Oct IST
    '2026-10-11T05:57:00.000Z',   // mid-day IST
    '2026-12-31T18:30:00.000Z',   // year rollover in IST
    '2026-03-29T00:30:00.000Z'    // a DST-changeover date in many Western zones
];

test('TZ1. identical IST day boundaries on UTC, Asia/Kolkata and a DST zone server', () => {
    const utc = boundariesIn('UTC', INSTANTS);
    assert.deepEqual(boundariesIn('Asia/Kolkata', INSTANTS), utc);
    assert.deepEqual(boundariesIn('America/Los_Angeles', INSTANTS), utc);
    assert.deepEqual(boundariesIn('Pacific/Kiritimati', INSTANTS), utc);
});

test('TZ2. boundaries are exactly IST midnight to IST midnight - 1ms, either side of midnight', () => {
    const [before, after, midday, newYear] = boundariesIn('UTC', INSTANTS);
    assert.deepEqual(before, ['2026-10-09T18:30:00.000Z', '2026-10-10T18:29:59.999Z']);
    assert.deepEqual(after, ['2026-10-10T18:30:00.000Z', '2026-10-11T18:29:59.999Z']);
    assert.deepEqual(midday, after);
    assert.deepEqual(newYear, ['2026-12-31T18:30:00.000Z', '2027-01-01T18:29:59.999Z']);
});

test('TZ3. invalid input throws instead of returning NaN boundaries', () => {
    const { getISTDayBoundaries } = require(HELPER);
    assert.throws(() => getISTDayBoundaries('not a date'), TypeError);
});
