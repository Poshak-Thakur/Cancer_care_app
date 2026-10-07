/**
 * Calculates the UTC Start and End of a given day based on India Standard Time (IST).
 * Prisma stores timestamps in UTC. This ensures queries align with the Indian midnight.
 */
exports.getISTDayBoundaries = (dateInput = new Date()) => {
    const dateObj = new Date(dateInput);

    // Format to IST string, then parse as local to strip origin timezone context
    const istString = dateObj.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const localISTDate = new Date(istString);
    
    // Set to midnight IST
    localISTDate.setHours(0, 0, 0, 0);
    
    // IST is UTC +5:30. To get the UTC equivalent of IST midnight:
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    
    const startOfDayUTC = new Date(localISTDate.getTime() - istOffsetMs);
    const endOfDayUTC = new Date(startOfDayUTC.getTime() + (24 * 60 * 60 * 1000) - 1);

    return { startOfDay: startOfDayUTC, endOfDay: endOfDayUTC };
};