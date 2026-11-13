/**
 * RiskMeter reports the user can order (column B of the RiskMeter workbook).
 *
 * `id` is sent to the report function and on to the scraper exactly as written, and
 * must match the list in the `nip_report_run` function.
 */
export const RISKMETER_REPORTS: Array<{ id: string; label: string }> = [
  "Crime Risk Score",
  "Fire Protection Class",
  "Flash Flood Risk Score",
  "Flood Risk Score",
  "Hail Probability",
  "Wind Probability",
  "Distance to Shore",
  "Wildfire Risk Score",
].map((name) => ({ id: name, label: name }));
