// Throwable error that the global error handler in app.js turns into a clean
// JSON response. Useful for aborting a prisma.$transaction() with a 4xx so the
// whole transaction rolls back.
class HttpError extends Error {
    constructor(status, message, code = null) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
        this.code = code;
    }
}

module.exports = HttpError;
