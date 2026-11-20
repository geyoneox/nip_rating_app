# NIP Rating help guide

NIP Rating reads a tabbed insurance application, checks every vehicle VIN against PriceDigest, works out the class code, original cost new and deductibles, and builds the BA, IM and driver worksheets.

The pictures in this guide are drawings of each screen. The numbered red frames match the numbered steps.

## 1. Sign in

1. Open the NIP Rating app. You are sent to the sign-in page.
2. Sign in with your work account.
3. The first time you sign in you get the **User** role. To review all runs or manage the app, ask a Super Admin for the **Reviewer** or **Admin** role (see section 9).

![Top bar with the help button](/help/img/08-help-button.svg)

The **?** button in the top bar, next to your profile icon, opens this guide at any time. The profile icon has the theme switch, **Report an issue** and **Log out**.

## 2. Find your runs

A run is one uploaded application and everything worked out from it.

![Runs page](/help/img/01-runs-list.svg)

1. **New Validation** starts a new run (section 3).
2. Type in **Search runs** to find a file or insured name. Use **Status** and the date fields to narrow the list. **Clear all** removes the filters.
3. Click a run to open it.

Users see their own runs. Reviewers and Admins see every run.

## 3. Upload an application

![New Validation window](/help/img/02-new-validation.svg)

1. Click **New Validation**, then **Choose file** and pick the application. PDF, `.xlsx` and `.xls` files up to 50 MB are accepted.
2. Click **Start Extraction**. The file is uploaded and the run opens.

Tip: a PDF with bookmarks (AUTO, VEH SCHED, IM, DRIVERS LIST, ACORD) is read fastest, because only those sections are read.

## 4. Wait for the extraction

![Run page while extracting](/help/img/03-extraction.svg)

1. While the file is read, a progress bar shows how many parts are done. The page refreshes by itself. A large application takes a few minutes. You can leave the page and come back.
2. When it finishes, open **Extraction read ... pages** to see:
   - which bookmarked sections were read, and which version (base or revised) was kept for vehicles, equipment and drivers
   - how many VINs were corrected, and how many garaging addresses were filled from the premises list
   - any pages that could not be read (a yellow warning lists them)

If the extraction fails, a red message explains why. Click **Retry Extraction**.

## 5. Validate the VINs (AUTO tab)

![AUTO tab dashboard](/help/img/04-vehicles-dashboard.svg)

1. Choose the **Program Name**. The program decides the original cost new and the deductibles.
2. Click **Validate VINs (PriceDigest)**. The VINs go to PriceDigest in batches of 50. The cards update as results arrive.
3. If some VINs fail, click **Retry Failed** to try only those again. To check a few VINs only, tick them in the table and click **Validate Selected VINs**.

What the dashboard cards mean:

- **Unique VINs Queued**: different VINs sent to PriceDigest.
- **Duplicate Rows Skipped**: the same VIN listed again. Only the first row is checked.
- **Invalid VINs Skipped**: not 17 valid characters, even after the automatic clean-up.
- **Blank / Placeholder Skipped**: no VIN, or a word such as "TBD" or "Needed".
- **Trailers (Tabbed App Only)**: trailers are not sent to PriceDigest. They use the values on the application.
- **Passed / Failed / Pending**: PriceDigest results for the vehicles that were sent.

Before VINs are sent, the app fixes common reading mistakes:

- **I, O and Q**, which never appear in a VIN, become 1, 0 and 0. Look-alike letters from other alphabets become their normal letters.
- **Wrong check digit (position 9)**, on vehicles from North America: if exactly one common misread fits, the VIN is corrected. The misreads it tries are S/5, B/8, B/G, G/6, Z/2, D/0, U/V, X/K, or two characters swapped.

Every automatic change keeps the original value, so you can see and undo it.

## 6. Check failures and correct values

![Failure filters and editing](/help/img/05-failures-and-edits.svg)

1. Under **Failure breakdown & filters**, click a pill (for example **PriceDigest lookup failed**) to show only those vehicles. Click **Clear Filter ×** to see all vehicles again.
2. Click a cell to correct it: VIN, make, model, year, address, radius or cost new. Press Enter to save, or Escape to cancel. Edited cells are marked, and the original value is kept. The class code and OCN are recalculated after an edit to a rating field.
3. A **CHECK DIGIT** chip means the VIN's 9th character does not fit the rest of the VIN, so a character was probably misread. Compare it with the application, correct it, then validate it again with **Validate Selected VINs**.

Other chips in the VIN column: **DUPLICATE** (listed twice), **TRAILER** (application values only), **INVALID VIN** (cannot be sent).

## 7. Equipment (IM) and drivers

- The **IM** tab lists the equipment schedule: description, model year, serial number and amount of insurance. Repeated items are listed once.
- The **DRIVER** tab lists the drivers, with the insured details (Epic ID, policy number, broker email) at the top.

## 8. Export the worksheets

![Export buttons](/help/img/06-exports.svg)

1. Choose an export:
   - **Export BA Worksheet**: the business auto worksheet with class codes, OCN and deductibles, one row per vehicle with a VIN.
   - **Export IM Worksheet**: the inland marine worksheet with valuation and deductible.
   - **Export Default**: everything on the run in one workbook.
   - **Export Drivers CSV**: the driver list, repeats left out.
2. The file downloads to your computer. Open it in Excel and check it before you send it on.

Reviewers can open and export every run but cannot change one.

## 9. Admin tasks

![Admin page](/help/img/07-admin-people.svg)

The **Admin** menu is shown to Admins and Super Admins.

- **Reference data**: programs, the OCN lookup and class code tables. Click **Edit** on a row, change it, and **Save**.
- **Templates**: the BA and IM worksheet templates used for the exports.
- **Usage reports**: runs by status, day and program, validation failures by reason, and exports by type. Reviewers see these under **Usage reports** in the side menu.
- **People and roles** (Super Admin only):
  1. Open the **People and roles** tab. It lists everyone who uses NIP Rating.
  2. Pick **User**, **Reviewer** or **Admin** in a person's **NIP role** column and confirm. The change applies the next time they sign in.

## 10. Delete a run

On the Runs page, use the delete icon on the run's row and confirm. This removes the run, its rows and its uploaded file, and cannot be undone.

## Roles at a glance

| Role | Can do |
|---|---|
| User | Upload applications, validate, edit and export their own runs |
| Reviewer | Open and export every run, see usage reports; cannot change runs |
| Admin | Everything above for every run, plus reference data and templates |
| Super Admin | Everything, plus change people's roles |

## Getting help

Use **Report an issue** in the profile menu. Include the run's file name and what you expected to see.
