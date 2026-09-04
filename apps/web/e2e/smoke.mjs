/**
 * End-to-end smoke test against the production build (vite preview).
 * Run: pnpm --filter @deriva/web run test:e2e   (requires `vite build` first)
 * Uses the system Chromium when PLAYWRIGHT_CHROMIUM_PATH is set (CI installs one via `playwright install`).
 * Port: E2E_PORT or a random port in 4180–4279.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, "..");
const outDir = join(webDir, "e2e-screenshots");
mkdirSync(outDir, { recursive: true });
const port = Number(process.env.E2E_PORT) || 4180 + Math.floor(Math.random() * 100);

const preview = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], { cwd: webDir, stdio: "ignore" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
const failures = [];
let checks = 0;
const check = (cond, msg) => {
  checks++;
  if (!cond) failures.push(msg);
};
const VIEWS = [
  ["b", "Blotter"],
  ["p", "Pricing"],
  ["c", "Kurven"],
  ["s", "Szenarien"],
  ["m", "Markt"],
  ["r", "Report"],
  ["v", "Vergleich"],
  ["h", "Hedge Accounting"],
];
const chord = async (page, k) => {
  await page.keyboard.press("g");
  await page.keyboard.press(k);
  await wait(400);
};
/** Document / report chords ("o t" termsheet, "o r" report …) – the former Ctrl+Shift combos are browser-reserved (R3-01). */
const chordO = async (page, k) => {
  await page.keyboard.press("o");
  await page.keyboard.press(k);
  await wait(500);
};
const themeOf = (page) => page.evaluate(() => document.documentElement.dataset.theme);
const noOverflow = async (page) =>
  page.evaluate(() => {
    const main = document.querySelector(".main");
    return { page: document.documentElement.scrollWidth <= window.innerWidth, main: main ? main.scrollWidth <= main.clientWidth + 1 : true };
  });
const crumb = (page) => page.locator(".topbar .crumb").innerText();

try {
  await wait(2500);
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
  browser = await chromium.launch(executablePath ? { executablePath } : {});
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    locale: "de-DE",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const errors = [];
  const consoleErrors = [];
  const failedRequests = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") consoleErrors.push(m.text());
  });
  page.on("requestfailed", (r) => failedRequests.push(r.url()));
  await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });

  // Blotter renders portfolio, no external font requests, favicon present
  check((await page.locator("table.grid-table tbody tr").count()) >= 10, "blotter rows");
  check((await page.locator('[data-testid="onboarding"]').count()) === 1, "onboarding hint on first launch");
  const onboardingText = await page.locator('[data-testid="onboarding"]').innerText();
  check(onboardingText.includes("15.03.2027") && !/\d{4}-\d{2}-\d{2}/.test(onboardingText), "onboarding examples use German dates (R5-09)");
  check((await page.locator("h1").innerText()) === "DERIVA", "h1 title");
  check((await page.locator('link[rel="icon"]').count()) === 1, "favicon link present");
  check(!failedRequests.some((u) => u.includes("fonts.googleapis")), "no external font requests");
  check((await page.locator("th[aria-sort]").count()) >= 5, "sortable headers carry aria-sort");
  check((await page.locator('.seg button[aria-pressed="true"]').count()) >= 1, "segment buttons carry aria-pressed");
  check((await page.locator('a.skip[href="#main"]').count()) === 1, "skip link present (N-13)");
  check((await page.locator('table.blotter[role="grid"] tr[data-nav="trade"]').count()) >= 10, "blotter rows marked data-nav=trade in a grid (N-02/N-13)");
  await page.screenshot({ path: join(outDir, "01-blotter.png") });
  // Heading hierarchy: one h1, the view title is the h2 (R4-10)
  check((await page.locator("h1").count()) === 1, "exactly one h1 (R4-10)");
  check((await page.locator("h2.crumb").innerText()).includes("Blotter"), "view title is an h2 (R4-10)");
  // Roving tabindex: one tab stop per table, Tab leaves the table (R4-03)
  const blotterStops = await page.evaluate(() => ({
    zero: document.querySelectorAll('table.blotter tbody tr[tabindex="0"]').length,
    minus: document.querySelectorAll('table.blotter tbody tr[tabindex="-1"]').length,
  }));
  check(
    blotterStops.zero === 1 && blotterStops.minus >= 9,
    `blotter has exactly one row tab stop (${blotterStops.zero} / ${blotterStops.minus} rows at -1) (R4-03)`,
  );
  await page.locator("table.blotter tbody tr.selected").focus();
  await page.keyboard.press("Tab");
  check((await page.evaluate(() => document.activeElement?.tagName)) !== "TR", "Tab leaves the blotter after one stop (R4-03)");
  // Row checkboxes are no tab stops; the selected row is reached within 30 Tabs from the skip link (R5-02)
  const cellStops = await page.evaluate(() => document.querySelectorAll('table.blotter tbody input.compare-check:not([tabindex="-1"])').length);
  check(cellStops === 0, `compare checkboxes are not tab stops (${cellStops}) (R5-02)`);
  await page.locator("a.skip").focus();
  let tabsToRow = 0;
  for (; tabsToRow < 60; tabsToRow++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.activeElement?.tagName === "TR" && document.activeElement.closest("table.blotter") !== null)) break;
  }
  // 49 Tabs in R5 (13 checkbox stops + 8 header stops); now ≤ 35 including the four onboarding chips of the first launch
  check(tabsToRow + 1 <= 35, `selected blotter row reached after ${tabsToRow + 1} Tabs (R5-02)`);
  await page.keyboard.press("Space");
  await wait(150);
  check((await page.locator(".compare-check:checked").count()) === 1, "Space on the focused row marks it for comparison (R5-02)");
  await page.keyboard.press("Space");
  await wait(150);
  // sortable headers: one tab stop, ←/→ move along the columns, Enter sorts
  const headerStops = await page.evaluate(() => document.querySelectorAll('table.blotter thead .th-btn:not([tabindex="-1"])').length);
  check(headerStops === 1, `blotter header row is one tab stop (${headerStops}) (R5-02)`);
  await page.locator('table.blotter thead .th-btn[tabindex="0"]').focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const hdrFocus = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  check(/Kontrahent|Name|Typ/.test(hdrFocus), `arrow keys move between column headers (${hdrFocus}) (R5-02)`);
  await page.keyboard.press("Home");
  // Chords take precedence on a focused row (R4-02): y i copies the indication, i does not toggle the inspector, y y copies the row
  await page.locator("table.blotter tbody tr.selected").focus();
  const inspBefore = await page.locator(".inspector").count();
  await page.keyboard.press("y");
  await page.keyboard.press("i");
  await wait(400);
  const clipInd = await page.evaluate(() => navigator.clipboard.readText());
  check(clipInd.includes("PV") && !clipInd.includes("\t"), `y i on a blotter row copies the indication (${clipInd.slice(0, 40)}…) (R4-02)`);
  check((await page.locator(".inspector").count()) === inspBefore, "i after y does not toggle the inspector (R4-02)");
  await page.keyboard.press("y");
  await page.keyboard.press("y");
  await wait(400);
  const clipRow = await page.evaluate(() => navigator.clipboard.readText());
  check(clipRow.includes("IRS-0001") && clipRow.includes("\t"), "y y copies the focused row as tab-separated text (R4-02)");
  check((await page.locator(".toast", { hasText: "Zeile kopiert" }).count()) === 1, "row copy toast");

  // Grouping with subtotals (Markt N19)
  await page.locator('[data-testid="group-select"]').selectOption("cpty");
  await wait(200);
  const subtotals = await page.locator('[data-testid="group-subtotal"]').count();
  check(subtotals >= 3, `grouping by counterparty adds subtotal rows (${subtotals})`);
  check((await page.locator('[data-testid="group-subtotal"]').first().innerText()).startsWith("Σ"), "subtotal row shows Σ label");
  await page.locator('[data-testid="group-select"]').selectOption("book");
  await wait(200);
  check((await page.locator('[data-testid="group-subtotal"]').count()) >= 3, "grouping by book works");
  await page.locator('[data-testid="group-select"]').selectOption("none");
  await wait(200);
  check((await page.locator('[data-testid="group-subtotal"]').count()) === 0, "no subtotals without grouping");

  // CSV import with column mapping template (Markt N16) → duplicate strategy dialog not needed for fresh ids
  const csvPath = join(tmpdir(), `deriva-e2e-${port}.csv`);
  writeFileSync(
    csvPath,
    "\uFEFFtype;id;name;counterparty;book;currency;notional;direction;rate;start;maturity;index\r\nIRS;IRS-CSV-1;CSV Payer;Sparkasse Test;Treasury;EUR;7500000;Pay;2,9 %;2026-09-07;7Y;EURIBOR-6M\r\nFXF;FXF-CSV-1;CSV Forward;Sparkasse Test;Einkauf;;;;;;;\r\n",
    "utf8",
  );
  const tradesBefore = Number((await page.locator(".statusbar").innerText()).match(/(\d+) Trades/)?.[1]);
  // Export menu is a popover layer (R3-02): background hotkeys suspended, Esc closes from anywhere, focus returns to the toggle
  const themeBefore = await themeOf(page);
  await page.locator('[data-testid="export-menu-btn"]').click();
  await wait(150);
  check((await page.locator('[role="menu"][aria-label="Export und Import"] [role="menuitem"]').count()) >= 5, "export menu lists export/import entries (N-12)");
  check((await page.locator('[data-testid="csv-template-swpt"]').count()) === 1, "CSV templates include Swaption (N16)");
  check((await page.locator('[data-testid="csv-template-ccs"]').count()) === 1, "CSV templates include CCS (N16)");
  await page.keyboard.press("t");
  await wait(150);
  check((await themeOf(page)) === themeBefore, "background hotkey t is suspended while the export menu is open (R3-02)");
  await page.keyboard.press("Escape");
  await wait(300);
  check((await page.locator('[role="menu"][aria-label="Export und Import"]').count()) === 0, "Esc closes the export menu (R3-02)");
  check(
    (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "export-menu-btn",
    "export menu returns focus to its toggle (R3-02)",
  );
  await page.locator('[data-testid="export-menu-btn"]').click();
  await wait(150);
  await page.locator('[data-testid="import-csv"]').setInputFiles(csvPath);
  await wait(800);
  // rejected rows are listed in a dialog (R3-F7); the valid rows are imported after "weiter"
  check((await page.locator('[data-testid="csv-errors"]').count()) === 1, "CSV import lists rejected rows in a dialog (R3-F7)");
  check((await page.locator('[data-testid="csv-errors-table"] tbody tr').count()) === 1, "error dialog lists the rejected FXF row");
  check((await page.locator('[data-testid="csv-errors-table"]').innerText()).includes("Kauf-/Verkaufswährung fehlt"), "error dialog names the reason");
  await page.locator('[data-testid="csv-errors-continue"]').click();
  await wait(800);
  const tradesAfterCsv = Number((await page.locator(".statusbar").innerText()).match(/(\d+) Trades/)?.[1]);
  check(tradesAfterCsv === tradesBefore + 1, `CSV import adds the valid IRS row (${tradesBefore} → ${tradesAfterCsv})`);
  check((await page.locator(".toast", { hasText: "CSV" }).count()) >= 1, "CSV import toast");
  check((await page.locator("td.id-cell", { hasText: "IRS-CSV-1" }).count()) === 1, "imported CSV trade visible in blotter");
  // re-import the same file → duplicate dialog with three strategies (N-24)
  await page.locator('[data-testid="export-menu-btn"]').click();
  await wait(150);
  await page.locator('[data-testid="import-csv"]').setInputFiles(csvPath);
  await wait(600);
  await page.locator('[data-testid="csv-errors-continue"]').click();
  await wait(600);
  check((await page.locator('[data-testid="import-strategy"]').count()) === 1, "duplicate ids open the import strategy dialog");
  await page.locator('[data-testid="import-skip"]').click();
  await wait(500);
  check(Number((await page.locator(".statusbar").innerText()).match(/(\d+) Trades/)?.[1]) === tradesAfterCsv, "skip strategy keeps the trade count");
  // R10-F2: the API IRS row with `tenor` (alias of `maturity`) and without a type column imports from its column set
  const csvTenor = join(tmpdir(), `deriva-e2e-tenor-${port}.csv`);
  writeFileSync(
    csvTenor,
    "id;currency;notional;payReceive;fixedRate;effectiveDate;tenor;index\nIRS-API-T1;EUR;10000000;Pay;3,1 %;2026-09-07;10Y;EURIBOR-6M\n",
    "utf8",
  );
  await page.locator('[data-testid="export-menu-btn"]').click();
  await wait(150);
  await page.locator('[data-testid="import-csv"]').setInputFiles(csvTenor);
  await wait(800);
  check(
    (await page.locator('[data-testid="csv-errors"]').count()) === 0 && (await page.locator("td.id-cell", { hasText: "IRS-API-T1" }).count()) === 1,
    "API IRS row with tenor instead of maturity imports without a row error (R10-F2)",
  );
  check(
    (await page.locator(".toast", { hasText: "aus CSV (Typ IRS aus dem Spaltensatz) importiert" }).count()) === 1,
    "the import toast names the column set as the type source (R10-F2 / Markt R9-4)",
  );
  // R10-F3: IRS rows in „kredit-cap-2026.csv“ – the column signature beats the bare file-name token
  const csvMisnamed = join(tmpdir(), `kredit-cap-2026.csv`);
  writeFileSync(
    csvMisnamed,
    "id;currency;notional;direction;rate;start;maturity;index\nIRS-KREDIT-E2E;EUR;10000000;Pay;3 %;2026-09-07;10Y;EURIBOR-6M\n",
    "utf8",
  );
  await page.locator('[data-testid="export-menu-btn"]').click();
  await wait(150);
  await page.locator('[data-testid="import-csv"]').setInputFiles(csvMisnamed);
  await wait(800);
  check(
    (await page.locator('[data-testid="csv-errors"]').count()) === 0 && (await page.locator("td.id-cell", { hasText: "IRS-KREDIT-E2E" }).count()) === 1,
    "IRS rows in kredit-cap-2026.csv are read as IRS from the column set, not as CAP from the file name (R10-F3)",
  );
  // R10-F3: a misleading template name is authoritative – the error dialog offers the type dialog instead of a dead end
  const csvWrongTemplate = join(tmpdir(), `deriva-import-vorlage-cap.csv`);
  writeFileSync(
    csvWrongTemplate,
    "id;currency;notional;direction;rate;start;maturity;index\nIRS-RETYPE-E2E;EUR;10000000;Pay;3 %;2026-09-07;10Y;EURIBOR-6M\n",
    "utf8",
  );
  await page.locator('[data-testid="export-menu-btn"]').click();
  await wait(150);
  await page.locator('[data-testid="import-csv"]').setInputFiles(csvWrongTemplate);
  await wait(800);
  check(
    (await page.locator('[data-testid="csv-errors"]').count()) === 1 && (await page.locator('[data-testid="csv-errors-retype"]').count()) === 1,
    "a wrong derived type lands in the error dialog with „Anderen Produkttyp wählen …“ (R10-F3)",
  );
  await page.locator('[data-testid="csv-errors-retype"]').click();
  await wait(300);
  check(
    /als CAP aus dem Dateinamen gelesen/.test(await page.locator('[data-testid="csv-type-dialog"]').innerText()),
    "the type dialog names the derived type (R10-F3)",
  );
  await page.locator('[data-testid="csv-type-select"]').selectOption("IRS");
  await page.locator('[data-testid="csv-type-continue"]').click();
  await wait(800);
  check(
    (await page.locator("td.id-cell", { hasText: "IRS-RETYPE-E2E" }).count()) === 1 && (await page.locator('[data-testid="csv-errors"]').count()) === 0,
    "the chosen type re-reads the file and imports the rows (R10-F3)",
  );
  // Impossible dates are row errors, never silent defaults (R5-F1)
  const csvDates = join(tmpdir(), `deriva-e2e-dates-${port}.csv`);
  writeFileSync(
    csvDates,
    "\uFEFFtype;id;name;currency;notional;direction;rate;start;maturity;index\r\nIRS;IRS-D1;Datum 31.02.;EUR;5000000;Pay;3,0 %;31.02.2026;7Y;EURIBOR-6M\r\nIRS;IRS-D2;Datum ISO 30.02.;EUR;5000000;Pay;3,0 %;2026-02-30;7Y;EURIBOR-6M\r\nIRS;IRS-D3;gültig;EUR;5000000;Pay;3,0 %;15.03.2027;7Y;EURIBOR-6M\r\nIRS;IRS-D4;Ende vor Start;EUR;5000000;Pay;3,0 %;15.03.2027;2026-12-01;EURIBOR-6M\r\n",
    "utf8",
  );
  await page.locator('[data-testid="export-menu-btn"]').click();
  await wait(150);
  await page.locator('[data-testid="import-csv"]').setInputFiles(csvDates);
  await wait(800);
  check(
    (await page.locator('[data-testid="csv-errors-table"] tbody tr').count()) === 3,
    "impossible dates and the validation failure are listed as row errors (R5-F1 / R6-06)",
  );
  const dateErrs = await page.locator('[data-testid="csv-errors-table"]').innerText();
  check(
    /Ungültiges Datum „31\.02\.2026“ in Spalte „start“/.test(dateErrs) && dateErrs.includes("2026-02-30"),
    "date row errors name value, column and format (R5-F1)",
  );
  check(dateErrs.includes("Enddatum muss nach dem Startdatum liegen"), "a row failing trade validation (end before start) is listed in the dialog (R6-06)");
  check(
    (await page.locator('[data-testid="csv-errors-continue"]').innerText()).includes("1 gültige"),
    "only the valid row is offered for import (R5-F1 / R6-06)",
  );
  await page.locator('[data-testid="csv-errors-continue"]').click();
  await wait(800);
  const csvToasts = await page.locator(".toast").allInnerTexts();
  check(
    csvToasts.some((t) => /^1 Trades aus CSV importiert/.test(t) && !/ungültig/.test(t)),
    `import toast count equals the dialog count – no 'ungültig' surprise (${csvToasts.join(" | ")}) (R6-06)`,
  );
  check(
    (await page.locator("td.id-cell", { hasText: "IRS-D3" }).count()) === 1 && (await page.locator("td.id-cell", { hasText: "IRS-D1" }).count()) === 0,
    "valid row imported, impossible-date rows not (R5-F1)",
  );

  // Compare: Space marks trades, g v opens the compare view
  await page.locator("td.id-cell", { hasText: "IRS-0001" }).click();
  await page.keyboard.press("Space");
  await page.keyboard.press("j");
  await page.keyboard.press("Space");
  await wait(200);
  check((await page.locator(".compare-check:checked").count()) === 2, "space marks two trades for comparison");
  await chord(page, "v");
  check((await crumb(page)).includes("Vergleich"), "g v → compare view");
  check((await page.locator('[data-testid="compare-table"]').count()) === 1, "compare table renders");
  check((await page.locator('[data-testid="compare-table"] thead th').count()) === 3, "compare table has two trade columns");
  await page.screenshot({ path: join(outDir, "view-Vergleich.png") });
  await chord(page, "b");

  // Customer mode hides internal columns and shows the chip
  check((await page.locator("table.grid-table thead th", { hasText: "Kontrahent" }).count()) === 1, "counterparty column visible before customer mode");
  await page.keyboard.press("Shift+K");
  await wait(300);
  check((await page.locator('[data-testid="customer-chip"]').count()) === 1, "customer mode chip");
  check((await page.locator("table.grid-table thead th", { hasText: "Kontrahent" }).count()) === 0, "customer mode hides counterparty column");
  check((await page.locator("table.grid-table thead th", { hasText: "DV01" }).count()) === 0, "customer mode hides DV01 column");
  await page.screenshot({ path: join(outDir, "04-customer-mode.png") });
  await page.keyboard.press("Shift+K");
  await wait(300);
  check((await page.locator('[data-testid="customer-chip"]').count()) === 0, "customer mode toggled off");

  // Enter on a focused rail button must not navigate (F-02)
  await page.locator(".rail button", { hasText: "∿" }).focus();
  await page.keyboard.press("Enter");
  await wait(200);
  check((await crumb(page)).includes("Kurven"), "enter on rail button = click only");
  // Enter on a focused pillar row must stay in the curves view (N-02)
  await page.locator('[data-testid="pillar-table"] tbody tr').first().focus();
  await page.keyboard.press("Enter");
  await wait(300);
  check((await crumb(page)).includes("Kurven"), "enter on pillar row does not navigate to pricing (N-02)");
  await chord(page, "s");
  await page.locator('[data-testid="scenario-table"] tbody tr').first().focus();
  await page.keyboard.press("Enter");
  await wait(300);
  check((await crumb(page)).includes("Szenarien"), "enter on scenario row does not navigate (N-02)");
  // heatmap ARIA: rows/gridcells + arrow-key navigation (N-13)
  check((await page.locator('.heat[role="grid"] [role="row"]').count()) >= 5, "what-if heatmap has role=row children");
  check((await page.locator('.heat[role="grid"] [role="gridcell"]').count()) >= 20, "what-if heatmap has gridcells");
  await page.locator('.heat[role="grid"] [role="gridcell"]').first().focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  const focusedCell = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.heat[role="grid"] [role="gridcell"]'));
    return cells.indexOf(document.activeElement);
  });
  check(focusedCell > 0, `arrow keys move the heatmap focus (index ${focusedCell})`);
  await chord(page, "b");
  await page.locator(".seg button", { hasText: "Zins" }).focus();
  await page.keyboard.press("Enter");
  await wait(200);
  check((await crumb(page)).includes("Blotter"), "enter on filter button stays in blotter");
  check((await page.locator('.seg button[aria-pressed="true"]', { hasText: "Zins" }).count()) === 1, "enter activated the filter");
  await page.locator(".seg button", { hasText: "Alle" }).click();

  // Esc leaves an input (F-05) and the status bar shows the input mode
  await page.locator('input[aria-label="Blotter durchsuchen"]').click();
  await page.keyboard.type("IRS");
  await wait(150);
  check((await page.locator('[data-testid="input-mode"]').count()) === 1, "statusbar shows Eingabemodus");
  await page.keyboard.press("Escape");
  await wait(150);
  check((await page.evaluate(() => document.activeElement === document.body)) === true, "esc blurs the input");
  check((await page.locator('[data-testid="input-mode"]').count()) === 0, "input mode indicator gone after Esc");
  // j/k follow the filtered order
  await page.keyboard.press("j");
  await wait(100);
  const selectedId = await page.locator("tr.selected td.id-cell").innerText();
  check(selectedId.startsWith("IRS"), `j follows the filtered order (${selectedId})`);
  await page.locator('input[aria-label="Blotter durchsuchen"]').fill("");
  await page.keyboard.press("Escape");
  // Blotter sort is persisted (N-24)
  await page.locator("th button.th-btn", { hasText: "PV" }).click();
  await wait(200);
  check((await page.evaluate(() => localStorage.getItem("deriva.blotter.sort") ?? "")).includes('"key":"pv"'), "blotter sort persisted to localStorage");
  await page.locator("th button.th-btn", { hasText: "ID" }).click();

  // Palette: focus returns to the opener after Esc in a real browser (N-03), aria-activedescendant (N-06)
  await page.locator('[data-testid="cmd-button"]').focus();
  await page.keyboard.press("Control+k");
  await wait(200);
  check((await page.locator('[role="combobox"][aria-activedescendant^="pal-opt-"]').count()) === 1, "palette input carries aria-activedescendant (N-06)");
  await page.keyboard.type("+");
  await wait(100);
  check(
    (await page.evaluate(() => Array.from(document.querySelectorAll(".palette kbd")).filter((k) => k.textContent.trim() === "").length)) === 0,
    "no empty kbd boxes for the + alias (N-04)",
  );
  await page.keyboard.press("Escape");
  await wait(300);
  check(
    (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "cmd-button",
    "palette returns focus to the opener after inert is lifted (N-03)",
  );
  // ↑ rotates examples repeatedly (N-05)
  await page.keyboard.press("Control+k");
  await wait(150);
  await page.keyboard.press("ArrowUp");
  const ex1 = await page.locator('[role="combobox"]').inputValue();
  await page.keyboard.press("ArrowUp");
  const ex2 = await page.locator('[role="combobox"]').inputValue();
  check(ex1 !== "" && ex2 !== ex1, `↑ rotates through examples repeatedly (${ex1} → ${ex2})`);
  await page.keyboard.press("Escape");
  await wait(200);

  // Chord navigation
  await chord(page, "p");
  check((await crumb(page)).includes("Pricing"), "g p → pricing");

  // Quick entry creates a trade with a readable id and a multi-word counterparty token (N-15)
  await page.keyboard.press("Control+k");
  await page.keyboard.type("irs 10y pay 3.1% 10m @Landesbank Hessen");
  await wait(200);
  await page.keyboard.press("Enter");
  await wait(400);
  const before = (await page.locator(".statusbar").innerText()).match(/(\d+) Trades/)?.[1];
  check(Number(before) >= 12, `quick entry added trade (${before})`);
  check((await page.locator(".toast").count()) >= 1, "toast shown after quick entry");
  check((await page.locator(".toast").first().innerText()).includes("PV"), "toast contains the PV");
  check((await page.locator(".badge.st-indication").count()) >= 1, "new trade carries Indication status badge");
  const newId = await page.locator(".card h3 .mono.ellipsis").first().innerText();
  check(/^IRS-\d{4}$/.test(newId), `readable sequential id (${newId})`);
  check((await page.locator('input[aria-label="Kontrahent"]').inputValue()) === "Landesbank Hessen", "@token keeps the whole counterparty phrase (N-15)");
  // Book field and CSA select in the common block (Markt N19 / N7)
  check((await page.locator('input[aria-label="Buch"]').count()) === 1, "book field in editor");
  check((await page.locator('select[aria-label="Collateral-Währung"]').count()) === 1, "collateral currency select in editor");
  check((await page.locator('input[aria-label="Upfront-Betrag"]').count()) === 1, "upfront field in editor");
  // Tenor-aware date field (F-39)
  const endDate = page.locator('input[aria-label="Enddatum"]');
  check((await endDate.getAttribute("type")) === "text", "date field is a text input");
  await endDate.click();
  await endDate.fill("12y");
  await page.keyboard.press("Enter");
  await wait(300);
  check(/^\d{2}\.\d{2}\.2038$/.test(await endDate.inputValue()), `tenor 12y sets the end date (${await endDate.inputValue()})`);
  await endDate.click();
  await endDate.fill("31.12.2036");
  await page.keyboard.press("Enter");
  await wait(300);
  check((await endDate.inputValue()) === "31.12.2036", "German date accepted");
  await endDate.click();
  await endDate.fill("quatsch");
  await wait(100);
  await page.keyboard.press("Tab");
  await wait(200);
  check((await endDate.inputValue()) === "31.12.2036", "invalid date text is not committed");
  await page.locator(".date-input .date-presets-btn").first().click();
  await wait(150);
  check((await page.locator('.popover.date-presets [role="option"]').count()) >= 8, "date presets popover opens");
  await page.keyboard.press("Escape");
  // Conventions section is collapsed by default and expands on click
  check((await page.locator(".collapsible .body").count()) === 0, "conventions collapsed by default");
  await page.locator(".collapsible > button").first().click();
  await wait(200);
  check((await page.locator(".collapsible .body").count()) >= 1, "conventions expand");
  check((await page.locator(".collapsible .body select").count()) >= 2, "stub / BDC selects present");
  // Amortisation: linear / annuity / custom profiles (Markt N17)
  await page.locator("label.check", { hasText: "Amortisierend" }).locator("input").check();
  await wait(300);
  check((await page.locator('[data-testid="amortisation-table"]').count()) === 1, "amortisation table");
  const amortStops = await page.evaluate(() => ({
    rows: document.querySelectorAll('[data-testid="amortisation-table"] tbody tr').length,
    rowStops: document.querySelectorAll('[data-testid="amortisation-table"] tbody tr[tabindex="0"]').length,
    inputStops: document.querySelectorAll('[data-testid="amortisation-table"] tbody input:not([tabindex="-1"])').length,
  }));
  check(
    amortStops.rows >= 5 && amortStops.rowStops === 1 && amortStops.inputStops === 0,
    `amortisation table is one tab stop (${amortStops.rows} rows, ${amortStops.rowStops} row stop, ${amortStops.inputStops} input stops) (R6-02)`,
  );
  await page.locator('[data-testid="amortisation-table"] tbody tr[tabindex="0"]').focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  check(
    (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Nominal Periode 2",
    "Enter on an amortisation row focuses its notional input (R6-02)",
  );
  await page.keyboard.press("Escape");
  await wait(100);
  check((await page.evaluate(() => document.activeElement?.tagName)) === "TR", "Esc returns from the notional input to the row (R6-02)");
  await page.locator('[aria-label="Tilgungsprofil"] button', { hasText: "Annuität" }).click();
  await wait(300);
  check((await page.locator('input[aria-label="Kreditzins"]').count()) === 1, "annuity profile shows the loan rate");
  const n1 = await page.locator('input[aria-label="Nominal Periode 1"]').inputValue();
  const n2 = await page.locator('input[aria-label="Nominal Periode 2"]').inputValue();
  check(n1 !== n2, `annuity profile amortises (${n1} → ${n2})`);
  await page.locator("button.btn", { hasText: "Konstant" }).click();
  await wait(300);
  check((await page.locator('[data-testid="amortisation-table"]').count()) === 0, "konstant removes amortisation table");

  // NumInput: German comma, no snap to 0 when cleared, validation
  const rate = page.locator('input[aria-label="Festsatz Leg 1"]');
  check((await rate.getAttribute("type")) === "text", "rate field is a text input");
  check(/^3,10?$/.test(await rate.inputValue()), `rate shows decimal comma (${await rate.inputValue()})`);
  await rate.click();
  await rate.fill("");
  await wait(100);
  check((await rate.inputValue()) === "", "cleared field stays empty");
  await rate.type("3,25");
  await wait(200);
  check((await rate.inputValue()) === "3,25", "typing 3,25 keeps the text");
  await rate.fill("325");
  await wait(200);
  check((await page.locator(".field-msg.warn", { hasText: "Plausibilität" }).count()) >= 1, "implausible rate shows a German warning");
  await rate.fill("3,1");
  await page.keyboard.press("Escape");
  await wait(150);
  const notional = page.locator('input[aria-label="Nominal"]').first();
  check((await notional.inputValue()) === "10.000.000", `notional grouped (${await notional.inputValue()})`);
  await notional.click();
  await notional.fill("12,5m");
  await page.keyboard.press("Enter");
  await wait(200);
  check((await notional.inputValue()) === "12.500.000", `shorthand 12,5m → 12.500.000 (${await notional.inputValue()})`);
  await notional.click();
  await notional.fill("10m");
  await page.keyboard.press("Enter");
  await wait(200);
  check((await page.locator('[data-testid="par-risk-card"]').count()) === 1, "par risk card present");
  check((await page.locator('[data-testid="keyrate-curves"]').count()) === 1, "key-rate curve chips (N-11)");
  await page.screenshot({ path: join(outDir, "02-pricing.png") });

  // What-if bump changes PV display – plain "]", AltGr (Windows), Option (mac) and the + / 0 aliases
  const pvBefore = await page.locator('[data-testid="pv-value"]').innerText();
  await page.keyboard.press("]");
  await wait(300);
  const pvAfter = await page.locator('[data-testid="pv-value"]').innerText();
  check(pvBefore !== pvAfter, "what-if bump changes PV");
  await page.keyboard.press("\\");
  await wait(200);
  await page.evaluate(() =>
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "]", code: "Digit9", ctrlKey: true, altKey: true, bubbles: true })),
  );
  await wait(300);
  check((await page.locator('[data-testid="market-chip"]').innerText()).includes("+10 bp"), "AltGr+9 bracket bumps what-if");
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "[", code: "Digit5", altKey: true, bubbles: true })));
  await wait(300);
  check(!(await page.locator('[data-testid="market-chip"]').innerText()).includes("What-if"), "Option+5 bracket bumps back (no view switch)");
  check((await crumb(page)).includes("Pricing"), "Option+5 did not switch to view 5");
  await page.keyboard.press("+");
  await wait(300);
  check((await page.locator('[data-testid="market-chip"]').innerText()).includes("+10 bp"), "+ alias bumps what-if");
  await page.keyboard.press("0");
  await wait(300);
  check(!(await page.locator('[data-testid="market-chip"]').innerText()).includes("What-if"), "0 alias resets what-if");
  // Esc in a number field cancels the edit (R3-10)
  const rateField = page.locator('input[aria-label="Festsatz Leg 1"]');
  const rateBefore = await rateField.inputValue();
  await rateField.click();
  await rateField.fill("9");
  await wait(150);
  await page.keyboard.press("Escape");
  await wait(200);
  check((await rateField.inputValue()) === rateBefore, `Esc restores the number field (${rateBefore})`);
  check((await page.locator('[data-testid="pv-value"]').innerText()) === pvBefore, "Esc in the number field leaves the PV unchanged");

  // FX option analytics: sane values, no raw keys, strike as price (N-01)
  await page.keyboard.press("Control+k");
  await page.keyboard.type("FXO-0001");
  await wait(200);
  await page.keyboard.press("Enter");
  await wait(600);
  const analytics = await page.locator('[data-testid="analytics-table"]').innerText();
  check(!/spotDate|greeksMethod|deltaPct|deltaAmount|spotAtValuationDate|fxDeltaCurrency/.test(analytics), "FX option analytics show no raw keys");
  check(!/\d{1,3}(\.\d{3}){2,},\d{2} %/.test(analytics), "no six-digit percentage in FX option analytics");
  check(/Strike\s*1,1500/.test(analytics.replace(/\n/g, " ")), "FX option strike shown as price 1,1500");
  const riskTxt = await page.locator('[data-testid="risk-table"]').innerText();
  check(/FX-Delta/.test(riskTxt), "FX delta in risk table");
  const cf = await page.locator('[data-testid="cashflow-table"]').innerText();
  check(!cf.includes("115,0000 %"), "cashflow strike not rendered as 115 % (N-01)");
  check(!/Vanilla Put EURUSD/.test(cf), "cashflow leg badge is German (N-07)");
  await page.screenshot({ path: join(outDir, "06-fxo-analytics.png") });
  // Swaption vega heatmap toggle (coordinator 2)
  await page.keyboard.press("Control+k");
  await page.keyboard.type("SWPT-0001");
  await wait(200);
  await page.keyboard.press("Enter");
  await wait(600);
  check((await page.locator('[data-testid="vega-dimension"]').count()) === 1, "swaption offers the vega dimension toggle");
  check((await page.locator('select[aria-label="Währung"] option').count()) >= 3, "swaption editor offers a currency select fed by the vol cubes (Markt R4-2)");
  await page.locator('[data-testid="vega-dimension"] button', { hasText: "Tenor" }).click();
  await wait(800);
  check((await page.locator('[data-testid="vega-heatmap"]').count()) === 1, "expiry × tenor vega heatmap renders");
  // FX option vega buckets: FX surface with optional smile buckets (core round 3)
  await page.keyboard.press("Control+k");
  await page.keyboard.type("FXO-0001");
  await wait(200);
  await page.keyboard.press("Enter");
  await wait(800);
  check((await page.locator('[data-testid="vega-buckets"]').innerText()).includes("FX-Fläche"), "FX option vega buckets are labelled FX-Fläche");
  await page.locator('[data-testid="vega-smile"]').check();
  await wait(800);
  check((await page.locator('[data-testid="vega-smile-table"]').count()) === 1, "smile toggle adds the RR/BF bucket table");
  await page.locator('[data-testid="vega-smile"]').uncheck();

  // Quick entry accepts German dates (R4-06) and a swaption currency (Markt R4-2) – preview only
  await page.keyboard.press("Control+k");
  await page.keyboard.type("fxf eurusd -2m 1.1725 15.03.2027");
  await wait(200);
  check((await page.locator(".palette .item").first().innerText()).includes("15.03.2027"), "quick entry accepts German dates (R4-06)");
  await page.keyboard.press("Control+a");
  await page.keyboard.type("swpt usd 1y5y payer 3.5% 10m");
  await wait(200);
  check(
    (await page.locator(".palette .item").first().innerText()).includes("Payer-Swaption USD"),
    "quick entry swaption takes the currency token (Markt R4-2)",
  );
  await page.keyboard.press("Escape");
  await wait(200);
  // CCS via palette quick entry: fair basis spread as key metric, interim exchange and MtM reset in the editor
  await page.keyboard.press("Control+k");
  await page.keyboard.type("ccs eurusd 5y -20bp 10m mtm");
  await wait(200);
  check((await page.locator(".palette .item").first().innerText()).includes("Cross-Currency-Swap EUR/USD 5Y"), "palette previews the CCS quick entry");
  await page.keyboard.press("Enter");
  await wait(600);
  const ccsId = await page.locator(".card h3 .mono.ellipsis").first().innerText();
  check(/^CCS-\d{4}$/.test(ccsId), `CCS created via palette with readable id (${ccsId})`);
  check((await page.locator(".kpi .label", { hasText: "Fairer Basis-Spread" }).count()) === 1, "CCS key metric is the fair basis spread");
  // USD CSA is the default → the Xccy basis is priced: fair spread ≈ market basis (−20 bp), not ≈ 0 (Markt R3-1)
  const fairSpreadTxt = await page.evaluate(() => {
    const label = Array.from(document.querySelectorAll(".kpi .label")).find((l) => l.textContent?.includes("Fairer Basis-Spread"));
    return label?.parentElement?.querySelector(".value")?.textContent ?? "";
  });
  const fairSpread = Number(fairSpreadTxt.replace(/\s|bp/g, "").replace("−", "-").replace(",", "."));
  check(Number.isFinite(fairSpread) && fairSpread < -10 && fairSpread > -30, `CCS fair basis spread ≈ −20 bp under USD CSA (${fairSpreadTxt})`);
  check((await page.locator('select[aria-label="Collateral-Währung"]').inputValue()) === "USD", "CCS quick entry sets the USD CSA");
  check((await page.locator("label.check", { hasText: "Interim" }).count()) === 1, "CCS editor offers the interim notional exchange");
  check((await page.locator('select[aria-label="MtM-Reset"]').inputValue()) === "1", "quick entry 'mtm' selects the resetting leg");
  check((await page.locator('input[aria-label="UTI"]').count()) === 1, "Regulatorik section with UTI field in the editor");
  // the quick entry left the focus on "Bezeichnung" (R7-03) – Esc leaves the field before the next chord
  await page.keyboard.press("Escape");
  await wait(100);
  // FRA via chord n r: editor with index select, settlement / fixing dates in the header
  await page.keyboard.press("n");
  await page.keyboard.press("r");
  await wait(600);
  const fraId = await page.locator(".card h3 .mono.ellipsis").first().innerText();
  check(/^FRA-\d{4}$/.test(fraId), `n r creates an FRA (${fraId})`);
  check((await page.locator('select[aria-label="Index"]').count()) === 1, "FRA editor has an index select");
  check((await page.locator('select[aria-label="Richtung"]').count()) === 1, "FRA direction select carries the field label as accessible name (R3-03)");
  check(
    (await page.evaluate(() => Array.from(document.querySelectorAll(".form select")).filter((s) => !s.getAttribute("aria-label")).length)) === 0,
    "no select without accessible name in the editor (R3-03)",
  );
  check(/Fixing-Datum \d{2}\.\d{2}\.\d{4}/.test(await page.locator('[data-testid="pricing-details"]').innerText()), "FRA header shows the fixing date");
  // R7-03: after a chord trade creation the focus is on the first editor field, not on body
  check(
    (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Bezeichnung",
    `n r leaves the focus on the first editor field (${await page.evaluate(() => document.activeElement?.tagName)}) (R7-03)`,
  );
  // back to the new IRS
  await page.keyboard.press("Control+k");
  await page.keyboard.type(newId);
  await wait(200);
  await page.keyboard.press("Enter");
  await wait(400);
  // Step-up coupon table (Kuponverlauf): a step writes rateSchedule and both par rates appear
  await page.locator('[data-testid="coupon-add-0"]').click();
  await wait(500);
  check((await page.locator('[data-testid="coupon-schedule-0"] table').count()) === 1, "step-up table renders after adding a step");
  check((await page.locator('input[aria-label="Stufe 1 Kupon Leg 1"]').count()) === 1, "step row has a NumInput for the coupon");
  const stepAnalytics = await page.locator('[data-testid="analytics-table"]').innerText();
  check(stepAnalytics.includes("Par-Satz (Basis, Staffel konstant)") && stepAnalytics.includes("Par-Satz (flach)"), "analytics show base and flat par rates");
  await page.locator('button[aria-label="Stufe 1 entfernen"]').click();
  await wait(300);
  check((await page.locator('[data-testid="coupon-schedule-0"] table').count()) === 0, "removing the step drops the table");
  // Shift+P on a cap sets the ATM strike, on a collar the zero-cost floor strike (R5-03); risk table is named and German (R5-04)
  await page.keyboard.press("Control+k");
  await page.keyboard.type("CAP-0001");
  await wait(200);
  await page.keyboard.press("Enter");
  await wait(500);
  const capStrikeBefore = await page.locator('input[aria-label="Strike"]').first().inputValue();
  await page.keyboard.press("Shift+P");
  await wait(600);
  check((await page.locator(".toast", { hasText: "ATM-Strike übernommen" }).count()) === 1, "Shift+P on a cap takes over the ATM strike (R5-03)");
  check((await page.locator('input[aria-label="Strike"]').first().inputValue()) !== capStrikeBefore, `cap strike changed (${capStrikeBefore} → ATM) (R5-03)`);
  check((await page.locator(".toast", { hasText: "Kein Par-Wert" }).count()) === 0, "no 'Kein Par-Wert' toast for the cap (R5-03)");
  await page.keyboard.press("Control+z");
  await wait(400);
  await page.keyboard.press("Control+k");
  await page.keyboard.type("collar 7y 3.5/1.5 6m");
  await wait(200);
  await page.keyboard.press("Enter");
  await wait(600);
  await page.keyboard.press("Escape"); // leave the "Bezeichnung" field the quick entry focused (R7-03)
  await wait(100);
  const collarPvBefore = await page.locator('[data-testid="pv-value"]').innerText();
  await page.keyboard.press("Shift+P");
  await wait(800);
  check((await page.locator(".toast", { hasText: "Zero-Cost-Collar" }).count()) === 1, "Shift+P on a collar solves the zero-cost floor strike (R5-03)");
  const collarPvAfter = Number((await page.locator('[data-testid="pv-value"]').innerText()).replace(/[.\s]/g, "").replace("−", "-").replace(",", "."));
  check(
    Number.isFinite(collarPvAfter) && Math.abs(collarPvAfter) < 100 && collarPvBefore !== String(collarPvAfter),
    `collar PV ≈ 0 after Shift+P (${collarPvAfter}) (R5-03)`,
  );
  const collarId = await page.locator(".card h3 .mono.ellipsis").first().innerText();
  const riskTable = page.locator('[data-testid="risk-table"]');
  check((await riskTable.getAttribute("aria-label")) === "Risiko (Bump)", "risk table carries an aria-label (R5-04)");
  check(
    /Vega Caplet|Vega Swaption|Vega FX/.test(await riskTable.innerText()) && !/Vega caplet|Vega swaption/.test(await riskTable.innerText()),
    "vega bucket labels are German (R5-04)",
  );
  check(
    (await page.locator('[data-testid="analytics-table"]').getAttribute("aria-label")) === "Preis-Analytics",
    "analytics table carries an aria-label (R5-04)",
  );
  // remove the collar again (Shift+D → toast with Rückgängig)
  await page.keyboard.press("Shift+D");
  await wait(400);
  check((await page.locator(".toast", { hasText: `Gelöscht: ${collarId}` }).count()) === 1, "collar deleted again");

  // Report: generate, audit line, governance, perspective, what-if badge, documents
  await chord(page, "r");
  check((await page.locator('[data-testid="report-generate-btn"]').count()) === 1, "report requires explicit generation");
  await chordO(page, "r");
  check((await page.locator('[data-testid="audit-hashes"]').count()) === 1, "report audit line (o r)");
  const methodology = await page.locator('[data-testid="methodology"]').innerText();
  check(!/\b[a-z]+[A-Z]\w+\b/.test(methodology), "methodology paragraphs carry no camelCase identifiers (R3-06)");
  check(!/ModifiedFollowing|ShortFront|MISSING_FIXING|Float EURIBOR/.test(methodology), "methodology paragraphs are German (R3-06)");
  check(
    /log-linear \(DF\)|monoton-konvex|linear \(Zero\)/.test(await page.locator('[data-testid="market-table"]').innerText()),
    "market table shows interpolation labels (R3-06)",
  );
  check((await page.locator('[data-testid="audit-hashes"]').innerText()).includes("deriva-pricing-core"), "engine version shown");
  // Customer mode hides the internal formulas of the report (R5-07)
  const reportInternal = await page.locator('[data-testid="report"]').innerText();
  check(reportInternal.includes("= risikofrei − CVA + DVA") && /Marge der Bank/.test(reportInternal), "auditor report shows decomposition and margin rule");
  await page.keyboard.press("Shift+K");
  await wait(400);
  const reportCustomer = await page.locator('[data-testid="report"]').innerText();
  check(
    !reportCustomer.includes("risikofrei − CVA") && !/Marge der Bank/.test(reportCustomer) && !/\bCVA\b|\bDVA\b/.test(reportCustomer),
    "customer-mode report hides CVA/DVA decomposition and the bank-margin formula (R5-07)",
  );
  check(reportCustomer.includes("inkl. Kontrahentenrisiko"), "customer-mode fair value carries the neutral subtitle (R5-07)");
  await page.keyboard.press("Shift+K");
  await wait(400);
  check((await page.locator('[data-testid="report-governance"]').innerText()).includes("indikativ"), "governance line shows snapshot status");
  check((await page.locator('[data-testid="perspective-seg"] button[aria-pressed="true"]').innerText()) === "Kunde", "default perspective is Kunde");
  check(
    (await page.locator('[data-testid="xva-method"]').innerText()).match(/Sorensen|Delta-Normal|Methode:\s*$/) !== null &&
      !/smile vol at strike|flat hazard/.test(await page.locator('[data-testid="xva-method"]').innerText()),
    "XVA method string is German (N-07)",
  );
  const gen1 = await page.locator('[data-testid="report-header"]').innerText();
  await page.locator('[data-testid="offer-pv"]').fill("25000");
  await page.keyboard.press("Enter");
  await wait(300);
  const gen2 = await page.locator('[data-testid="report-header"]').innerText();
  check(gen1.split("erstellt")[1] === gen2.split("erstellt")[1], "generatedAt stable while editing inputs");
  check((await page.locator('[data-testid="report-stale"]').count()) === 1, "changed inputs flag the report as stale");
  check((await page.locator('[data-testid="cost-table"]').innerText()).includes("bp"), "margin row uses de-DE bp");
  // cost inputs survive a view switch (N-17)
  await chord(page, "p");
  await chord(page, "r");
  check(
    (await page.locator('[data-testid="offer-pv"]').inputValue()) === "25.000",
    `transaction price persisted across views (${await page.locator('[data-testid="offer-pv"]').inputValue()})`,
  );
  await page.keyboard.press("]");
  await wait(400);
  check((await page.locator('[data-testid="report-whatif-badge"]').count()) === 1, "what-if badge on report");
  const whatIfHeader = await page.locator('[data-testid="report-header"]').innerText();
  check((whatIfHeader.match(/What-if/g) ?? []).length <= 1 && !/What-if What-if/.test(whatIfHeader), "report header names the what-if at most once (R4-07)");
  check(
    /WHAT-IF Zinsen \+10 bp – NICHT PRÜFUNGSFÄHIG/.test(await page.locator(".report-print-header").innerText()),
    "print header carries the German what-if label (R4-07)",
  );
  // documents under what-if carry the stress banner (R3-F1) and ask before print/download
  await page.locator('[data-testid="open-termsheet"]').click();
  await wait(500);
  check((await page.locator('[data-testid="doc-whatif-banner"]').count()) === 1, "termsheet under what-if shows the stress-market banner (R3-F1)");
  check((await page.locator('[data-testid="document-body"]').innerText()).includes("WHAT-IF"), "termsheet subtitle carries the WHAT-IF marker (R3-F1)");
  page.once("dialog", (d) => d.dismiss());
  await page.locator('[data-testid="doc-print"]').click();
  await wait(300);
  check((await page.locator('[data-testid="documents-modal"]').count()) === 1, "print under what-if asks for confirmation (dismissed → still open)");
  await page.keyboard.press("Escape");
  await wait(300);
  await page.keyboard.press("\\");
  await wait(300);
  // quote change → stale + "modifiziert" (N-18)
  await chordO(page, "r");
  await chord(page, "c");
  await page.locator("button.btn", { hasText: "Quotes +10 bp" }).click();
  await wait(500);
  await chord(page, "r");
  await wait(300);
  check((await page.locator('[data-testid="report-stale"]').count()) === 1, "quote change flags the report as stale (N-18)");
  await chordO(page, "r");
  check(
    (await page.locator('[data-testid="report-header"]').innerText()).includes("modifiziert"),
    "report header says modifiziert after a quote change (N-18)",
  );
  await page.keyboard.press("Control+z");
  await wait(400);
  check((await page.locator(".toast", { hasText: "Rückgängig: Quotes" }).count()) === 1, "Ctrl+Z undoes the quote change (N-14)");
  await chordO(page, "r");
  // Termsheet via chord o t (R3-01), with initial market value and German numbers
  await chordO(page, "t");
  check((await page.locator('[data-testid="documents-modal"]').count()) === 1, "o t opens the termsheet modal (R3-01)");
  // R6-03: Esc from a chord-opened document must not drop the focus on body – it lands in the view (main / document toolbar)
  await page.keyboard.press("Escape");
  await wait(300);
  const focusAfterDoc = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    id: document.activeElement?.id,
    inMain: !!document.activeElement?.closest("main"),
  }));
  check(
    focusAfterDoc.tag !== "BODY" && focusAfterDoc.inMain,
    `focus after Esc from the termsheet lies in the view, not on body (${focusAfterDoc.tag}#${focusAfterDoc.id}) (R6-03)`,
  );
  await chordO(page, "t");
  check((await page.locator('[data-testid="doc-whatif-banner"]').count()) === 0, "no what-if banner without a what-if");
  check((await page.locator('[data-testid="document-body"] .doc-section').count()) >= 2, "termsheet sections rendered");
  const docText = await page.locator('[data-testid="document-body"]').innerText();
  check(docText.includes("Anfänglicher Marktwert"), "termsheet carries the initial market value (N-22)");
  check(!/\d\.\d{3} %/.test(docText), "termsheet numbers use decimal commas (N-07)");
  check(!/smile vol at strike|flat hazard|Swaption-replication/.test(docText), "termsheet methodology paragraphs are German (N-07)");
  // Print emulation of the document: title dark on light, content starts at the top (N-16)
  await page.evaluate(() => document.body.classList.add("print-doc"));
  await page.emulateMedia({ media: "print" });
  await wait(300);
  const printDoc = await page.evaluate(() => {
    const h1 = document.querySelector(".doc-head h2");
    const cs = h1 ? getComputedStyle(h1) : null;
    const rect = h1?.getBoundingClientRect();
    const bg = document.querySelector(".modal") ? getComputedStyle(document.querySelector(".modal")).backgroundColor : "";
    return { color: cs?.color, top: rect?.top, bg, appHidden: document.querySelector(".app") ? getComputedStyle(document.querySelector(".app")).display : "" };
  });
  check(printDoc.color === "rgb(17, 17, 17)", `print: document title is dark (${printDoc.color})`);
  check(printDoc.top !== undefined && printDoc.top < 200, `print: document starts on the first page (title top ${Math.round(printDoc.top ?? -1)} px)`);
  check(printDoc.bg === "rgb(255, 255, 255)", `print: modal background is white (${printDoc.bg})`);
  check(printDoc.appHidden === "none", "print: app shell hidden behind the document");
  await page.screenshot({ path: join(outDir, "07-termsheet-print.png"), fullPage: true });
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => document.body.classList.remove("print-doc"));
  await page.keyboard.press("Escape");
  await wait(300);
  check((await page.locator('[data-testid="documents-modal"]').count()) === 0, "esc closes the modal");
  await page.locator('[data-testid="open-termsheet"]').focus();
  await page.locator('[data-testid="open-termsheet"]').click();
  await wait(300);
  await page.keyboard.press("Escape");
  await wait(300);
  check((await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "open-termsheet", "modal returns focus to the opener (N-03)");
  await chordO(page, "g");
  check((await page.locator('[data-testid="documents-modal"]').count()) === 1, "o g opens the suitability statement (N-22 / R3-01)");
  await page.locator('[data-testid="suitability-generate"]').click();
  await wait(500);
  check((await page.locator('[data-testid="document-body"]').count()) === 1, "suitability statement generated");
  await page.keyboard.press("Escape");
  await wait(200);
  // KID (Basisinformationsblatt) via chord o k and Confirmation via button
  await chordO(page, "k");
  await wait(200);
  check((await page.locator('[data-testid="documents-modal"]').count()) === 1, "o k opens the KID modal");
  check((await page.locator('[data-testid="kid-form"]').count()) === 1, "KID form with manufacturer / holding period");
  const kidText = await page.locator('[data-testid="document-body"]').innerText();
  check(kidText.includes("Basisinformationsblatt"), "KID document rendered");
  check(!/\d{4}-\d{2}-\d{2}/.test(kidText), "KID uses German dates");
  // long text cells wrap: no horizontal overflow of the modal body, text cells exist (R3-05)
  const kidLayout = await page.evaluate(() => {
    const body = document.querySelector('[data-testid="documents-modal"] .modal-body');
    return {
      overflow: body ? body.scrollWidth - body.clientWidth : 999,
      textCells: document.querySelectorAll('[data-testid="document-body"] td.text').length,
      tallest: Math.max(...Array.from(document.querySelectorAll('[data-testid="document-body"] td.text')).map((td) => td.getBoundingClientRect().height)),
    };
  });
  check(kidLayout.overflow <= 1, `KID long text cells do not widen the modal (overflow ${kidLayout.overflow} px, R3-05)`);
  check(
    kidLayout.textCells > 0 && kidLayout.tallest > 30,
    `KID long texts wrap onto several lines (${kidLayout.textCells} cells, tallest ${Math.round(kidLayout.tallest)} px)`,
  );
  await page.evaluate(() => document.body.classList.add("print-doc"));
  await page.emulateMedia({ media: "print" });
  await wait(300);
  const kidPrintWidth = await page.evaluate(() => document.body.scrollWidth);
  check(kidPrintWidth <= 1600, `KID print width stays within the page (${kidPrintWidth} px, R3-05)`);
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => document.body.classList.remove("print-doc"));
  await page.locator('[data-testid="kid-holding-period"]').fill("3");
  await page.keyboard.press("Enter");
  await wait(400);
  check((await page.locator('[data-testid="document-body"]').count()) === 1, "KID regenerates live after changing the holding period");
  await page.keyboard.press("Escape");
  await wait(300);
  await page.locator('[data-testid="open-confirmation"]').click();
  await wait(500);
  check((await page.locator('[data-testid="confirmation-form"]').count()) === 1, "confirmation form (parties, master agreement)");
  check((await page.locator('[data-testid="document-body"]').innerText()).includes("Rahmenvertrag"), "confirmation document rendered");
  await page.keyboard.press("Escape");
  await wait(300);
  await page.screenshot({ path: join(outDir, "view-Report.png") });
  // Print emulation of the report: inputs print as static text (value visible, no frame) – R3-04
  await page.emulateMedia({ media: "print" });
  await wait(300);
  check((await page.locator(".report-print-header").isVisible()) === true, "print header visible in print media");
  const offerPrint = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="offer-pv"]');
    const cs = el ? getComputedStyle(el) : null;
    return { display: cs?.display, border: cs?.borderStyle, value: el?.value };
  });
  check(offerPrint.display !== "none" && offerPrint.value === "25.000", `report input prints its value as text (${offerPrint.value})`);
  check(offerPrint.border === "none", `report input prints without a frame (${offerPrint.border})`);
  await page.screenshot({ path: join(outDir, "05-report-print.png"), fullPage: true });
  await page.emulateMedia({ media: "screen" });

  // Hedge accounting view: designation before valuation date, stale flag, export (N-20)
  await page.keyboard.press("Control+k");
  await page.keyboard.type("IRS-0001");
  await wait(200);
  await page.keyboard.press("Enter");
  await wait(300);
  await chord(page, "h");
  check((await crumb(page)).includes("Hedge"), "g h → hedge view");
  check(
    (await page.locator('input[aria-label="Designationsdatum"]').inputValue()) === "17.06.2024",
    "default designation date = instrument effective date (N-20)",
  );
  await page.locator('[data-testid="hedge-test"]').click();
  await wait(2500);
  check((await page.locator('[data-testid="hedge-verdict-badge"]').count()) === 1, "hedge effectiveness verdict");
  check((await page.locator('[data-testid="hedge-regression"]').count()) === 1, "regression card");
  // R5-F3: the test result survives a reload (persisted per relationship, current inputs → not stale)
  const verdictBefore = await page.locator('[data-testid="hedge-verdict-badge"]').innerText();
  await page.reload({ waitUntil: "networkidle" });
  await wait(600);
  check((await crumb(page)).includes("Hedge"), "hedge view restored after reload");
  check((await page.locator('[data-testid="hedge-verdict-badge"]').count()) === 1, "hedge effectiveness result survives the reload (R5-F3)");
  check(
    (await page.locator('[data-testid="hedge-verdict-badge"]').innerText()) === verdictBefore,
    `reloaded verdict equals the tested one (${verdictBefore}) (R5-F3)`,
  );
  check((await page.locator('[data-testid="hedge-stale"]').count()) === 0, "reloaded result is not flagged stale while inputs are unchanged (R5-F3)");
  check(
    (await page.locator('[data-testid="do-Kumulativ (seit Designation)"] .badge').first().innerText()) !== "nicht beurteilbar",
    "cumulative dollar-offset is assessable with a past designation date",
  );
  check(
    !/\d{4}-\d{2}-\d{2}|InterestRateSwap/.test(await page.locator('[data-testid="hedge-summary"]').innerText()),
    "hedge summary without ISO dates / English type names (N-07)",
  );
  await page.locator('input[aria-label="Hedge Ratio"]').fill("50");
  await page.keyboard.press("Enter");
  await wait(300);
  check((await page.locator('[data-testid="hedge-stale"]').count()) === 1, "changed hedge ratio flags the result as stale (N-20)");
  check((await page.locator('[data-testid="hedge-export"]').count()) === 1, "hedge documentation export button");
  // Hedge print: number fields print their values (R3-04)
  await page.emulateMedia({ media: "print" });
  await wait(300);
  const hedgePrint = await page.evaluate(() => {
    const ratio = document.querySelector('input[aria-label="Hedge Ratio"]');
    const notional = document.querySelector('input[aria-label="Nominal Grundgeschäft"]');
    const vis = (el) => !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0;
    return {
      ratioVisible: vis(ratio),
      ratio: ratio?.value,
      notionalVisible: vis(notional),
      notional: notional?.value,
      header: document.querySelector(".hedge .report-print-header")?.textContent ?? "",
    };
  });
  check(hedgePrint.ratioVisible && hedgePrint.ratio === "50", `hedge print shows the hedge ratio (${hedgePrint.ratio}) (R3-04)`);
  check(hedgePrint.notionalVisible && /\d/.test(hedgePrint.notional ?? ""), `hedge print shows the hedged-item notional (${hedgePrint.notional}) (R3-04)`);
  check(hedgePrint.header.includes("ERGEBNIS VERALTET"), "hedge print header carries the stale marker");
  // Selects print their full option text and the unit sits next to the value (R4-08)
  const hedgePrintFit = await page.evaluate(() => {
    const measure = (el, text) => {
      const s = document.createElement("span");
      s.style.font = getComputedStyle(el).font;
      s.style.position = "absolute";
      s.style.visibility = "hidden";
      s.style.whiteSpace = "nowrap";
      s.textContent = text;
      document.body.appendChild(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return w;
    };
    const sels = ['select[aria-label="Art des Grundgeschäfts"]', 'select[aria-label="Tilgungsplan Grundgeschäft"]']
      .map((q) => document.querySelector(q))
      .filter(Boolean);
    const clipped = sels.filter((sel) => sel.clientWidth + 2 < measure(sel, sel.selectedOptions[0]?.textContent ?? "")).length;
    const ratio = document.querySelector('input[aria-label="Hedge Ratio"]');
    const unit = ratio?.parentElement?.querySelector(".unit");
    const gap = ratio && unit ? unit.getBoundingClientRect().left - ratio.getBoundingClientRect().right : 999;
    const ratioW = ratio ? ratio.getBoundingClientRect().width : 999;
    return { sels: sels.length, clipped, gap, ratioW };
  });
  check(
    hedgePrintFit.sels >= 2 && hedgePrintFit.clipped === 0,
    `hedge print: selects are not clipped (${hedgePrintFit.clipped} of ${hedgePrintFit.sels}) (R4-08)`,
  );
  check(hedgePrintFit.gap >= -1 && hedgePrintFit.gap < 30, `hedge print: unit sits next to the value (gap ${Math.round(hedgePrintFit.gap)} px) (R4-08)`);
  // The input shrinks to its value, so "50" and "%" are visually adjacent, not 50 px apart (R5-08)
  check(hedgePrintFit.ratioW < 60, `hedge print: ratio input shrinks to its value (${Math.round(hedgePrintFit.ratioW)} px wide) (R5-08)`);
  await page.screenshot({ path: join(outDir, "08-hedge-print.png"), fullPage: true });
  await page.emulateMedia({ media: "screen" });
  // "Zurücksetzen" asks first (R3-F4)
  page.once("dialog", (d) => d.dismiss());
  await page.locator('[data-testid="hedge-reset"]').click();
  await wait(300);
  check((await page.locator('input[aria-label="Hedge Ratio"]').inputValue()) === "50", "hedge reset dismissed → documentation kept (R3-F4)");
  // R7-06: an accepted reset is one undo step that brings back the documentation AND the persisted test result
  page.once("dialog", (d) => d.accept());
  await page.locator('[data-testid="hedge-reset"]').click();
  await wait(400);
  check((await page.locator('[data-testid="hedge-verdict-badge"]').count()) === 0, "hedge reset drops the stored test result (R7-06)");
  check(
    (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "hedge-test",
    "after the confirmed hedge reset the focus is on „Effektivität testen“ (R8-05)",
  );
  await page.keyboard.press("Control+z");
  await wait(500);
  check((await page.locator('input[aria-label="Hedge Ratio"]').inputValue()) === "50", "undo restores the hedge documentation (R3-F4)");
  check((await page.locator('[data-testid="hedge-verdict-badge"]').count()) === 1, "undo restores the persisted test result too (R7-06)");
  check((await page.locator('[data-testid="hedge-amortisation"]').count()) === 1, "hedged item offers the amortisation select");
  check((await page.locator('[data-testid="hedge-designation"]').count()) === 0, "designation select hidden for linear instruments");
  // option instrument: designation select, freeze-vol checkbox, cost of hedging card
  await page.keyboard.press("Control+k");
  await page.keyboard.type("CAP-0001");
  await wait(200);
  await page.keyboard.press("Enter");
  await wait(300);
  await chord(page, "h");
  check((await page.locator('[data-testid="hedge-designation"]').count()) === 1, "cap offers the option designation");
  check((await page.locator('[data-testid="hedge-freeze-vol"]').count()) === 1, "freeze designation vol checkbox");
  await page.locator('[data-testid="hedge-designation"]').selectOption("IntrinsicValue");
  await page.locator('[data-testid="hedge-freeze-vol"]').check();
  await page.locator('[data-testid="hedge-test"]').click();
  await wait(3000);
  check((await page.locator('[data-testid="hedge-coh"]').count()) === 1, "cost-of-hedging card for the intrinsic-value designation");
  check((await page.locator('[data-testid="hedge-frozen-vol"]').count()) === 1, "frozen designation vol shown on the hypothetical");
  await page.screenshot({ path: join(outDir, "view-Hedge.png") });

  // Views render without errors (dark)
  for (const [k, name] of VIEWS.filter(([, n]) => ["Kurven", "Szenarien", "Markt"].includes(n))) {
    await chord(page, k);
    check((await crumb(page)).includes(name), `view ${name}`);
    await page.screenshot({ path: join(outDir, `view-${name}.png`) });
  }
  // Curves: quotes card is not clipped at 1600 px with the inspector open (N-10 / R3-09)
  await chord(page, "c");
  const quotesFit = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="quotes-table"]');
    const wrap = t?.parentElement;
    return wrap ? { inner: wrap.scrollWidth, outer: wrap.clientWidth, inspector: !!document.querySelector(".inspector") } : null;
  });
  check(
    !!quotesFit && quotesFit.inspector && quotesFit.inner <= quotesFit.outer + 1,
    `quotes table fits its card with the inspector open (${quotesFit?.inner} ≤ ${quotesFit?.outer})`,
  );
  // Turn-of-year in the past → validation, not a silent no-op (R3-F2)
  await page.locator('[data-testid="toy-bp"]').fill("20");
  await page.keyboard.press("Enter");
  const toyDate = page.locator('input[aria-label="Turn-of-Year Datum"]');
  await toyDate.click();
  await toyDate.fill("01.01.2020");
  await page.keyboard.press("Enter");
  await wait(300);
  check((await page.locator('[data-testid="toy-past"]').count()) === 1, "turn-of-year in the past shows a validation message (R3-F2)");
  check((await page.locator('[data-testid="toy-apply"]').isDisabled()) === true, "turn-of-year in the past disables Anwenden (R3-F2)");
  check((await page.locator('[data-testid="toy-badge"]').count()) === 0, "no turn-of-year badge for a past date");
  await toyDate.click();
  await toyDate.fill("31.12.2026");
  await page.keyboard.press("Enter");
  await page.locator('[data-testid="toy-bp"]').fill("0");
  await page.keyboard.press("Enter");
  await wait(200);
  // "+ FX-Punkte" adds a removable FX-swap-points quote to the collateral curve (Markt R3-6)
  await page.locator('[aria-label="Kurve"] button', { hasText: "EUR/USD CSA" }).click();
  await wait(300);
  const quoteRows = await page.locator('[data-testid="quotes-table"] tbody tr').count();
  await page.locator('[data-testid="add-fx-points"]').click();
  await wait(600);
  check((await page.locator('[data-testid="quotes-table"] tbody tr').count()) === quoteRows + 1, "+ FX-Punkte adds a quote row (R3-6)");
  check((await page.locator('[data-testid="added-quote"]').count()) === 1, "added FX-points row is marked and removable");
  await page.locator('[data-testid="added-quote"] button[aria-label^="Quote"]').click();
  await wait(400);
  check((await page.locator('[data-testid="quotes-table"] tbody tr').count()) === quoteRows, "added quote can be removed again");
  await page.locator('[aria-label="Kurve"] button', { hasText: "€STR" }).click();
  await wait(300);
  // Curves: interpolation override survives a valuation-date change (N-23), quotes flagged as modified
  await page.locator('[data-testid="interp-select"]').selectOption("linearZero");
  await wait(500);
  check((await page.locator(".card h3", { hasText: "EUR-ESTR" }).first().innerText()).includes("linear (Zero)"), "interpolation override applied");
  check((await page.locator('[data-testid="market-modified-chip"]').count()) === 1, "interpolation override marks the market as modified");
  await page.keyboard.press("Shift+T");
  await wait(200);
  await page.locator('[data-testid="valdate-popover"] .chip', { hasText: "Monatsende" }).click();
  await wait(800);
  check((await page.locator(".statusbar").innerText()).includes("30.09.2026"), "monatsende preset applied");
  check(
    (await page.locator('[data-testid="interp-select"]').inputValue()) === "linearZero",
    "interpolation override survives the valuation-date change (N-23)",
  );
  await page.locator('[data-testid="interp-select"]').selectOption("logLinear");
  await wait(400);
  check(
    (await page.locator('[data-testid="interp-select"] option', { hasText: "monoton-konvex" }).count()) === 1,
    "interpolation select offers monoton-konvex (Hagan–West)",
  );
  await page.locator("button.btn", { hasText: "Quotes +10 bp" }).click();
  await wait(500);
  check((await page.locator('[data-testid="market-chip"]').innerText()).includes("modifiziert"), "chip shows modifiziert after quote edit");
  check((await page.locator("tr.edited").count()) >= 1, "edited quote rows highlighted");
  await page.locator("button.btn", { hasText: "Zurücksetzen" }).click();
  await wait(400);
  // JPY-TONA curve tab and turn-of-year jump
  await page.locator('[aria-label="Kurve"] button', { hasText: "TONA" }).click();
  await wait(400);
  check((await page.locator(".card h3", { hasText: "JPY-TONA" }).count()) >= 1, "JPY-TONA curve selectable");
  check((await page.locator('[data-testid="pillar-table"] tbody tr').count()) >= 5, "JPY-TONA pillars rendered");
  await page.locator('[aria-label="Kurve"] button', { hasText: "€STR" }).click();
  await wait(300);
  await page.locator('[data-testid="toy-bp"]').fill("20");
  await page.keyboard.press("Enter");
  await wait(200);
  await page.locator('[data-testid="toy-apply"]').click();
  await wait(800);
  check((await page.locator('[data-testid="toy-badge"]').count()) === 1, "turn-of-year badge after applying the jump");
  check((await page.locator('[data-testid="market-modified-chip"]').innerText()).includes("Turn-of-Year"), "turn-of-year counts as modified market");
  // A valuation date past the stored jump shows the "inaktiv" badge instead of a validation error (R4-09)
  await page.keyboard.press("Control+k");
  await page.keyboard.type("stichtag 15.01.2027");
  await wait(200);
  await page.keyboard.press("Enter");
  await wait(900);
  check(
    (await page.locator('[data-testid="toy-inactive"]').count()) === 1,
    "stored turn-of-year overtaken by the valuation date shows the inaktiv badge (R4-09)",
  );
  check((await page.locator('[data-testid="toy-past"]').count()) === 0, "no validation error for the unchanged stored jump (R4-09)");
  check((await page.locator(".toast", { hasText: "inaktiv" }).count()) >= 1, "toast announces the inactive turn-of-year (R4-09)");
  const toyLabelH = await page.evaluate(() => document.querySelector(".toy-label")?.getBoundingClientRect().height ?? 999);
  check(toyLabelH < 30, `Turn-of-Year label stays on one line (${Math.round(toyLabelH)} px) (R4-09)`);
  await page.keyboard.press("Control+k");
  await page.keyboard.type("stichtag 30.09.2026");
  await wait(200);
  await page.keyboard.press("Enter");
  await wait(900);
  await page.locator("button.btn", { hasText: "Zurücksetzen" }).click();
  await wait(500);
  check((await page.locator('[data-testid="toy-badge"]').count()) === 0, "reset removes the turn-of-year jump");
  // Reporting currency cycles through JPY (discount curve present)
  await page.keyboard.press("c");
  await page.keyboard.press("c");
  await page.keyboard.press("c");
  await page.keyboard.press("c");
  await wait(600);
  check((await page.locator('button[aria-label^="Reporting-Währung JPY"]').count()) === 1, "currency cycle reaches JPY");
  await page.keyboard.press("c");
  await wait(600);

  // Scenario heatmap click sets the what-if; historical stress episodes toggle
  await chord(page, "s");
  await page.locator(".heat button.cell").nth(1).click();
  await wait(400);
  check((await page.locator('[data-testid="market-chip"]').innerText()).includes("What-if"), "heatmap cell sets what-if");
  await page.keyboard.press("0");
  await wait(200);
  await page.locator('[data-testid="historical-toggle"]').click();
  await wait(1500);
  check((await page.locator('[data-testid="scenario-table"]').innerText()).includes("Lehman"), "historical toggle adds the stress episodes");
  await page.locator('button[aria-label^="Beschreibung Lehman"]').click();
  await wait(200);
  check((await page.locator('[data-testid="scenario-description"]').count()) === 1, "scenario description row expands");
  await page.locator('[data-testid="historical-toggle"]').click();
  await wait(800);

  // Market: CDS term structure editor bootstraps a hazard curve
  await chord(page, "m");
  await page.locator('[data-testid="cds-add"]').click();
  await wait(300);
  check((await page.locator('[data-testid="cds-table"] tbody tr').count()) === 1, "CDS quote row added");
  check((await page.locator('[data-testid="hazard-pillars"]').count()) === 1, "hazard pillars shown for the CDS term structure");
  await page.locator('[data-testid="cds-table"] button[aria-label^="CDS-Quote 1 entfernen"]').click();
  await wait(200);
  // Market: vol surfaces are editable – a cell edit marks the market as modified, Ctrl+Z reverts (Markt R3-4)
  const volCell = page.locator('[data-testid="swaption-vol-cell"]');
  const volBefore = await volCell.inputValue();
  await volCell.click();
  await volCell.fill("99");
  await page.keyboard.press("Enter");
  await wait(500);
  check((await page.locator('[data-testid="swaption-vol-edited"]').count()) === 1, "editing a swaption vol cell flags the surface as geändert (R3-4)");
  check((await page.locator('[data-testid="market-chip"]').innerText()).includes("modifiziert"), "vol edit marks the market as modified (R3-4)");
  await page.keyboard.press("Control+z");
  await wait(500);
  check((await page.locator(".toast", { hasText: "Rückgängig: Swaption-Vol" }).count()) === 1, "Ctrl+Z undoes the vol edit with a typed label (N-14)");
  check((await volCell.inputValue()) === volBefore, `vol cell restored after undo (${volBefore})`);
  check((await page.locator('[data-testid="fx-vol-cell"]').count()) === 1, "FX smile rows are editable");
  check((await page.locator('[data-testid="caplet-vol-cell"]').count()) === 1, "caplet surface cells are editable");
  // Caplet inputs are bound to their cells: readable values, click hits the right cell (R4-01 / Markt R4-3)
  const capletFit = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="caplet-vol-table"] tbody tr:first-child td.vol-cell input')).map((i) => {
      const td = i.closest("td");
      const ir = i.getBoundingClientRect();
      const tr = td.getBoundingClientRect();
      return {
        w: Math.round(ir.width),
        tdw: Math.round(tr.width),
        fits: ir.right <= tr.right + 0.5 && ir.left >= tr.left - 0.5,
        overflow: i.scrollWidth > i.clientWidth + 1,
      };
    }),
  );
  check(
    capletFit.length >= 3 && capletFit.every((c) => c.fits),
    `caplet vol inputs stay inside their cells (${capletFit[0]?.w} ≤ ${capletFit[0]?.tdw} px) (R4-01)`,
  );
  check(
    capletFit.every((c) => !c.overflow),
    "caplet vol values are fully visible (R4-01)",
  );
  const secondCell = page.locator('[data-testid="caplet-vol-table"] tbody tr:first-child td.vol-cell').nth(1);
  await secondCell.click();
  await wait(100);
  const capletActive = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
  const secondLabel = await secondCell.locator("input").getAttribute("aria-label");
  check(capletActive === secondLabel, `clicking a caplet cell focuses its own input (${capletActive}) (R4-01)`);
  await page.keyboard.press("Escape");
  await wait(100);
  check(
    (await page.locator('[aria-label="Swaption-Cube Währung"] button', { hasText: "CHF" }).count()) === 1 &&
      (await page.locator('[aria-label="Swaption-Cube Währung"] button', { hasText: "JPY" }).count()) === 1,
    "swaption cube segment lists CHF and JPY (Markt R4-4)",
  );
  check((await page.locator('[aria-label="Caplet-Fläche"] button', { hasText: "CHF-SARON" }).count()) === 1, "caplet segment lists CHF-SARON (Markt R4-4)");
  // FX fixings editor: add from spot, market modified, undo (core R4-1)
  await page.locator('[data-testid="fx-fixing-add-spot"]').click();
  await wait(500);
  check((await page.locator('[data-testid="fx-fixings-table"] tbody tr').count()) === 1, "FX fixing added from the spot");
  check((await page.locator('[data-testid="market-chip"]').innerText()).includes("modifiziert"), "FX fixing marks the market as modified");
  await page.keyboard.press("Control+z");
  await wait(500);
  check((await page.locator('[data-testid="fx-fixings-table"]').count()) === 0, "Ctrl+Z removes the FX fixing again");

  // R7-01: roving tabindex in the market view – fixings table and every vol grid are one tab stop each
  const marketStops = await page.evaluate(() => {
    const stopsIn = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.querySelectorAll('[tabindex="0"], input:not([tabindex="-1"]), select:not([tabindex="-1"]), button:not([tabindex="-1"])').length : -1;
    };
    return {
      fixings: stopsIn('[data-testid="fixings-table"]'),
      swaption: stopsIn('[data-testid="swaption-vol-grid"]'),
      caplet: stopsIn('[data-testid="caplet-vol-table"]'),
      fxVol: stopsIn('[data-testid="fx-vol-grid"]'),
      total: document.querySelectorAll(
        'main [tabindex="0"], main input:not([tabindex="-1"]), main select:not([tabindex="-1"]), main button:not([tabindex="-1"])',
      ).length,
    };
  });
  check(
    marketStops.fixings === 1 && marketStops.swaption === 1 && marketStops.caplet === 1 && marketStops.fxVol === 1,
    `market tables and vol grids are one tab stop each (${JSON.stringify(marketStops)}) (R7-01)`,
  );
  check(marketStops.total < 80, `market view has far fewer tab stops than the 489 of round 6 (${marketStops.total}) (R7-01)`);
  await page.locator('[data-testid="fixings-table"] tbody tr[tabindex="0"]').focus();
  await page.keyboard.press("ArrowDown");
  check((await page.evaluate(() => document.activeElement?.tagName)) === "TR", "arrow keys move between fixings rows (R7-01)");
  await page.keyboard.press("Enter");
  check(
    /^Index Fixing/.test(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "")),
    "Enter on a fixings row opens its first control (R7-01)",
  );
  await page.keyboard.press("Escape");
  await wait(150);
  check((await page.evaluate(() => document.activeElement?.tagName)) === "TR", "Esc returns to the fixings row (R7-01)");
  await page.keyboard.press("Tab");
  check(
    (await page.evaluate(() => document.activeElement?.closest('[data-testid="fixings-table"]') === null)) === true,
    "one Tab leaves the fixings table (241 Tabs in round 6) (R7-01)",
  );
  await page.locator('[data-testid="swaption-vol-grid"] [role="gridcell"]').first().focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  const cellPos = await page.evaluate(() => `${document.activeElement?.getAttribute("data-r")},${document.activeElement?.getAttribute("data-c")}`);
  check(cellPos === "1,1", `arrow keys move between swaption grid cells (${cellPos}) (R7-01)`);
  await page.keyboard.press("Enter");
  check(
    /^Swaption-Vol /.test(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "")),
    "Enter on a grid cell edits its value (R7-01)",
  );
  await page.keyboard.press("Escape");
  await wait(150);
  check((await page.evaluate(() => document.activeElement?.getAttribute("role"))) === "gridcell", "Esc returns to the grid cell (R7-01)");

  // R8-03: ↵ in a grid cell commits the value and returns the focus to the cell (not to body)
  const activeLabel = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
  const activeTag = () => page.evaluate(() => document.activeElement?.tagName ?? "");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+a");
  await page.keyboard.type("70");
  await page.keyboard.press("Enter");
  await wait(200);
  check(
    (await page.evaluate(() => document.activeElement?.getAttribute("role"))) === "gridcell",
    "↵ in a vol cell commits and returns to the grid cell (R8-03)",
  );
  check((await page.locator('[data-testid="swaption-vol-edited"]').count()) === 1, "the keyboard-committed vol edit flags the cube as geändert (R8-03)");
  await page.keyboard.press("Control+z");
  await wait(300);
  check((await page.locator('[data-testid="swaption-vol-edited"]').count()) === 0, "Ctrl+Z reverts the vol edit again");
  // R8-02: every FX pair keeps exactly one grid tab stop, also after Ctrl+End on the largest surface
  await page.locator('[data-testid="fx-vol-grid"] [role="gridcell"]').first().focus();
  await page.keyboard.press("Control+End");
  const fxPairButtons = await page.locator('[data-testid="fx-vol-pairs"] button').allInnerTexts();
  const fxStopsPerPair = [];
  for (const label of fxPairButtons) {
    await page.locator('[data-testid="fx-vol-pairs"] button', { hasText: label }).click();
    await wait(80);
    fxStopsPerPair.push(await page.evaluate(() => document.querySelectorAll('[data-testid="fx-vol-grid"] [role="gridcell"][tabindex="0"]').length));
  }
  check(
    fxStopsPerPair.length >= 3 && fxStopsPerPair.every((n) => n === 1),
    `every FX-vol surface keeps exactly one grid tab stop after a pair switch (${fxStopsPerPair.join(",")}) (R8-02)`,
  );
  await page.locator('[data-testid="fx-vol-pairs"] button').first().click();
  // R8-01: every control of a fixings row is keyboard-reachable – Tab cycles the row, ↵ commits the value and returns to the row
  await page.locator('[data-testid="fixings-table"] tbody tr[tabindex="0"]').focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  check(/^Datum Fixing/.test(await activeLabel()), `Tab inside a fixings row moves from the index to the date field (${await activeLabel()}) (R8-01)`);
  for (let hop = 0; hop < 4 && !/^Wert Fixing/.test(await activeLabel()); hop++) await page.keyboard.press("Tab");
  check(/^Wert Fixing/.test(await activeLabel()), `Tab reaches the fixing value field (${await activeLabel()}) (R8-01)`);
  await page.keyboard.press("Control+a");
  await page.keyboard.type("2,5");
  await page.keyboard.press("Enter");
  await wait(300);
  check((await activeTag()) === "TR", `↵ in the fixing value commits and returns to the row (${await activeTag()}) (R8-01 / R8-03)`);
  check(
    (await page.locator('[data-testid="fixings-modified"]').count()) === 1,
    "a fixing value changed by keyboard only flags the fixings as geändert (R8-01)",
  );
  check(
    (await page.evaluate(() => document.activeElement?.closest('[data-testid="fixings-table"]') !== null)) === true,
    "the focused row is still inside the fixings table (no remount) (R8-01)",
  );
  await page.keyboard.press("Enter");
  for (let hop = 0; hop < 5 && !/entfernen$/.test(await activeLabel()); hop++) await page.keyboard.press("Tab");
  check(/^Fixing \d+ entfernen$/.test(await activeLabel()), `Tab reaches the remove button of the row (${await activeLabel()}) (R8-01)`);
  await page.keyboard.press("Tab");
  check(/^Index Fixing/.test(await activeLabel()), "Tab after the last control cycles back to the index select (R8-01)");
  await page.keyboard.press("Shift+Tab");
  check(/entfernen$/.test(await activeLabel()), "Shift+Tab cycles backwards within the row (R8-01)");
  await page.keyboard.press("Escape");
  await wait(150);
  check((await activeTag()) === "TR", "Esc leaves the control back to the row (R8-01)");
  await page.keyboard.press("Control+z");
  await wait(300);
  check((await page.locator('[data-testid="fixings-modified"]').count()) === 0, "Ctrl+Z reverts the keyboard fixing edit");
  check(
    /↵ übernimmt und kehrt zur Zeile zurück/.test(await page.locator('[data-testid="fixings-keys-hint"]').innerText()),
    "fixings hint documents the ↵ return (R8-03)",
  );
  // R9-04: removing a row by keyboard (↵ → Tab to ✕ → ↵) lands on the neighbour row, not on body
  // (the table is paged – the count text „n Fixings“ shrinks, the visible row count stays)
  const fixingCountBefore = await page.locator('[data-testid="fixings-count"]').innerText();
  await page.locator('[data-testid="fixings-row-first"]').focus();
  await page.keyboard.press("Enter");
  for (let hop = 0; hop < 5 && !/entfernen$/.test(await activeLabel()); hop++) await page.keyboard.press("Tab");
  check(/^Fixing \d+ entfernen$/.test(await activeLabel()), "Tab reaches ✕ of the first fixings row (R9-04)");
  await page.keyboard.press("Enter");
  await wait(400);
  const afterRemove = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    inTable: !!document.activeElement?.closest('[data-testid="fixings-table"]'),
    modified: document.querySelectorAll('[data-testid="fixings-modified"]').length,
  }));
  check(
    afterRemove.tag === "TR" &&
      afterRemove.inTable &&
      afterRemove.modified === 1 &&
      (await page.locator('[data-testid="fixings-count"]').innerText()) !== fixingCountBefore,
    `removing a fixing by keyboard focuses the neighbour row (${afterRemove.tag}, in table ${afterRemove.inTable}, modified ${afterRemove.modified}) (R9-04)`,
  );
  await page.keyboard.press("Control+z");
  await wait(300);
  check(
    (await page.locator('[data-testid="fixings-modified"]').count()) === 0 &&
      (await page.locator('[data-testid="fixings-count"]').innerText()) === fixingCountBefore,
    "Ctrl+Z restores the removed fixing row (R9-04)",
  );
  // R10-02: FX fixings with two rows (positional keys) – removing the first by keyboard lands on the survivor, not on „+ Zeile“
  await page.locator('[data-testid="fx-fixing-add"]').click();
  await wait(200);
  await page.locator('[data-testid="fx-fixing-add"]').click();
  await wait(300);
  check((await page.locator('[data-testid="fx-fixings-table"] tbody tr').count()) === 2, "two FX-fixing rows for the neighbour check (R10-02)");
  await page.locator('[data-testid="fx-fixings-table"] tbody tr').first().focus();
  await page.keyboard.press("Enter");
  for (let hop = 0; hop < 5 && !/entfernen$/.test(await activeLabel()); hop++) await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await wait(400);
  const fxAfterRemove = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    inTable: !!document.activeElement?.closest('[data-testid="fx-fixings-table"]'),
    rows: document.querySelectorAll('[data-testid="fx-fixings-table"] tbody tr').length,
  }));
  check(
    fxAfterRemove.tag === "TR" && fxAfterRemove.inTable && fxAfterRemove.rows === 1,
    `removing FX fixing 1 of 2 by keyboard focuses the remaining row (${fxAfterRemove.tag}, in table ${fxAfterRemove.inTable}, rows ${fxAfterRemove.rows}) (R10-02)`,
  );
  // FX fixings: the only row removed by keyboard → focus on „+ Zeile“ of the FX-fixings card
  await page.locator('[data-testid="fx-fixings-table"] tbody tr').first().focus();
  await page.keyboard.press("Enter");
  for (let hop = 0; hop < 5 && !/entfernen$/.test(await activeLabel()); hop++) await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await wait(400);
  check(
    (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "fx-fixing-add" &&
      (await page.locator('[data-testid="fx-fixings-table"]').count()) === 0,
    "removing the last FX fixing by keyboard focuses „+ Zeile“ (R9-04)",
  );

  // Markt R8-1: "+ Währung" registers a currency in the workstation register – "+ Kurve" then offers it; undo removes it
  await chord(page, "c");
  await page.locator('[data-testid="add-currency"]').click();
  await wait(200);
  check((await page.locator('[data-testid="add-currency-form"]').count()) === 1, "+ Währung opens the register form (Markt R8-1)");
  await page.locator('[data-testid="add-currency-code"]').fill("HUF");
  await page.locator('[data-testid="add-currency-ois"]').fill("HUFONIA");
  await page.locator('[data-testid="add-currency-ibor"]').fill("BUBOR-6M");
  check(
    /2 Indizes HUFONIA, BUBOR-6M · Konventionen HUF/.test(await page.locator('[data-testid="add-currency-preview"]').innerText()),
    "+ Währung previews the envelope (Markt R8-1)",
  );
  await page.locator('[data-testid="add-currency-submit"]').click();
  await wait(400);
  check(
    (await page.locator(".toast", { hasText: "Registriert: 2 Indizes HUFONIA, BUBOR-6M" }).count()) === 1,
    "+ Währung toast names the registration (Markt R8-1)",
  );
  check(
    (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "add-curve",
    "after + Währung the focus is on + Kurve (R7-03 pattern)",
  );
  await page.locator('[data-testid="add-curve"]').click();
  await wait(200);
  check((await page.locator('[data-testid="add-curve-ccy"] option[value="HUF"]').count()) === 1, "+ Kurve offers the registered currency (Markt R8-1)");
  // R9-F2: the form preselects the currency just registered (not DKK, the first without a curve alphabetically)
  check((await page.locator('[data-testid="add-curve-ccy"]').inputValue()) === "HUF", "+ Kurve preselects the currency just registered (R9-F2)");
  // R9-02: opening the form hands the focus to its first field; Esc closes it and returns to the button
  check(
    (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "add-curve-ccy",
    "+ Kurve hands the focus to its first field (R9-02)",
  );
  // R10-01: Esc in the inline number field „Spot“ – first press restores the typed value and keeps the focus, second closes the form
  await page.locator('[data-testid="add-curve-spot"]').focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("9,99");
  await page.keyboard.press("Escape");
  await wait(150);
  const spotAfterEsc = await page.evaluate(() => ({
    focus: document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName,
    formOpen: document.querySelectorAll('[data-testid="add-curve-form"]').length,
    value: document.querySelector('[data-testid="add-curve-spot"]')?.value,
  }));
  check(
    spotAfterEsc.focus === "add-curve-spot" && spotAfterEsc.formOpen === 1 && spotAfterEsc.value !== "9,99",
    `Esc in the Spot field restores the value and keeps the focus in the field (${JSON.stringify(spotAfterEsc)}) (R10-01)`,
  );
  await page.keyboard.press("Escape");
  await wait(200);
  check(
    (await page.locator('[data-testid="add-curve-form"]').count()) === 0 &&
      (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "add-curve",
    "the second Esc from the Spot field closes the + Kurve form and returns the focus to + Kurve (R10-01)",
  );
  await page.locator('[data-testid="add-curve"]').click();
  await wait(200);
  await page.keyboard.press("Escape");
  await wait(200);
  check(
    (await page.locator('[data-testid="add-curve-form"]').count()) === 0 &&
      (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "add-curve",
    "Esc in the + Kurve form closes it and returns the focus to + Kurve (R9-02)",
  );
  await page.locator('[data-testid="add-currency"]').click();
  await wait(200);
  check(
    (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "add-currency-code",
    "+ Währung hands the focus to its first field (R9-02)",
  );
  check(!(await page.locator('[data-testid="add-currency-form"]').innerText()).includes("`"), "+ Währung form shows no literal backticks (R9-05)");
  await page.keyboard.press("Escape");
  await wait(200);
  check((await page.locator('[data-testid="add-currency-form"]').count()) === 0, "Esc in the + Währung form closes it (R9-02)");
  // R9-F1: the index token of the registered index is understood by the quick entry (no curve yet → the curve hint, not „Unbekanntes Token“)
  await page.keyboard.press("Control+k");
  await page.keyboard.type("irs huf 5y pay 6% 100m bubor6m");
  await wait(300);
  // without a HUF curve the entry is an error preview (`.preview[role=alert]`), not a trade item – both are checked
  const hufPreview = await page.locator(".palette .preview, .palette .item").first().innerText();
  check(
    !/Unbekanntes Token/.test(hufPreview) && /Keine Kurve für HUF|Kurve HUF-BUBOR-6M fehlt/.test(hufPreview),
    `quick entry knows the registered index token bubor6m (${hufPreview.slice(0, 90)}) (R9-F1)`,
  );
  await page.keyboard.press("Escape");
  await wait(200);
  // Markt R10-3: cap / swaption take an [index] token – preview names the caplet / underlying index
  await page.keyboard.press("Control+k");
  await page.keyboard.type("cap 2y 3% 10m euribor3m");
  await wait(300);
  const capPreview = await page.locator(".palette .preview, .palette .item").first().innerText();
  check(
    /Cap EUR 2Y/.test(capPreview) && /· EURIBOR-3M/.test(capPreview) && !/Unbekanntes Token/.test(capPreview),
    `cap accepts an index token (${capPreview.slice(0, 80)}) (Markt R10-3)`,
  );
  await page.keyboard.press("Control+a");
  await page.keyboard.type("swpt 1y5y payer 3% 10m estr");
  await wait(300);
  const swptIdxPreview = await page.locator(".palette .preview, .palette .item").first().innerText();
  check(
    /Underlying ESTR/.test(swptIdxPreview) && !/Unbekanntes Token/.test(swptIdxPreview),
    `swaption accepts an index token (${swptIdxPreview.slice(0, 90)}) (Markt R10-3)`,
  );
  await page.keyboard.press("Escape");
  await wait(200);
  await page.locator('[data-testid="add-curve"]').click();
  await wait(200);
  await page.locator("button.btn", { hasText: "Abbrechen" }).click();
  await page.keyboard.press("Control+z");
  await wait(300);
  await page.locator('[data-testid="add-curve"]').click();
  await wait(200);
  check((await page.locator('[data-testid="add-curve-ccy"] option[value="HUF"]').count()) === 0, "Ctrl+Z removes the registration again (Markt R8-1)");
  await page.locator("button.btn", { hasText: "Abbrechen" }).click();
  await chord(page, "m");

  // + Kurve (Markt R6-5): a DKK OIS curve from quotes – conventions from the core registry, then a DKK swap via the palette
  // a snapshot of the market *before* the DKK curve – the auditor's file the treasurer imports later (R7-F1)
  const [snapPreDownload] = await Promise.all([page.waitForEvent("download"), page.locator('[data-testid="snapshot-export"]').click()]);
  const snapPrePath = join(tmpdir(), `deriva-e2e-snapshot-pre-dkk-${port}.json`);
  await snapPreDownload.saveAs(snapPrePath);
  await chord(page, "c");
  await page.locator('[data-testid="add-curve"]').click();
  await wait(300);
  check((await page.locator('[data-testid="add-curve-form"]').count()) === 1, "+ Kurve opens the curve form (R6-5)");
  await page.locator('[data-testid="add-curve-ccy"]').selectOption("DKK");
  await wait(200);
  const addIndex = await page.locator('[data-testid="add-curve-index"]').inputValue();
  check(addIndex === "DESTR", `DKK defaults to its OIS index (${addIndex}) (R6-5)`);
  await page.locator('[data-testid="add-curve-spot"]').fill("7,46");
  await page.locator('[data-testid="add-curve-submit"]').focus();
  await page.keyboard.press("Enter");
  await wait(900);
  check((await page.locator('[data-testid="curve-tab-DKK-DESTR"]').count()) === 1, "the new DKK-DESTR curve appears as a tab (R6-5)");
  check((await page.locator(".toast", { hasText: "Kurve DKK-DESTR aus 6 Quotes angelegt" }).count()) === 1, "toast confirms the added curve (R6-5)");
  check((await page.locator('[data-testid="market-modified-chip"]').count()) === 1, "an added curve counts as modifiziert (R6-5)");
  check(
    (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "curve-tab-DKK-DESTR",
    "after Kurve anlegen (keyboard) the focus is on the new curve's tab (R7-03)",
  );
  await page.keyboard.press("Control+k");
  await page.keyboard.type("irs dkk 5y pay 3% 10m");
  await wait(300);
  const dkkPreview = await page.locator(".palette .item").first().innerText();
  check(/Payer-Swap DKK 5Y/.test(dkkPreview), `quick entry prices a DKK swap once the curve exists (${dkkPreview.slice(0, 60)}) (R6-1 / R6-5)`);
  check(
    /DESTR \(Kurve vorhanden; CIBOR-6M ohne Kurve\)/.test(dkkPreview) && !/⚠/.test(dkkPreview),
    `the default form picks the index with a curve and says so in the preview (${dkkPreview.slice(40, 120)}) (R7-F2)`,
  );
  await page.keyboard.press("Enter");
  await wait(700);
  check((await page.locator('[data-testid="pv-kpi"], .kpi').first().count()) >= 1, "DKK swap opens in the pricing workspace (R6-5)");
  check((await page.locator('[data-testid="pricing-error"]').count()) === 0, "the default-form DKK swap is priced, not 'Fehler' (R7-F2)");
  check(
    (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Bezeichnung",
    "after the palette quick entry the focus is on the first editor field (R7-03)",
  );
  await page.keyboard.press("Escape"); // leave the field so the chords below work
  await wait(100);
  check(
    (await page.locator('select[aria-label="Währung"]').inputValue()) === "DKK" && (await page.locator('select[aria-label="Index"]').inputValue()) === "DESTR",
    "editor shows DKK / DESTR for the new-currency swap instead of EUR / EURIBOR-3M (R7-02)",
  );
  check(
    (await page.locator('select[aria-label="Collateral-Währung"] option', { hasText: "DKK-CSA" }).count()) === 1,
    "collateral select offers DKK-CSA (R7-02)",
  );
  check(
    (await page.locator('select[aria-label="Währung"] option', { hasText: "NOK (ohne Kurve)" }).count()) === 1,
    "currency select lists registered currencies without a curve as such (R7-02)",
  );
  const dkkTradeId = await page.locator(".card h3 .mono.ellipsis").first().innerText();
  // R8-05: `d` duplicates the trade and leaves the focus on „Bezeichnung“; the copy is deleted again
  await page.keyboard.press("d");
  await wait(500);
  check((await page.locator(".toast", { hasText: "Dupliziert:" }).count()) === 1, "d duplicates the selected trade");
  check((await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Bezeichnung", "after d the focus is on „Bezeichnung“ (R8-05)");
  // R10-03: the toast's ✕ activated by keyboard hands the focus back to where it came from (the editor field), never to body
  await page.locator('.toast button[aria-label="Meldung schließen"]').last().focus();
  await page.keyboard.press("Enter");
  await wait(300);
  const afterToastClose = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    label: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.id ?? "",
  }));
  check(
    afterToastClose.tag !== "BODY" && (afterToastClose.label === "Bezeichnung" || afterToastClose.label === "main"),
    `toast ✕ by keyboard returns the focus to its origin (${afterToastClose.tag} ${afterToastClose.label}) (R10-03)`,
  );
  await page.locator('input[aria-label="Bezeichnung"]').focus();
  await page.keyboard.press("Escape");
  await wait(100);
  await page.keyboard.press("Shift+D");
  await wait(400);
  check((await page.locator(".toast", { hasText: "Gelöscht:" }).count()) >= 1, "the duplicate is deleted again");
  await page.keyboard.press("Control+k");
  await page.keyboard.type(dkkTradeId);
  await wait(200);
  await page.keyboard.press("Enter");
  await wait(400);
  await page.keyboard.press("Escape");
  // Markt R8-3: par risk covers the "+ Kurve" curve – no silent zero, the difference note stays the convexity explanation
  const parCard = page.locator('[data-testid="par-risk-card"]');
  if ((await parCard.locator("button.collapse-btn[aria-expanded='false']").count()) === 1) await parCard.locator("button.collapse-btn").click();
  await wait(150);
  check((await page.locator('[data-testid="par-risk-coverage"]').count()) === 0, "no coverage warning – the added DKK curve carries quotes (Markt R8-3)");
  await parCard.locator("button.btn.xs", { hasText: "Berechnen" }).click();
  await page
    .locator('[data-testid="par-risk"]')
    .waitFor({ timeout: 15000 })
    .catch(() => undefined);
  const parText = await page.locator('[data-testid="par-risk"]').innerText();
  const parTotal = await page.locator('[data-testid="par-risk"] .kpi .value').first().innerText();
  check(/DKK-DESTR · Σ/.test(parText) && !/^0 EUR$/.test(parTotal.trim()), `par risk of the DKK swap bumps the added curve (total ${parTotal}) (Markt R8-3)`);
  check(
    (await page.locator('[data-testid="par-risk-diff-note"]').innerText()) === "Konvexität der Quotes / Kurvenkopplung",
    "the difference explanation is shown only when every curve has quotes (Markt R8-3)",
  );
  await parCard.locator("button.collapse-btn").click();
  // Markt R9-1: the export carries the bootstrap specs of the "+ Kurve" curve (`quotes`); a re-import bumps them in par risk
  await chord(page, "m");
  const [snapDkkDownload] = await Promise.all([page.waitForEvent("download"), page.locator('[data-testid="snapshot-export"]').click()]);
  const snapDkkPath = join(tmpdir(), `deriva-e2e-snapshot-dkk-${port}.json`);
  await snapDkkDownload.saveAs(snapDkkPath);
  const snapDkkDoc = JSON.parse(readFileSync(snapDkkPath, "utf8"));
  const dkkQuoteIds = Array.isArray(snapDkkDoc.quotes) ? snapDkkDoc.quotes.map((q) => q.curveId) : [];
  const dkkEntry = snapDkkDoc.quotes?.find?.((q) => q.curveId === "DKK-DESTR");
  check(
    !!dkkEntry && dkkEntry.spec.index === "DESTR" && dkkEntry.spec.quotes.length === 6,
    `snapshot export carries the quotes block of the added curve (${JSON.stringify(dkkQuoteIds)}) (Markt R9-1)`,
  );
  // R10-F1: the sample curves' bootstrap specs travel too (once each), so a re-import keeps par risk for the EUR book
  check(
    ["EUR-ESTR", "EUR-EURIBOR-6M", "EUR-EURIBOR-3M", "USD-SOFR"].every((id) => dkkQuoteIds.includes(id)) && new Set(dkkQuoteIds).size === dkkQuoteIds.length,
    `snapshot export carries the sample curves' bootstrap specs (${dkkQuoteIds.length} curves) (R10-F1)`,
  );
  check(
    (await page.locator(".toast", { hasText: /Bootstrap-Quotes für \d+ Kurven \(.*DKK-DESTR.*\)/ }).count()) === 1,
    "export toast names the curves whose quotes travel with the file (Markt R9-1 / R10-F1)",
  );
  await page.locator('[data-testid="snapshot-import"]').setInputFiles(snapDkkPath);
  await wait(1200);
  check(
    (await page.locator(".toast", { hasText: /Bootstrap-Quotes für \d+ Kurven \(Par-Risiko\)/ }).count()) === 1,
    "import toast reports the stored bootstrap quotes (Markt R9-1 / R10-F1)",
  );
  check(
    /Bootstrap-Quotes: \d+ Kurven/.test(await page.locator('[data-testid="snapshot-import-note"]').innerText()),
    "market view import note counts the imported bootstrap quotes (Markt R10-2)",
  );
  // R10-F1: the EUR sample trade keeps its par risk under the re-imported export (no „0 von 4“)
  await page.keyboard.press("Control+k");
  await page.keyboard.type("IRS-0001");
  await wait(200);
  await page.keyboard.press("Enter");
  await wait(400);
  await page.keyboard.press("Escape");
  const parCardEur = page.locator('[data-testid="par-risk-card"]');
  if ((await parCardEur.locator("button.collapse-btn[aria-expanded='false']").count()) === 1) await parCardEur.locator("button.collapse-btn").click();
  await wait(150);
  check(
    (await page.locator('[data-testid="par-risk-coverage"]').count()) === 0 && (await page.locator('[data-testid="par-risk-inconsistent"]').count()) === 0,
    "import mode: IRS-0001 has every EUR curve covered by consistent snapshot specs (R10-F1)",
  );
  await parCardEur.locator("button.btn.xs", { hasText: "Berechnen" }).click();
  await page
    .locator('[data-testid="par-risk"]')
    .waitFor({ timeout: 20000 })
    .catch(() => undefined);
  const parTextEur = await page.locator('[data-testid="par-risk"]').innerText();
  const parTotalEur = Number((await page.locator('[data-testid="par-risk"] .kpi .value').first().innerText()).replace(/[^\d-]/g, ""));
  check(
    /EUR-ESTR · Σ/.test(parTextEur) && Math.abs(parTotalEur) > 3000 && Math.abs(parTotalEur) < 12000,
    `par risk of IRS-0001 under the re-imported export bumps the sample specs (total ${parTotalEur}) (R10-F1)`,
  );
  await parCardEur.locator("button.collapse-btn").click();
  await chord(page, "m");
  await page.keyboard.press("Control+k");
  await page.keyboard.type(dkkTradeId);
  await wait(200);
  await page.keyboard.press("Enter");
  await wait(400);
  await page.keyboard.press("Escape");
  const parCardQ = page.locator('[data-testid="par-risk-card"]');
  if ((await parCardQ.locator("button.collapse-btn[aria-expanded='false']").count()) === 1) await parCardQ.locator("button.collapse-btn").click();
  await wait(150);
  check(
    (await page.locator('[data-testid="par-risk-coverage"]').count()) === 0,
    "import mode: no coverage warning – the snapshot carried the DKK quotes (Markt R9-1)",
  );
  await parCardQ.locator("button.btn.xs", { hasText: "Berechnen" }).click();
  await page
    .locator('[data-testid="par-risk"]')
    .waitFor({ timeout: 15000 })
    .catch(() => undefined);
  const parTextQ = await page.locator('[data-testid="par-risk"]').innerText();
  const parTotalQ = await page.locator('[data-testid="par-risk"] .kpi .value').first().innerText();
  check(
    /DKK-DESTR · Σ/.test(parTextQ) && !/^0 EUR$/.test(parTotalQ.trim()),
    `par risk bumps the imported snapshot's DKK curve via its quotes block (total ${parTotalQ}) (Markt R9-1)`,
  );
  await parCardQ.locator("button.collapse-btn").click();
  // R7-F1: import a snapshot without the DKK curve → the trade cannot be priced (error names the snapshot, R8-06) → Zum Sample-Markt → reload → priced again, spot present
  await chord(page, "m");
  await page.locator('[data-testid="snapshot-import"]').setInputFiles(snapPrePath);
  await wait(1200);
  await chord(page, "b");
  const dkkRow = page.locator(`tr[data-id="${dkkTradeId}"]`);
  check((await dkkRow.locator('[data-testid="valuation-error"]').count()) === 1, "DKK trade shows Fehler while the imported snapshot lacks the curve (R7-F1)");
  const dkkErrTitle = (await dkkRow.locator('[data-testid="valuation-error"]').getAttribute("title")) ?? "";
  check(
    /der importierte Snapshot enthält keine DKK-Kurve – Snapshot mit Kurve importieren oder „Zum Sample-Markt“ wechseln/.test(dkkErrTitle) &&
      !/„\+ Kurve“/.test(dkkErrTitle),
    `under an imported snapshot the repair hint names the snapshot and „Zum Sample-Markt“, not the locked „+ Kurve“ (${dkkErrTitle.slice(0, 80)}) (R8-06)`,
  );
  await chord(page, "c");
  check(
    /nach „Zum Sample-Markt“ wieder aktiv/.test((await page.locator('[data-testid="curve-tab-DKK-DESTR"]').getAttribute("title")) ?? ""),
    "the locked extra-curve tab explains how it becomes active again (R8-06)",
  );
  // R10-F1: the workstation export carries the sample specs – under its re-import the EUR trade keeps full par-risk coverage
  await page.keyboard.press("Control+k");
  await page.keyboard.type("IRS-0001");
  await wait(200);
  await page.keyboard.press("Enter");
  await wait(400);
  const parCardImp = page.locator('[data-testid="par-risk-card"]');
  if ((await parCardImp.locator("button.collapse-btn[aria-expanded='false']").count()) === 1) await parCardImp.locator("button.collapse-btn").click();
  await wait(150);
  check(
    (await page.locator('[data-testid="par-risk-coverage"]').count()) === 0,
    "import mode: the re-imported workstation export covers every EUR curve with its sample specs (R10-F1)",
  );
  await parCardImp.locator("button.collapse-btn").click();
  // Markt R8-3: a snapshot *without* a quotes block (foreign EoD) – the par-risk card says „0 von n“ instead of a silent zero
  const snapPreNoQuotes = JSON.parse(readFileSync(snapPrePath, "utf8"));
  delete snapPreNoQuotes.quotes;
  const snapPreNoQuotesPath = join(tmpdir(), `deriva-e2e-snapshot-pre-dkk-noquotes-${port}.json`);
  writeFileSync(snapPreNoQuotesPath, JSON.stringify(snapPreNoQuotes), "utf8");
  await chord(page, "m");
  await page.locator('[data-testid="snapshot-import"]').setInputFiles(snapPreNoQuotesPath);
  await wait(1200);
  check(
    /Bootstrap-Quotes: 0 Kurven/.test(await page.locator('[data-testid="snapshot-import-note"]').innerText()),
    "market view says the file carries no bootstrap quotes (Markt R10-2)",
  );
  await page.keyboard.press("Control+k");
  await page.keyboard.type("IRS-0001");
  await wait(200);
  await page.keyboard.press("Enter");
  await wait(400);
  const parCardNoQ = page.locator('[data-testid="par-risk-card"]');
  if ((await parCardNoQ.locator("button.collapse-btn[aria-expanded='false']").count()) === 1) await parCardNoQ.locator("button.collapse-btn").click();
  await wait(150);
  check(
    /Par-Risiko nur für Kurven mit Quotes \(0 von \d+\)/.test(
      (await page
        .locator('[data-testid="par-risk-coverage"]')
        .innerText()
        .catch(() => "")) ?? "",
    ),
    "import mode: par-risk card names curves without quotes instead of a silent zero (Markt R8-3)",
  );
  await parCardNoQ.locator("button.collapse-btn").click();
  await chord(page, "m");
  await page.locator('[data-testid="snapshot-leave"]').click();
  await wait(900);
  check((await page.locator('[data-testid="fx-spot-row-EURDKK"]').count()) === 1, "after Zum Sample-Markt the EUR/DKK spot is back in the spot table (R7-F1)");
  await page.reload({ waitUntil: "networkidle" });
  await wait(800);
  await chord(page, "m");
  check((await page.locator('[data-testid="fx-spot-row-EURDKK"]').count()) === 1, "the EUR/DKK spot survives the reload with the curve (R7-F1)");
  await chord(page, "c");
  check((await page.locator('[data-testid="curve-tab-DKK-DESTR"]').isDisabled()) === false, "DKK curve tab enabled after import → leave → reload (R7-F1)");
  await chord(page, "b");
  check(
    (await page.locator(`tr[data-id="${dkkTradeId}"] [data-testid="valuation-error"]`).count()) === 0,
    "DKK trade priced again after import → leave → reload (R7-F1)",
  );
  // R7-F1 / R7-2 / R8-04: "+ Paar" adds an FX spot for a new pair (↵ in the rate field submits), "+ Fläche" a swaption cube for the new currency
  await chord(page, "m");
  await page.locator('[data-testid="add-spot"]').click();
  await page.locator('[data-testid="add-spot-pair"]').fill("EURSEK");
  await page.locator('[data-testid="add-spot-rate"]').fill("11,2");
  await page.keyboard.press("Enter");
  await wait(500);
  check((await page.locator('[data-testid="add-spot-form"]').count()) === 0, "↵ in the + Paar rate field submits the spot (R8-04)");
  check((await page.locator('[data-testid="fx-spot-row-EURSEK"]').count()) === 1, "+ Paar adds the EUR/SEK spot row (R7-F1)");
  check((await page.locator(".toast", { hasText: "Spot EUR/SEK 11,2000 angelegt" }).count()) === 1, "+ Paar toast with Rückgängig (R7-F1)");
  check((await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "add-spot", "after ↵-submit the focus is back on + Paar (R8-04)");
  await page.locator('[data-testid="add-vol"]').click();
  await wait(200);
  check((await page.locator('[data-testid="add-vol-ccy"]').inputValue()) === "DKK", "+ Fläche proposes the currency with a curve but no cube (R7-2)");
  await page.locator('[data-testid="add-vol-submit"]').click();
  await wait(700);
  check(
    /Swaption-ATM-Vols DKK/i.test(await page.locator('[data-testid="swaption-vol-card"]').innerText()), // innerText carries the CSS uppercase
    "+ Fläche creates and selects the DKK swaption cube (R7-2)",
  );
  check((await page.locator('[data-testid="swaption-vol-edited"]').innerText()) === "angelegt", "the new cube carries the badge angelegt (R7-2)");
  // R8-F1: the swaption follows the curve-backed index (DESTR) and prices – the preview says so
  await page.keyboard.press("Control+k");
  await page.keyboard.type("swpt dkk 1y5y payer 3% 10m");
  await wait(300);
  const swptPreview = await page.locator(".palette .item").first().innerText();
  check(!/⚠/.test(swptPreview), "swaption preview no longer warns about a missing DKK cube (R7-2)");
  check(
    /Underlying DESTR \(Kurve vorhanden; CIBOR-6M ohne Kurve\)/.test(swptPreview),
    `swaption preview names the curve-backed underlying index (${swptPreview.slice(40, 130)}) (R8-F1)`,
  );
  await page.keyboard.press("Enter");
  await wait(800);
  check((await page.locator('[data-testid="pricing-error"]').count()) === 0, "the DKK swaption prices on DESTR instead of failing on CIBOR-6M (R8-F1)");
  check(
    (await page.locator('select[aria-label="Underlying-Index"]').inputValue()) === "DESTR",
    "swaption editor offers the Underlying-Index field with DESTR (R8-F1)",
  );
  const dkkSwptId = await page.locator(".card h3 .mono.ellipsis").first().innerText();
  await page.keyboard.press("Escape");
  await wait(100);
  // R8-F2: "+ Paar" spot and "+ Fläche" cube survive import → Zum Sample-Markt → reload; the import toast lists what stays
  await chord(page, "m");
  await page.locator('[data-testid="snapshot-import"]').setInputFiles(snapPrePath);
  await wait(1200);
  const importToast = (await page.locator(".toast", { hasText: "importiert · ID" }).allInnerTexts()).join(" ");
  check(
    /gemerkt, nach „Zum Sample-Markt“ wieder aktiv: .*Kurve DKK-DESTR.*Spot EUR\/SEK.*Swaption-Cube DKK/.test(importToast),
    `import toast names the kept structural extras (${importToast.slice(0, 160)}) (R8-F2)`,
  );
  check(!/verworfen:/.test(importToast), "nothing is reported as discarded when only structural extras exist (R8-F2)");
  await page.locator('[data-testid="snapshot-leave"]').click();
  await wait(900);
  await page.reload({ waitUntil: "networkidle" });
  await wait(800);
  await chord(page, "m");
  check((await page.locator('[data-testid="fx-spot-row-EURSEK"]').count()) === 1, "+ Paar spot survives import → leave → reload (R8-F2)");
  check(
    (await page.locator('[aria-label="Swaption-Cube Währung"] button', { hasText: "DKK" }).count()) === 1,
    "+ Fläche cube survives import → leave → reload (R8-F2)",
  );
  await chord(page, "b");
  check(
    (await page.locator(`tr[data-id="${dkkSwptId}"] [data-testid="valuation-error"]`).count()) === 0,
    "DKK swaption priced after import → leave → reload (R8-F2)",
  );
  check(
    !/Level 3|Fallback/.test(await page.locator(`tr[data-id="${dkkSwptId}"]`).innerText()),
    "DKK swaption without Level-3 fallback after the round trip (R8-F2)",
  );
  // clean up the extras: remove the spot and the cube
  await chord(page, "m");
  await page.locator('[data-testid="fx-spot-remove-EURSEK"]').click();
  await wait(400);
  check((await page.locator('[data-testid="fx-spot-row-EURSEK"]').count()) === 0, "the added spot can be removed at its row (R8-F2)");
  await page.locator('[aria-label="Swaption-Cube Währung"] button', { hasText: "DKK" }).click();
  await wait(200);
  await page.locator('[data-testid="swaption-vol-reset"]').click();
  await wait(500);
  check((await page.locator('[aria-label="Swaption-Cube Währung"] button', { hasText: "DKK" }).count()) === 0, "Entfernen drops the added cube again (R7-2)");
  // clean up: delete the DKK trades, remove the curve (spot goes with it) → back to the unmodified sample market
  await chord(page, "b");
  await page.locator(`tr[data-id="${dkkSwptId}"]`).click();
  await wait(200);
  await page.keyboard.press("Shift+D");
  await wait(400);
  check((await page.locator(".toast", { hasText: `Gelöscht: ${dkkSwptId}` }).count()) === 1, "DKK swaption deleted again");
  await page.locator(`tr[data-id="${dkkTradeId}"]`).click();
  await wait(200);
  await page.keyboard.press("Shift+D");
  await wait(400);
  check((await page.locator(".toast", { hasText: `Gelöscht: ${dkkTradeId}` }).count()) === 1, "DKK trade deleted again");
  await chord(page, "c");
  await page.locator('[data-testid="curve-tab-DKK-DESTR"]').click();
  await wait(200);
  page.once("dialog", (d) => d.accept());
  await page.locator('[data-testid="remove-curve"]').click();
  await wait(800);
  check((await page.locator('[data-testid="curve-tab-DKK-DESTR"]').count()) === 0, "the added curve can be removed (R6-5)");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("irs sek 5y pay 3% 10m");
  await wait(300);
  const sekPreview = await page.locator(".palette").innerText();
  check(
    /Keine Kurve für SEK im Markt/.test(sekPreview) && /\+ Kurve/.test(sekPreview),
    "quick entry refuses a currency without a curve and names + Kurve (R6-1)",
  );
  await page.keyboard.press("Escape");
  await wait(200);
  await chord(page, "m");
  check((await page.locator('[data-testid="fx-spot-row-EURDKK"]').count()) === 0, "removing the curve removes its spot too – no orphaned EUR/DKK row (R7-F1)");
  check(
    (await page.locator('[data-testid="market-modified-chip"]').count()) === 0 ||
      !(await page.locator('[data-testid="market-chip"]').innerText()).includes("modifiziert"),
    "market back to the sample after removing the curve (R6-5 / R7-F1)",
  );

  // Snapshot round trip (R5-F2): export → change a quote → import the same file → identical id, no "modifiziert", quote table reset
  const snapId0 = await page.locator('[data-testid="snapshot-id"]').innerText();
  check(/^[0-9a-f]{12,}$/.test(snapId0), `market view shows the snapshot id (${snapId0}) (R5-F2)`);
  const [snapDownload] = await Promise.all([page.waitForEvent("download"), page.locator('[data-testid="snapshot-export"]').click()]);
  const snapPath = join(tmpdir(), `deriva-e2e-snapshot-${port}.json`);
  await snapDownload.saveAs(snapPath);
  await chord(page, "c");
  await page.locator("button.btn", { hasText: "Quotes +10 bp" }).click();
  await wait(500);
  await chord(page, "m");
  const snapIdMod = await page.locator('[data-testid="snapshot-id"]').innerText();
  check(snapIdMod !== snapId0, "quote change changes the snapshot id");
  check((await page.locator('[data-testid="market-chip"]').innerText()).includes("modifiziert"), "quote change flags the market as modifiziert");
  await page.locator('[data-testid="snapshot-import"]').setInputFiles(snapPath);
  await wait(1200);
  check((await page.locator('[data-testid="snapshot-id"]').innerText()) === snapId0, `re-import of the exported snapshot reproduces the id ${snapId0} (R5-F2)`);
  check((await page.locator(".toast", { hasText: `importiert · ID ${snapId0}` }).count()) === 1, "import toast names the snapshot id (R5-F2)");
  check((await page.locator('[data-testid="snapshot-imported"]').count()) === 1, "market view marks the imported source (R5-F2)");
  check(!(await page.locator('[data-testid="market-chip"]').innerText()).includes("modifiziert"), "imported market is not 'modifiziert' (R5-F2)");
  check((await page.locator('[data-testid="market-chip"]').innerText()).includes("importiert"), "market chip says importiert (R5-F2)");
  await chordO(page, "r");
  check(
    (await page.locator('[data-testid="audit-hashes"]').innerText()).includes(`Snapshot ${snapId0}`),
    "report snapshot id equals the market id after import (R5-F2)",
  );
  await chord(page, "c");
  check(
    (await page.locator('[data-testid="curves-import-note"]').count()) === 1,
    "curves view explains that quotes are not editable for an imported market (R5-F2)",
  );
  check((await page.locator("button.btn", { hasText: "Quotes +10 bp" }).isDisabled()) === true, "quote bump buttons disabled for an imported market (R5-F2)");
  // R6-04: quote cells, interpolation select and Turn-of-Year "Anwenden" are disabled with a title, not just toasted
  const lockState = await page.evaluate(() => {
    const q = document.querySelector('[data-testid="quotes-table"] tbody input');
    const sel = document.querySelector('[data-testid="interp-select"]');
    const toy = document.querySelector('[data-testid="toy-apply"]');
    return {
      quoteDisabled: q instanceof HTMLInputElement ? q.disabled : null,
      quoteTitle: q?.closest("td")?.getAttribute("title") ?? "",
      selDisabled: sel instanceof HTMLSelectElement ? sel.disabled : null,
      selTitle: sel?.getAttribute("title") ?? "",
      toyDisabled: toy instanceof HTMLButtonElement ? toy.disabled : null,
      toyTitle: toy?.getAttribute("title") ?? "",
      addCurveDisabled: document.querySelector('[data-testid="add-curve"]')?.disabled ?? null,
    };
  });
  check(
    lockState.quoteDisabled === true && lockState.selDisabled === true && lockState.toyDisabled === true && lockState.addCurveDisabled === true,
    `import mode disables quote cells, interpolation, Turn-of-Year and + Kurve (${JSON.stringify(lockState)}) (R6-04)`,
  );
  check(
    /importierten Snapshot/.test(lockState.quoteTitle) && /importierten Snapshot/.test(lockState.selTitle) && /importierten Snapshot/.test(lockState.toyTitle),
    "disabled import-mode controls explain the lock in their title (R6-04)",
  );
  // R9-03 / Markt R9-2: „+ Währung“ under an imported snapshot – the toast names the way to a curve, the focus lands on an enabled control
  await page.locator('[data-testid="add-currency"]').click();
  await wait(200);
  await page.locator('[data-testid="add-currency-code"]').fill("RON");
  await page.locator('[data-testid="add-currency-ois"]').fill("ROBOR-ON");
  await page.locator('[data-testid="add-currency-submit"]').click();
  await wait(400);
  const ronToast = (await page.locator(".toast", { hasText: "Registriert: Index ROBOR-ON" }).allInnerTexts()).join(" ");
  check(
    /im Import-Modus ist „\+ Kurve“ gesperrt: nach „Zum Sample-Markt“ mit „\+ Kurve“ eine RON-Kurve anlegen oder einen Snapshot mit RON-Kurve importieren/.test(
      ronToast,
    ) && !/jetzt mit „\+ Kurve“/.test(ronToast),
    `+ Währung toast under an import names Zum Sample-Markt / snapshot instead of the locked + Kurve (${ronToast.slice(0, 120)}) (R9-03)`,
  );
  const ronFocus = await page.evaluate(() => ({
    testId: document.activeElement?.getAttribute("data-testid"),
    disabled: document.activeElement?.disabled ?? false,
  }));
  check(
    ronFocus.testId === "curves-leave-import" && !ronFocus.disabled,
    `after + Währung under an import the focus is on „Zum Sample-Markt“ (${ronFocus.testId}) (R9-03)`,
  );
  await page.keyboard.press("Control+z");
  await wait(300);
  // the registration toast may still be visible – the form's „Registriert per + Währung“ list is the source of truth
  await page.locator('[data-testid="add-currency"]').click();
  await wait(200);
  check(
    (await page.locator('[data-testid="add-currency-registered"]').count()) === 0 ||
      !(await page.locator('[data-testid="add-currency-registered"]').innerText()).includes("RON"),
    "Ctrl+Z removes the RON registration again",
  );
  await page.keyboard.press("Escape");
  await wait(200);
  // Markt R8-5: a snapshot curve outside the sample set gets a read-only tab „(aus Snapshot)“ with pillars and meta
  const snapDoc = JSON.parse(readFileSync(snapPath, "utf8"));
  const estrCurve = snapDoc.curves.find((c) => c.id === "EUR-ESTR");
  const snapNok = {
    ...snapDoc,
    curves: [...snapDoc.curves, { ...estrCurve, id: "NOK-NOWA", currency: "NOK" }],
    discountCurveId: { ...snapDoc.discountCurveId, NOK: "NOK-NOWA" },
    fxSpots: { ...snapDoc.fxSpots, EURNOK: 11.62 },
  };
  const snapNokPath = join(tmpdir(), `deriva-e2e-snapshot-nok-${port}.json`);
  writeFileSync(snapNokPath, JSON.stringify(snapNok), "utf8");
  await chord(page, "m");
  await page.locator('[data-testid="snapshot-import"]').setInputFiles(snapNokPath);
  await wait(1200);
  await chord(page, "c");
  const nokTab = page.locator('[data-testid="curve-tab-NOK-NOWA"]');
  check((await nokTab.count()) === 1 && (await nokTab.isDisabled()) === false, "snapshot curve NOK-NOWA has an enabled tab in the curves view (Markt R8-5)");
  check(/\(aus Snapshot\)/.test(await nokTab.innerText()), "the snapshot curve tab is marked „(aus Snapshot)“ (Markt R8-5)");
  await nokTab.click();
  await wait(300);
  check((await page.locator('[data-testid="curve-snapshot-badge"]').count()) === 1, "snapshot curve card carries the read-only badge (Markt R8-5)");
  check((await page.locator('[data-testid="quotes-snapshot-note"]').count()) === 1, "snapshot curve shows the note instead of a quote table (Markt R8-5)");
  check((await page.locator('[data-testid="pillar-table"] tbody tr').count()) > 2, "snapshot curve shows its pillars (Markt R8-5)");
  check((await page.locator(".chart canvas").count()) >= 1, "snapshot curve renders the forwards chart (Markt R8-5)");
  // Markt R8-1: the API's register envelope (indices / conventions / calendars) reaches the workstation – CZK prices
  const snapCzk = {
    ...snapDoc,
    curves: [...snapDoc.curves, { ...estrCurve, id: "CZK-CZEONIA", currency: "CZK" }],
    discountCurveId: { ...snapDoc.discountCurveId, CZK: "CZK-CZEONIA" },
    fxSpots: { ...snapDoc.fxSpots, EURCZK: 24.6 },
    // Markt R10-2: the API's `quotes` block for the snapshot curve – shown read-only on its tab
    quotes: [
      {
        curveId: "CZK-CZEONIA",
        spec: {
          id: "CZK-CZEONIA",
          currency: "CZK",
          index: "CZEONIA",
          quotes: [
            { type: "OIS", tenor: "1Y", rate: 0.041 },
            { type: "OIS", tenor: "2Y", rate: 0.0415 },
            { type: "OIS", tenor: "5Y", rate: 0.042 },
            { type: "OIS", tenor: "10Y", rate: 0.043 },
          ],
        },
      },
    ],
    calendars: [{ id: "CZ", name: "Prag", holidays: ["2027-07-05", "2027-07-06", "2027-09-28", "2027-10-28", "2027-11-17"] }],
    indices: [
      {
        name: "CZEONIA",
        currency: "CZK",
        type: "OIS",
        tenor: "1D",
        dayCount: "ACT/360",
        fixingCalendar: "CZ",
        fixingLag: 0,
        businessDayConvention: "ModifiedFollowing",
        endOfMonth: false,
        curveId: "CZK-CZEONIA",
      },
      {
        name: "PRIBOR-6M",
        currency: "CZK",
        type: "IBOR",
        tenor: "6M",
        dayCount: "ACT/360",
        fixingCalendar: "CZ",
        fixingLag: 2,
        businessDayConvention: "ModifiedFollowing",
        endOfMonth: true,
        curveId: "CZK-PRIBOR-6M",
      },
    ],
    conventions: [
      {
        currency: "CZK",
        fixedFrequency: "1Y",
        fixedDayCount: "ACT/360",
        floatIndex: "PRIBOR-6M",
        floatFrequency: "6M",
        calendar: "CZ",
        spotLag: 2,
        oisIndex: "CZEONIA",
        oisFixedFrequency: "1Y",
        oisFixedDayCount: "ACT/360",
        oisPaymentLag: 2,
      },
    ],
  };
  const snapCzkPath = join(tmpdir(), `deriva-e2e-snapshot-czk-${port}.json`);
  writeFileSync(snapCzkPath, JSON.stringify(snapCzk), "utf8");
  await chord(page, "m");
  await page.locator('[data-testid="snapshot-import"]').setInputFiles(snapCzkPath);
  await wait(1200);
  check(
    (await page.locator(".toast", { hasText: "registriert: 2 Indizes CZEONIA, PRIBOR-6M · Konventionen CZK · Kalender CZ" }).count()) === 1,
    "import toast names the registered envelope (Markt R8-1)",
  );
  // Markt R10-2: the snapshot curve's tab shows the imported quotes read-only and says so
  await chord(page, "c");
  await page.locator('[data-testid="curve-tab-CZK-CZEONIA"]').click();
  await wait(300);
  check(
    (await page.locator('[data-testid="snapshot-quotes-table"] tbody tr').count()) === 4 &&
      (await page.locator('[data-testid="snapshot-quotes-badge"]').innerText()) === "aus Snapshot",
    "snapshot curve tab lists the imported bootstrap quotes read-only with the „aus Snapshot“ badge (Markt R10-2)",
  );
  const czkNote = await page.locator('[data-testid="quotes-snapshot-note"]').innerText();
  check(
    /mit Bootstrap-Quotes für das Par-Risiko/.test(czkNote) && /Bearbeiten nach „Zum Sample-Markt“/.test(czkNote) && !/ohne Bootstrap-Quotes/.test(czkNote),
    `snapshot curve note names the quotes and the way to edit them (${czkNote.slice(0, 100)}) (Markt R10-2)`,
  );
  await chord(page, "m");
  check(
    /Bootstrap-Quotes: 1 Kurve \(CZK-CZEONIA\)/.test(await page.locator('[data-testid="snapshot-import-note"]').innerText()),
    "market view names the curve with imported bootstrap quotes (Markt R10-2)",
  );
  await page.keyboard.press("Control+k");
  await page.keyboard.type("irs czk 5y pay 4% 100m");
  await wait(300);
  const czkPreview = await page.locator(".palette .item").first().innerText();
  check(
    /Payer-Swap CZK 5Y/.test(czkPreview) && /CZEONIA \(Kurve vorhanden; PRIBOR-6M ohne Kurve\)/.test(czkPreview),
    `quick entry accepts CZK from the envelope (${czkPreview.slice(0, 100)}) (Markt R8-1)`,
  );
  await page.keyboard.press("Enter");
  await wait(800);
  check((await page.locator('[data-testid="pricing-error"]').count()) === 0, "the CZK swap is priced on the imported CZK-CZEONIA curve (Markt R8-1)");
  check(
    (await page.locator('select[aria-label="Index"]').inputValue()) === "CZEONIA",
    "editor shows the registered CZEONIA index for the CZK swap (Markt R8-1)",
  );
  const czkTradeId = await page.locator(".card h3 .mono.ellipsis").first().innerText();
  await page.keyboard.press("Escape");
  await wait(100);
  // reload while imported: the envelope is re-registered before the market is rebuilt
  await page.reload({ waitUntil: "networkidle" });
  await wait(800);
  await chord(page, "b");
  check(
    (await page.locator(`tr[data-id="${czkTradeId}"] [data-testid="valuation-error"]`).count()) === 0,
    "CZK swap still priced after the reload (envelope re-registered) (Markt R8-1)",
  );
  await page.locator(`tr[data-id="${czkTradeId}"]`).click();
  await wait(200);
  await page.keyboard.press("Shift+D");
  await wait(400);
  // the workstation export carries the envelope
  const [snapCzkOutDownload] = await Promise.all([
    page.waitForEvent("download"),
    (await (await chord(page, "m"), page.locator('[data-testid="snapshot-export"]'))).click(),
  ]);
  const snapCzkOutPath = join(tmpdir(), `deriva-e2e-snapshot-czk-out-${port}.json`);
  await snapCzkOutDownload.saveAs(snapCzkOutPath);
  const czkOut = JSON.parse(readFileSync(snapCzkOutPath, "utf8"));
  check(
    Array.isArray(czkOut.conventions) &&
      czkOut.conventions.some((c) => c.currency === "CZK") &&
      czkOut.indices.some((i) => i.name === "CZEONIA") &&
      czkOut.calendars.some((c) => c.id === "CZ"),
    "snapshot export carries the register envelope (indices, conventions, calendars) (Markt R8-1)",
  );
  // help overlay names the four "+" paths
  await page.keyboard.press("?");
  await wait(300);
  const helpText = await page.locator('[data-testid="hotkey-overlay"]').innerText();
  check(/\+ Fläche/.test(helpText) && /\+ Paar/.test(helpText) && /\+ Währung/.test(helpText), "help overlay names + Fläche, + Paar and + Währung (R8)");
  await page.keyboard.press("Escape");
  await wait(200);
  // back to the plain snapshot for the rest of the flow
  await page.locator('[data-testid="snapshot-import"]').setInputFiles(snapPath);
  await wait(1200);
  check((await page.locator('[data-testid="snapshot-id"]').innerText()) === snapId0, "plain snapshot re-imported for the remaining checks");
  // R6-F1: an FX-spot edit on the imported market is an override – flagged, undoable, persisted, never a silent id change
  await chord(page, "m");
  const spotInput = page.locator('input[aria-label="Spot EURUSD"]');
  const spotBefore = await spotInput.inputValue();
  await spotInput.focus();
  await spotInput.fill("1,25");
  await page.keyboard.press("Enter");
  await wait(600);
  const spotId1 = await page.locator('[data-testid="snapshot-id"]').innerText();
  check(spotId1 !== snapId0, "spot override changes the snapshot id visibly (R6-F1)");
  check(
    (await page.locator('[data-testid="market-chip"]').innerText()).includes("modifiziert"),
    "spot override flags the imported market as modifiziert (R6-F1)",
  );
  check((await page.locator('[data-testid="spot-edited"]').count()) === 1, "spot row marks the override against the snapshot value (R6-F1)");
  check(
    (await page.locator('[data-testid="market-reset"]').innerText()).includes("Auf Snapshot zurücksetzen"),
    "reset button offers the way back to the snapshot (R6-F1)",
  );
  await page.reload({ waitUntil: "networkidle" });
  await wait(800);
  await chord(page, "m");
  check((await page.locator('input[aria-label="Spot EURUSD"]').inputValue()) === "1,25", "spot override survives the reload (R6-F1)");
  check((await page.locator('[data-testid="snapshot-id"]').innerText()) === spotId1, "snapshot id after reload equals the id before it (R6-F1)");
  check((await page.locator('[data-testid="snapshot-imported"]').count()) === 1, "the import itself survives the reload with the override (R6-F1)");
  await page.locator('[data-testid="market-reset"]').click();
  await wait(600);
  check((await page.locator('[data-testid="snapshot-id"]').innerText()) === snapId0, `Auf Snapshot zurücksetzen restores the snapshot id ${snapId0} (R6-F1)`);
  check((await page.locator('input[aria-label="Spot EURUSD"]').inputValue()) === spotBefore, "reset restores the snapshot spot (R6-F1)");
  check(
    !(await page.locator('[data-testid="market-chip"]').innerText()).includes("modifiziert"),
    "after the reset the imported market is not modifiziert (R6-F1)",
  );
  await page.keyboard.press("Control+z");
  await wait(600);
  check((await page.locator('input[aria-label="Spot EURUSD"]').inputValue()) === "1,25", "Ctrl+Z after the reset brings the spot override back (R6-F1)");
  // the reload emptied the undo stack – the override itself is removed via the reset button, which is the persisted way back
  await page.locator('[data-testid="market-reset"]').click();
  await wait(600);
  check(
    (await page.locator('[data-testid="snapshot-id"]').innerText()) === snapId0,
    "Auf Snapshot zurücksetzen after the undo removes the override again (R6-F1)",
  );
  await chord(page, "c");
  // a valuation-date change is refused unless confirmed – the import is never dropped silently
  let dateDialog = "";
  page.once("dialog", (d) => {
    dateDialog = d.message();
    d.dismiss();
  });
  await page.keyboard.press("Shift+T");
  await wait(200);
  // the snapshot carries 30.09.2026 (= Monatsende), so "−1 Tag" is the preset that actually changes the date
  await page.locator('[data-testid="valdate-popover"] .chip', { hasText: "−1 Tag" }).click();
  await wait(600);
  check(/importierten Snapshot/.test(dateDialog) && /verwirft den Snapshot/.test(dateDialog), "date change with an imported snapshot asks first (R5-F2)");
  check((await page.locator(".toast", { hasText: "bleibt geladen" }).count()) >= 1, "declining the date change is explained in a toast (R5-F2)");
  check((await page.locator('[data-testid="valdate-popover"]').count()) === 1, "declined date change keeps the popover open");
  await page.keyboard.press("Escape");
  await wait(200);
  check((await page.locator(".statusbar").innerText()).includes("Bewertungstag 30.09.2026"), "declined date change keeps the valuation date (R5-F2)");
  await chord(page, "m");
  check((await page.locator('[data-testid="snapshot-imported"]').count()) === 1, "declined date change keeps the imported snapshot (R5-F2)");
  check((await page.locator('[data-testid="snapshot-id"]').innerText()) === snapId0, "declined date change keeps the snapshot id (R5-F2)");
  // a snapshot with another valuation date sets the app's date – statusbar, chip and report agree with the market
  const snapJson = JSON.parse(readFileSync(snapPath, "utf8"));
  const snapOther = { ...snapJson, valuationDate: "2026-10-30" };
  const snapOtherPath = join(tmpdir(), `deriva-e2e-snapshot-other-${port}.json`);
  writeFileSync(snapOtherPath, JSON.stringify(snapOther), "utf8");
  await page.locator('[data-testid="snapshot-import"]').setInputFiles(snapOtherPath);
  await wait(1200);
  check(
    (await page.locator(".statusbar").innerText()).includes("Bewertungstag 30.10.2026"),
    "snapshot with another valuation date sets the app's date (R5-F2)",
  );
  check((await page.locator('[data-testid="market-chip"]').innerText()).includes("30.10.2026"), "market chip shows the snapshot's date (R5-F2)");
  await chordO(page, "r");
  check(
    (await page.locator('[data-testid="report-header"]').innerText()).includes("Bewertungstag 30.10.2026"),
    "report header shows the snapshot's valuation date (R5-F2)",
  );
  await chord(page, "m");
  // German causes for invalid snapshots (R5-06)
  const badSnaps = [
    [`deriva-e2e-bad1-${port}.json`, JSON.stringify({ curves: [] }), /Schema „fehlt“ unbekannt, erwartet deriva.market\/1/],
    [`deriva-e2e-bad2-${port}.json`, JSON.stringify({ ...snapJson, valuationDate: "2026-13-45" }), /Ungültiges Datum: 2026-13-45/],
    [`deriva-e2e-bad3-${port}.json`, JSON.stringify({ schema: "deriva.market/1", valuationDate: "2026-09-03" }), /Snapshot unvollständig – Feld/],
    [`deriva-e2e-bad4-${port}.json`, "{bad json", /kein gültiges JSON/],
  ];
  const dismissToasts = async () => {
    for (let i = 0; i < 6 && (await page.locator(".toast .close").count()) > 0; i++) {
      await page.locator(".toast .close").first().click();
      await wait(60);
    }
  };
  for (const [name, content, re] of badSnaps) {
    await dismissToasts();
    const p = join(tmpdir(), name);
    writeFileSync(p, content, "utf8");
    await page.locator('[data-testid="snapshot-import"]').setInputFiles(p);
    await wait(500);
    const toastTexts = await page.locator(".toast").allInnerTexts();
    const t = toastTexts.filter((x) => x.startsWith("Import fehlgeschlagen")).pop();
    check(
      !!t && re.test(t) && !/Unsupported|Cannot convert|undefined|Datum: Ungültiges/.test(t),
      `invalid snapshot ${name} → German cause (${t?.slice(0, 90)}) (R5-06)`,
    );
  }
  check((await page.locator(".statusbar").innerText()).includes("Bewertungstag 30.10.2026"), "invalid snapshots leave the imported market untouched (R5-06)");
  // a snapshot without FX vol surfaces: optional collections default to empty, and the palette warns for every FX option (Markt R5-2)
  const snapNoFxVols = { ...snapJson, fxVols: undefined };
  const snapNoFxVolsPath = join(tmpdir(), `deriva-e2e-snapshot-nofxvols-${port}.json`);
  writeFileSync(snapNoFxVolsPath, JSON.stringify(snapNoFxVols), "utf8");
  await dismissToasts();
  await page.locator('[data-testid="snapshot-import"]').setInputFiles(snapNoFxVolsPath);
  await wait(1200);
  check(
    (await page.locator(".toast", { hasText: "importiert · ID" }).count()) === 1,
    "snapshot without fxVols imports (optional collections default to empty) (R5-06)",
  );
  await page.keyboard.press("Control+k");
  await page.keyboard.type("fxo usdchf call 0.80 1m 6m");
  await wait(250);
  const fxoPreview = await page.locator(".palette .item").first().innerText();
  check(
    /keine FX-Vol-Fläche für USD\/CHF \(Fallback 8 %, Level 3 – in der Marktansicht mit „\+ Fläche“ anlegen\)/.test(fxoPreview),
    `fxo preview flags a pair without vol surface (${fxoPreview.slice(0, 90)}) (Markt R5-2)`,
  );
  await page.keyboard.press("Escape");
  await wait(200);
  // back to the sample market at the previous date
  const dateBeforeLeave = (await page.locator(".statusbar").innerText()).match(/Bewertungstag (\d{2}\.\d{2}\.\d{4})/)?.[1];
  await page.locator('[data-testid="snapshot-leave"]').click();
  await wait(800);
  check((await page.locator('[data-testid="snapshot-imported"]').count()) === 0, "Zum Sample-Markt leaves the import (R5-F2)");
  // R6-F2: leaving (like importing / discarding) is one undoable action – the toast offers Rückgängig, Ctrl+Z restores the snapshot
  check(
    (await page.locator(".toast", { hasText: "Sample-Markt aus den Quotes" }).locator("button", { hasText: "Rückgängig" }).count()) === 1,
    "leave toast offers Rückgängig (R6-F2)",
  );
  await page.keyboard.press("Control+z");
  await wait(800);
  check((await page.locator('[data-testid="snapshot-imported"]').count()) === 1, "Ctrl+Z after Zum Sample-Markt restores the imported snapshot (R6-F2)");
  check((await page.locator(".toast", { hasText: "Rückgängig: Zum Sample-Markt" }).count()) === 1, "undo toast names the market-source action (R6-F2)");
  check(
    (await page.locator(".statusbar").innerText()).includes(`Bewertungstag ${dateBeforeLeave}`),
    `undo of the leave restores the snapshot's valuation date (${dateBeforeLeave}) (R6-F2)`,
  );
  await page.locator('[data-testid="snapshot-leave"]').click();
  await wait(800);
  check((await page.locator('[data-testid="snapshot-imported"]').count()) === 0, "leave again for the rest of the flow");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("stichtag 30.09.2026");
  await wait(200);
  await page.keyboard.press("Enter");
  await wait(900);
  check((await page.locator(".statusbar").innerText()).includes("Bewertungstag 30.09.2026"), "valuation date restored after the snapshot flow");
  // with the sample market (FX surfaces for every pair) the same preview carries no warning (Markt R5-2)
  await page.keyboard.press("Control+k");
  await page.keyboard.type("fxo usdchf call 0.80 1m 6m");
  await wait(250);
  check(
    !/keine FX-Vol-Fläche/.test(await page.locator(".palette .item").first().innerText()),
    "fxo preview has no warning when the pair has a surface (Markt R5-2)",
  );
  await page.keyboard.press("Escape");
  await wait(200);

  // Toast stack is capped at four (N-09)
  await chord(page, "b");
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("c");
    await wait(60);
  }
  await wait(200);
  check((await page.locator(".toast").count()) <= 4, `toast stack capped (${await page.locator(".toast").count()})`);
  await wait(3500);
  // Blotter: portfolio report export entries, 'ohne UTI' chip, quote expiry badge
  await page.locator('[data-testid="export-menu-btn"]').click();
  await wait(150);
  check((await page.locator('[data-testid="export-portfolio-json"]').count()) === 1, "portfolio report (JSON) download button present");
  check((await page.locator('[data-testid="export-portfolio-md"]').count()) === 1, "portfolio report (Markdown) download button present");
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await wait(200);
  check((await page.locator('[data-testid="filter-no-uti"]').count()) === 1, "'ohne UTI' filter chip present");
  await page.locator('[data-testid="filter-no-uti"]').click();
  await wait(200);
  check((await page.locator("td.id-cell", { hasText: "FRA-0001" }).count()) === 0, "'ohne UTI' hides trades carrying a UTI");
  await page.locator('[data-testid="filter-no-uti"]').click();
  await wait(200);

  // Light theme – all views
  await page.keyboard.press("t");
  await wait(200);
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === "light", "theme toggle");
  const segContrast = await page.evaluate(() => {
    const lum = (c) => {
      const [r, g, b] = c
        .match(/\d+(\.\d+)?/g)
        .map(Number)
        .slice(0, 3)
        .map((v) => v / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const el = document.querySelector('.seg button[aria-pressed="true"]');
    if (!el) return 0;
    const fg = lum(getComputedStyle(el).color);
    // composite against the card surface (bg-1)
    const bg = lum(getComputedStyle(document.querySelector(".card")).backgroundColor);
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  });
  check(segContrast >= 4.5, `light theme: active segment text contrast ≥ 4.5 (${segContrast.toFixed(2)}) (N-08)`);
  for (const [k, name] of VIEWS) {
    await chord(page, k);
    await page.screenshot({ path: join(outDir, `light-${name}.png`) });
  }
  await chord(page, "b");
  await page.screenshot({ path: join(outDir, "03-light.png") });
  await page.keyboard.press("t");

  // Help overlay: dialog, focus trap, background hotkeys suspended, no empty kbd boxes
  await page.keyboard.press("?");
  await wait(200);
  check((await page.locator('[role="dialog"][aria-label="Tastenkürzel"]').count()) === 1, "hotkey overlay");
  check(
    (await page
      .locator('[role="dialog"][aria-label="Tastenkürzel"] [aria-modal="true"], [role="dialog"][aria-label="Tastenkürzel"][aria-modal="true"]')
      .count()) >= 1,
    "overlay is aria-modal",
  );
  check(
    (await page.evaluate(() => document.querySelector('[role="dialog"][aria-label="Tastenkürzel"]')?.contains(document.activeElement))) === true,
    "overlay takes focus",
  );
  check(
    (await page.evaluate(
      () => Array.from(document.querySelectorAll('[role="dialog"][aria-label="Tastenkürzel"] kbd')).filter((k) => k.textContent.trim() === "").length,
    )) === 0,
    "help sheet: no empty kbd boxes (N-04)",
  );
  check(
    (await page.locator('[role="dialog"][aria-label="Tastenkürzel"]').innerText()).includes("FX-Fixings (MtM-Reset)"),
    "help sheet names the FX-fixings card (Markt R5)",
  );
  await page.keyboard.press("t");
  await wait(150);
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "background hotkeys suspended while overlay open");
  await page.keyboard.press("Escape");
  await wait(200);
  check((await page.locator('[role="dialog"][aria-label="Tastenkürzel"]').count()) === 0, "esc closes overlay");

  // Context menu: roving focus with aria-activedescendant (N-06), focus returns to the row (R3-08)
  const firstRow = page.locator('tr[data-nav="trade"]').first();
  await firstRow.focus();
  const rowId = await firstRow.getAttribute("data-id");
  await page.locator("td.id-cell").first().click({ button: "right" });
  await wait(200);
  check((await page.locator('[role="menu"][aria-activedescendant]').count()) === 1, "context menu carries aria-activedescendant");
  check((await page.evaluate(() => document.activeElement?.getAttribute("role"))) === "menuitem", "context menu focuses the active menuitem");
  await page.keyboard.press("Escape");
  await wait(300);
  check((await page.evaluate(() => document.activeElement?.getAttribute("data-id"))) === rowId, `context menu returns focus to the row (${rowId}) (R3-08)`);
  // Palette: id-like query without an exact match does not jump to another trade (R3-F5)
  await page.keyboard.press("Control+k");
  await page.keyboard.type("FRA-0099");
  await wait(200);
  check((await page.locator('[data-testid="palette-no-trade"]').count()) === 1, "palette says 'Kein Trade FRA-0099' instead of a fuzzy hit (R3-F5)");
  await page.keyboard.press("Escape");
  await wait(200);

  // Persistence: reload keeps the book and shows the restore toast
  const beforeReload = (await page.locator(".statusbar").innerText()).match(/(\d+) Trades/)?.[1];
  await page.reload({ waitUntil: "networkidle" });
  await wait(600);
  const afterReload = (await page.locator(".statusbar").innerText()).match(/(\d+) Trades/)?.[1];
  check(afterReload === beforeReload, `trades persisted across reload (${beforeReload} → ${afterReload})`);
  check((await page.locator(".toast", { hasText: "lokalem Speicher" }).count()) === 1, "restore toast");
  // R9-F4: the restore toast is information only – no destructive „Zurücksetzen“ as the first tab stop after every reload
  check((await page.locator(".toast button", { hasText: "Zurücksetzen" }).count()) === 0, "restore toast carries no reset action (R9-F4)");
  check(
    /Beispielportfolio über die Palette/.test(await page.locator(".toast", { hasText: "lokalem Speicher" }).innerText()),
    "restore toast says where the sample book is loaded (R9-F4)",
  );
  // Toast actions are the first tab stops after the skip link (R4-F2)
  await page.locator("a.skip").focus();
  await page.keyboard.press("Tab");
  check(
    (await page.evaluate(() => document.activeElement?.closest(".toast-stack") !== null)) === true,
    "first Tab after the skip link lands on the toast action (R4-F2)",
  );
  check(
    (await page.evaluate(
      () => !!(document.querySelector(".toast-stack").compareDocumentPosition(document.querySelector(".app")) & Node.DOCUMENT_POSITION_FOLLOWING),
    )) === true,
    "toast stack precedes the app shell in the DOM (R4-F2)",
  );
  // R9-F4: „Beispielportfolio laden“ (palette) asks first, resets with a Rückgängig toast, Ctrl+Z brings the book back
  const tradesBeforeReset = Number(afterReload);
  page.once("dialog", (d) => {
    check(
      /^Bestand \(\d+ Trades.*\) durch das Beispielportfolio ersetzen\? \(rückgängig mit Ctrl\+Z\)$/.test(d.message()),
      `reset asks first (${d.message()}) (R9-F4)`,
    );
    void d.dismiss();
  });
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Beispielportfolio laden");
  await wait(250);
  await page.keyboard.press("Enter");
  await wait(500);
  check(Number((await page.locator(".statusbar").innerText()).match(/(\d+) Trades/)?.[1]) === tradesBeforeReset, "dismissed reset keeps the book (R9-F4)");
  page.once("dialog", (d) => void d.accept());
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Beispielportfolio laden");
  await wait(250);
  await page.keyboard.press("Enter");
  await wait(800);
  check(Number((await page.locator(".statusbar").innerText()).match(/(\d+) Trades/)?.[1]) === 13, "confirmed reset loads the 13 sample trades (R9-F4)");
  check(
    (await page.locator(".toast", { hasText: "Beispielportfolio geladen" }).locator("button", { hasText: "Rückgängig" }).count()) === 1,
    "reset toast offers Rückgängig (R9-F4)",
  );
  await page.keyboard.press("Control+z");
  await wait(800);
  check(
    Number((await page.locator(".statusbar").innerText()).match(/(\d+) Trades/)?.[1]) === tradesBeforeReset,
    `Ctrl+Z restores the book after the reset (${tradesBeforeReset} Trades) (R9-F4)`,
  );

  // 1280 px layout: no horizontal overflow with the inspector open; R9-05: no literal backticks in visible text or tooltips
  const noBackticks = (p) =>
    p.evaluate(() => ({
      text: !document.body.innerText.includes("`"),
      titles: !Array.from(document.querySelectorAll("[title]")).some((e) => (e.getAttribute("title") ?? "").includes("`")),
    }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await wait(300);
  for (const [k, name] of VIEWS) {
    await chord(page, k);
    const o = await noOverflow(page);
    check(o.page && o.main, `1280px no horizontal overflow (${name})`);
    const bt = await noBackticks(page);
    check(bt.text && bt.titles, `no literal backticks in the ${name} view (text ${bt.text}, titles ${bt.titles}) (R9-05)`);
    if (name === "Blotter" || name === "Pricing" || name === "Kurven") await page.screenshot({ path: join(outDir, `1280-${name}.png`) });
  }
  // 1280 px: the blotter toolbar collapses into one row (filter popover, icon buttons) – R3-09 / N-12
  await chord(page, "b");
  const toolbar = await page.evaluate(() => {
    const tb = document.querySelector('[data-testid="blotter-toolbar"]');
    return { height: tb?.getBoundingClientRect().height ?? 999, filterBtn: !!document.querySelector('[data-testid="filter-menu-btn"]') };
  });
  check(toolbar.filterBtn && toolbar.height <= 40, `1280px blotter toolbar is a single row (${Math.round(toolbar.height)} px)`);
  await page.locator('[data-testid="filter-menu-btn"]').click();
  await wait(200);
  check((await page.locator('[data-testid="filter-popover"] [data-testid="group-select"]').count()) === 1, "filter popover holds the grouping select");
  await page.keyboard.press("Escape");
  await wait(200);
  check((await page.locator('[data-testid="filter-popover"]').count()) === 0, "Esc closes the filter popover");
  await chord(page, "r");
  const reportFit = await noOverflow(page);
  check(reportFit.main, "1280px report market table does not overflow (R3-09)");

  // R7-04: at 1440 px the Key-Rate curve selector of an FX product (five chips) stays inside its two-column card
  await page.setViewportSize({ width: 1440, height: 900 });
  await wait(300);
  await chord(page, "b");
  const selectedBeforeKeyRate = await page.locator("table.blotter tbody tr.selected").getAttribute("data-id");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("FXO-0001");
  await wait(200);
  await page.keyboard.press("Enter");
  await wait(600);
  await chord(page, "p");
  await page
    .locator('[data-testid="keyrate-curves"]')
    .waitFor({ timeout: 5000 })
    .catch(() => undefined);
  const keyRateFit = await page.evaluate(() => {
    const seg = document.querySelector('[data-testid="keyrate-curves"]');
    const card = seg?.closest(".card");
    if (!seg || !card) return null;
    const cr = card.getBoundingClientRect();
    const btns = Array.from(seg.querySelectorAll("button"));
    return { n: btns.length, outside: btns.filter((b) => b.getBoundingClientRect().right > cr.right + 0.5).length, wrap: getComputedStyle(seg).flexWrap };
  });
  check(
    !!keyRateFit && keyRateFit.n >= 3 && keyRateFit.outside === 0 && keyRateFit.wrap === "wrap",
    `1440px Key-Rate curve chips stay inside the card (${JSON.stringify(keyRateFit)}) (R7-04)`,
  );
  // back to the trade that was selected before (the 1024-px inspector check below measures that trade)
  if (selectedBeforeKeyRate) {
    await page.keyboard.press("Control+k");
    await page.keyboard.type(selectedBeforeKeyRate);
    await wait(200);
    await page.keyboard.press("Enter");
    await wait(400);
  }

  // 1024 × 768: inspector table fits its sidebar (R5-01), FX-vol pair tabs stay inside the card, cost card does not overflow (R5-05)
  await page.setViewportSize({ width: 1024, height: 768 });
  await wait(300);
  await chord(page, "b");
  const insp1024 = await page.evaluate(() => {
    const insp = document.querySelector(".inspector");
    if (!insp) return null;
    const ir = insp.getBoundingClientRect();
    const cells = Array.from(insp.querySelectorAll("table td"));
    const clipped = cells.filter((td) => td.getBoundingClientRect().right > ir.right + 0.5).length;
    const truncated = cells.filter((td) => td.classList.contains("num") && td.scrollWidth > td.clientWidth + 1).length;
    return { w: Math.round(ir.width), cells: cells.length, clipped, truncated, scrollX: insp.scrollWidth - insp.clientWidth };
  });
  check(
    !!insp1024 && insp1024.cells >= 6 && insp1024.clipped === 0 && insp1024.truncated === 0 && insp1024.scrollX <= 1,
    `1024px inspector table fits the sidebar (${insp1024?.w} px, ${insp1024?.clipped} clipped, ${insp1024?.truncated} truncated) (R5-01)`,
  );
  await chord(page, "m");
  const fxTabs1024 = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="fx-vol-card"]');
    const btns = Array.from(document.querySelectorAll('[data-testid="fx-vol-pairs"] button'));
    if (!card) return null;
    const cr = card.getBoundingClientRect();
    return {
      n: btns.length,
      outside: btns.filter((b) => b.getBoundingClientRect().right > cr.right + 0.5 || b.getBoundingClientRect().left < cr.left - 0.5).length,
    };
  });
  check(!!fxTabs1024 && fxTabs1024.n >= 5 && fxTabs1024.outside === 0, `1024px FX-vol pair tabs stay inside the card (${fxTabs1024?.outside} outside) (R5-05)`);
  const lastPair = page.locator('[data-testid="fx-vol-pairs"] button').last();
  await lastPair.click();
  await wait(200);
  check((await lastPair.getAttribute("aria-pressed")) === "true", "1024px last FX-vol pair tab is clickable (R5-05)");
  await page.locator('[data-testid="fx-vol-pairs"] button').first().click();
  await chord(page, "r");
  await chordO(page, "r");
  const costCard1024 = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="cost-table"]')?.closest(".card");
    return card ? { overflow: card.scrollWidth - card.clientWidth } : null;
  });
  check(!!costCard1024 && costCard1024.overflow <= 1, `1024px cost-transparency card does not overflow (${costCard1024?.overflow} px) (R5-05)`);
  const o1024 = await noOverflow(page);
  check(o1024.page && o1024.main, "1024px no horizontal overflow (Report)");
  await page.screenshot({ path: join(outDir, "1024-report.png") });
  // R9-01 / R9-05: the „+ Währung“ form (with „+ Kalender“) fits the card at 1024 × 768 – no horizontal scroll, no clipped field, no backticks
  await chord(page, "c");
  await page.locator('[data-testid="add-currency"]').click();
  await wait(300);
  await page.locator('[data-testid="add-calendar"]').click();
  await wait(200);
  const ccyForm1024 = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="add-currency-form"]');
    if (!card) return null;
    const cr = card.getBoundingClientRect();
    const over = Array.from(card.querySelectorAll("input, select, textarea, button"))
      .map((el) => ({ label: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "", right: Math.round(el.getBoundingClientRect().right - cr.right) }))
      .filter((x) => x.right > 1);
    return { cardW: Math.round(cr.width), scroll: card.scrollWidth - card.clientWidth, over };
  });
  const o1024ccy = await noOverflow(page);
  check(
    !!ccyForm1024 && ccyForm1024.over.length === 0 && ccyForm1024.scroll <= 1 && o1024ccy.page && o1024ccy.main,
    `1024px + Währung form stays inside its card (${ccyForm1024?.cardW} px, over ${JSON.stringify(ccyForm1024?.over)}, main ${o1024ccy.main}) (R9-01)`,
  );
  const bt1024 = await noBackticks(page);
  check(bt1024.text && bt1024.titles, "no literal backticks in the + Währung / + Kalender form (R9-05)");
  await page.screenshot({ path: join(outDir, "1024-curves-add-currency.png") });
  await page.keyboard.press("Escape");
  await wait(200);
  check((await page.locator('[data-testid="add-currency-form"]').count()) === 0, "Esc closes the + Währung form at 1024px (R9-02)");
  await page.setViewportSize({ width: 1280, height: 800 });
  await wait(200);

  // Offline reload via the app-shell service worker (US-8.13 / R4-F3)
  const swReady = await page.evaluate(() =>
    "serviceWorker" in navigator ? Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]) : false,
  );
  check(swReady === true, "service worker registered and active (R4-F3)");
  await page.reload({ waitUntil: "networkidle" }); // controlled by the worker from now on → assets enter the cache
  await wait(800);
  check((await page.evaluate(() => !!navigator.serviceWorker.controller)) === true, "page is controlled by the service worker after a reload (R4-F3)");
  await context.setOffline(true);
  let offlineOk = false;
  try {
    await page.reload({ waitUntil: "load" });
    await wait(800);
    offlineOk = (await page.locator("h1").count()) === 1 && (await page.locator("h1").innerText()) === "DERIVA";
  } catch {
    offlineOk = false;
  }
  check(offlineOk, "offline reload renders the app from the service-worker cache (R4-F3)");
  if (offlineOk) {
    check((await page.locator('[data-testid="offline-chip"]').count()) === 1, "offline chip shown while offline (R4-F3)");
    check(Number((await page.locator(".statusbar").innerText()).match(/(\d+) Trades/)?.[1]) === Number(afterReload), "portfolio available offline");
  }
  await context.setOffline(false);
  await wait(300);

  // R6-01: a view chunk that fails to load (deploy with new hashes, network drop) → German error card with "Neu laden",
  // and "Erneut versuchen" really imports again once the chunk is reachable
  // service workers are blocked here: the precache would serve the chunk from the cache (a real deploy deletes the old cache first)
  const chunkContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "de-DE", serviceWorkers: "block" });
  const chunkPage = await chunkContext.newPage();
  const chunkErrors = [];
  chunkPage.on("pageerror", (e) => chunkErrors.push(String(e)));
  // the cache-busting retry appends "?retry=…" – the deploy simulation must block that request too (the file is gone)
  const chunkRoute = /\/assets\/ScenariosView-[^/?]*\.js(\?.*)?$/;
  await chunkPage.route(chunkRoute, (r) => r.abort());
  await chunkPage.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
  await chunkPage.keyboard.press("g");
  await chunkPage.keyboard.press("s");
  await chunkPage
    .locator('[data-testid="chunk-error"]')
    .waitFor({ timeout: 8000 })
    .catch(() => undefined);
  const chunkCard = await chunkPage.locator('[data-testid="chunk-error"]').count();
  check(chunkCard === 1, "failed view chunk shows the German error card instead of the raw engine text (R6-01)");
  if (chunkCard === 1) {
    const cardText = await chunkPage.locator('[data-testid="chunk-error"]').innerText();
    check(
      /neue Version/.test(cardText) && !/Failed to fetch|http:/.test(cardText),
      `chunk error card is German without URL (${cardText.slice(0, 80)}) (R6-01)`,
    );
    check((await chunkPage.locator('[data-testid="chunk-reload"]').innerText()) === "Neu laden", "chunk error card offers Neu laden (R6-01)");
    await chunkPage.unroute(chunkRoute);
    await chunkPage.locator('[data-testid="chunk-retry"]').click();
    await chunkPage
      .locator('[data-testid="scenario-table"]')
      .waitFor({ timeout: 8000 })
      .catch(() => undefined);
    check((await chunkPage.locator('[data-testid="scenario-table"]').count()) === 1, "Erneut versuchen re-imports the chunk and renders the view (R6-01)");
    check((await chunkPage.locator('[data-testid="chunk-error"]').count()) === 0, "error card gone after the successful retry (R6-01)");
  }
  check(chunkErrors.length === 0, `chunk failure produces no uncaught page errors (${chunkErrors.join(" | ")}) (R6-01)`);
  await chunkContext.close();

  // R7-05: a failed *library* chunk (echarts) – "Erneut versuchen" re-imports the library chunk itself with cache-busting
  const libContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "de-DE", serviceWorkers: "block" });
  const libPage = await libContext.newPage();
  const libErrors = [];
  libPage.on("pageerror", (e) => libErrors.push(String(e)));
  const libRoute = /\/assets\/echarts-[^/?]*\.js(\?.*)?$/;
  await libPage.route(libRoute, (r) => r.abort());
  await libPage.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
  await libPage.keyboard.press("g");
  await libPage.keyboard.press("c");
  await libPage
    .locator('[data-testid="chunk-error"]')
    .first()
    .waitFor({ timeout: 8000 })
    .catch(() => undefined);
  const libCards = await libPage.locator('[data-testid="chunk-error"]').count();
  check(
    libCards >= 1 && /Diagramm nicht verfügbar/i.test(await libPage.locator('[data-testid="chunk-error"]').first().innerText()),
    `failed echarts chunk shows the Diagramm error card (${libCards}) (R7-05)`,
  );
  check((await libPage.locator('[data-testid="quotes-table"]').count()) === 1, "curves view stays usable without the chart library (R7-05)");
  await libPage.unroute(libRoute);
  await libPage.locator('[data-testid="chunk-retry"]').first().click();
  await libPage
    .locator(".chart canvas")
    .first()
    .waitFor({ timeout: 8000 })
    .catch(() => undefined);
  check((await libPage.locator(".chart canvas").count()) >= 1, "Erneut versuchen re-imports the echarts chunk and renders the chart (R7-05)");
  check((await libPage.locator('[data-testid="chunk-error"]').count()) === 0, "every chart error card is gone after the retry (R7-05)");
  check(libErrors.length === 0, `library chunk failure produces no uncaught page errors (${libErrors.join(" | ")}) (R7-05)`);
  await libContext.close();

  // Offline after the FIRST online visit (R5-F4): a fresh browser context, one visit, install precaches the assets → offline reload works
  const freshContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "de-DE" });
  const fresh = await freshContext.newPage();
  await fresh.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
  const firstVisitReady = await fresh.evaluate(() =>
    "serviceWorker" in navigator ? Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]) : false,
  );
  check(firstVisitReady === true, "fresh context: service worker ready after the first visit (R5-F4)");
  const precached = await fresh.evaluate(async () => {
    const until = Date.now() + 8000;
    while (Date.now() < until) {
      for (const k of await caches.keys()) {
        const reqs = await (await caches.open(k)).keys();
        const assets = reqs.filter((r) => new URL(r.url).pathname.startsWith("/assets/")).length;
        const shell = reqs.some((r) => new URL(r.url).pathname === "/index.html");
        if (shell && assets >= 4) return { key: k, assets };
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  });
  check(!!precached && precached.assets >= 4, `fresh context: install precached the built assets (${precached?.assets ?? 0} in ${precached?.key}) (R5-F4)`);
  await freshContext.setOffline(true);
  let firstVisitOfflineOk = false;
  try {
    await fresh.reload({ waitUntil: "load" });
    await wait(800);
    firstVisitOfflineOk = (await fresh.locator("h1").count()) === 1 && (await fresh.locator("h1").innerText()) === "DERIVA";
  } catch {
    firstVisitOfflineOk = false;
  }
  check(firstVisitOfflineOk, "fresh context: offline reload after the first online visit renders the app (R5-F4)");
  if (firstVisitOfflineOk) {
    check((await fresh.locator('[data-testid="offline-chip"]').count()) === 1, "fresh context: offline chip shown (R5-F4)");
    await chord(fresh, "s");
    check((await crumb(fresh)).includes("Szenarien"), "fresh context: lazy chart view opens offline from the precache (R5-F4 / ADR-026)");
    await fresh.screenshot({ path: join(outDir, "offline-first-visit.png") });
  }
  await freshContext.setOffline(false);
  await freshContext.close();

  check(errors.length === 0, `page errors: ${errors.join(" | ")}`);
  const relevantConsole = consoleErrors.filter((m) => !/favicon|ResizeObserver loop/.test(m));
  check(relevantConsole.length === 0, `console errors/warnings: ${relevantConsole.slice(0, 5).join(" | ")}`);
} catch (e) {
  failures.push(`exception: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
} finally {
  await browser?.close();
  preview.kill();
}
if (failures.length) {
  console.error(`E2E FAILED (${failures.length} of ${checks} checks):\n - ` + failures.join("\n - "));
  process.exit(1);
}
console.log(`E2E OK (${checks} checks)`);
