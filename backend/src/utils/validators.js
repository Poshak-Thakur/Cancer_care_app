const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Prisma throws (-> HTTP 500) on malformed UUIDs, so every id coming from the
// outside world is checked with this before it reaches a query.
exports.isUuid = (value) => typeof value === 'string' && UUID_REGEX.test(value);

exports.isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
