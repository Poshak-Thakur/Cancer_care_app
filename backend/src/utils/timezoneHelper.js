/**
 * Calculates the UTC Start and End of a given day based on India Standard Time (IST).
 * Prisma stores timestamps in UTC. This ensures queries align with the Indian midnight.
 */
exports.getISTDayBoundaries = (dateInput = new Date()) => {
    const instant = new Date(dateInput);
    if (Number.isNaN(instant.getTime())) throw new TypeError('Invalid date input.');

    // Calendar date in Asia/Kolkata, read field-by-field (no re-parsing of a formatted string, which
    // would use the SERVER's local timezone and give different boundaries on UTC vs IST machines).
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(instant);
    const dp = Object.fromEntries(parts.map(({ type, value }) => [type, value]));

    return exports.getISTDayRangeFromDateString(`${dp.year}-${dp.month}-${dp.day}`);
};

/**
 * Inclusive UTC range of ONE IST calendar day given as a strict 'YYYY-MM-DD' string.
 * Pure arithmetic on the string (no Date parsing in the server's local timezone), so the result
 * is identical on a UTC server and on a developer laptop set to IST.
 * Returns { startOfDay, endOfDay } or null when the string is not a real calendar date.
 */
exports.getISTDayRangeFromDateString = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [y, m, d] = value.split('-').map(Number);
    const utcMidnight = Date.UTC(y, m - 1, d);
    const check = new Date(utcMidnight);
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const startOfDay = new Date(utcMidnight - istOffsetMs);
    return { startOfDay, endOfDay: new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1) };
};
