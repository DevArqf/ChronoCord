function formatTimeZone(date, timeZone) {
  return new Date(date).toLocaleString('en-US', { timeZone });
}