/** Remove the retired browser-statistics preference/UUID without reading it. */
export function clearRetiredBrowserStatistics() {
  try { localStorage.removeItem('betterilias_browser_statistics'); }
  catch { /* Restricted storage must not prevent normal app startup. */ }
}
