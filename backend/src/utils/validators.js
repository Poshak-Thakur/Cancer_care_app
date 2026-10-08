const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Prisma throws (-> HTTP 500) on malformed UUIDs, so every id coming from the
// outside world is checked with this before it reaches a query.
exports.isUuid = (value) => typeof value === 'string' && UUID_REGEX.test(value);

exports.isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

// relationship_label is VARCHAR(100) in the schema. Over-long input is rejected, never
// silently truncated. Returns { value } or { error }.
exports.MAX_LABEL_LENGTH = 100;
exports.normalizeLabel = (raw, fallback) => {
    if (raw === undefined || raw === null) return { value: fallback };
    if (typeof raw !== 'string') return { error: 'relationship_label must be a string.' };
    const trimmed = raw.trim();
    if (trimmed === '') return { value: fallback };
    if (trimmed.length > exports.MAX_LABEL_LENGTH) {
        return { error: `relationship_label must be at most ${exports.MAX_LABEL_LENGTH} characters.` };
    }
    return { value: trimmed };
};
