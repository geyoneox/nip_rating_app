# NIP Rating: class code, OCN and deductible rules

Implemented in `docs/functions/nip_recompute_rating.py`. Reference data is in `docs/reference-data/` (`ref_class_codes.csv`, `ref_ocn_lookup.csv`).
Items marked ASSUMED were not given by the product owner. Confirm each one before go-live.

## 1. Vehicle type detection

Two text values are lower-cased and checked with "contains".

- Type text: PriceDigest Vehicle Type. If blank or "Not Available", the application BODY_TYPE is used.
- Subtype text: PriceDigest Vehicle Subtype, or empty if blank or "Not Available".
- Trailer row: BODY_TYPE, MODEL or MAKE contains "trailer". PriceDigest is skipped. Type text is BODY_TYPE (with " trailer" added if missing). Subtype text is MODEL.
- Is Tractor: the PriceDigest Is Tractor flag, where "Yes" counts.
- If the type text is empty, no class code is given.

First match wins:

| # | Becomes | Test |
|---|---|---|
| 1 | Mobile equipment | type contains "mobile equipment", or contains "mobile" and not "auto" |
| 2 | Semi-trailer | type or subtype contains "semi-trailer", "semi trailer" or "semitrailer" |
| 3 | Utility trailer | type or subtype contains "utility trailer" |
| 4 | Trailer | type or subtype contains "trailer" |
| 5 | Tractor | Is Tractor = Yes, or type or subtype contains "tractor" |
| 6 | Truck/SUV | type or subtype contains truck, commercial, cab, chassis, suv or "sport utility" |
| 7 | Van | type contains van or minivan, or subtype contains van or cargo |
| 8 | Passenger car | type contains ppt, passenger, coupe or sedan, or "private passenger" appears in type or subtype |
| 9 | None | class code blank |

Changes from the previous behaviour:
- Test 3 matched any text containing "utility", so "Sport Utility Vehicle" became a utility trailer (69489). It now needs "utility trailer". "sport utility" was added to test 6 so those rows are rated by weight. Check this against real PriceDigest values.
- Test 2 also accepts "semitrailer" (one word). Without it the row would match test 4 and get the plain trailer code.
- A trailer row is now found from BODY_TYPE, MODEL or MAKE, not only BODY_TYPE (`nip_extract_worker.py`).

## 2. Class code

Table: `ref_class_codes` (11 rows). Vans use the truck rows.

- Mobile equipment, semi-trailer, utility trailer, trailer, passenger car: one row each, no weight.
- Tractor: GCW band (over 45,000 / up to 45,000).
- Truck/SUV and van: GVW band (45,001+, 20,001 to 45,000, 10,001 to 20,000, up to 10,000).
- Without the needed weight the class code is blank. A weight of 0 or less counts as missing. A fractional weight rounds up (20,000.5 is in the 20,001 band).
- Column: standard, special state (CA, FL, GA, TX), dump standard, dump special state.
- ASSUMED: the state is the vehicle garaging state, or the insured state if the vehicle has none.
- CONFIRMED against the old code: a vehicle is a dump when BODY_TYPE, MODEL or NET_VEH_DR_CR contains "dump", or the vehicle SIC is exactly a code in `ref_rules.dump_sic_codes` (default `79`). The match is exact, so SIC 7990 is not a dump. Ask the product owner whether SIC can be longer than two digits.
- Passenger car code is 7398 (four digits) on purpose.

## 3. Original cost new (OCN)

1. Trailer row (flagged from BODY_TYPE, MODEL or MAKE): OCN = cost new, or blank. The calculator is not used.
2. Otherwise OCN = the larger of cost new and MSRP.
3. Incomplete vehicle (PriceDigest Complete/Incomplete contains "incomplete"): MSRP is multiplied by 1.33 first.
4. With no cost and no MSRP, the OCN calculator (`ref_ocn_lookup`, for the run's program) is used. It never runs for Treepro, so a Treepro vehicle with no cost and no MSRP has a blank OCN (this is why examples 12 and 15 differ):
   - year at or above average year: round(avg cost x 1.03 ^ (year - avg year))
   - year below average year: round(avg cost x 0.97 ^ (avg year - year))
   - With no lookup row (for example ElectricalPro Heavy Truck-Tractors) or no year, OCN is blank.

The old code picks the OCN vehicle type from PriceDigest type and subtype first, and from BODY_TYPE keywords (tractor, trailer, dump/flatbed/tank, pickup/van/suv) when PriceDigest has nothing. The BODY_TYPE keyword fallback is NOT built yet: the keyword to OCN type table is needed (see `ocnCalculator.ts`).

ASSUMED, for the PriceDigest path: the OCN vehicle type, using the same weight bands as the class codes. This differs from the old code in places where the old server and client copies disagreed with each other (no GVW: Light Trucks on the server, Heavy Trucks on the client; SUV: All Other on the server, Light Trucks on the client; tractors: GVW in the OCN mapping, GCW in the class code). Here a missing GVW and an SUV give Light Trucks, and tractors use GCW. Confirm.

| Detected type | OCN vehicle type |
|---|---|
| text contains the word "atv" or "golf" | ATV/Golf Cart |
| mobile equipment | Sp Mobile EQ |
| semi-trailer / utility trailer / trailer | Semitrailers / Service or Utility Trailers / Trailers |
| passenger car | PPT |
| tractor, GCW over 45,000 | Extra Heavy Truck-Tractors |
| tractor, otherwise | Heavy Truck-Tractors |
| truck/SUV or van, GVW up to 10,000 or unknown | Light Trucks |
| truck/SUV or van, GVW up to 20,000 / 45,000 / over 45,000 | Medium / Heavy / Extra Heavy Trucks |
| anything else with a type text | All Other |

Public Auto and Manully Rated Veh are never chosen automatically.

## 4. Collision and comprehensive (BA)

Applied to `coll` and `comp_otc`:

| Application value | Answer | Deductible |
|---|---|---|
| blank | blank | blank |
| no, n, none, n/a | No | blank |
| an amount (500, $1,000) | Yes | that amount |
| anything else (Yes, X) on a trailer | Yes | 1,000 |
| anything else (Yes, X) | Yes | by OCN tier |

CONFIRMED against the old code: collision and comprehensive use the same OCN tiers, and the limits are inclusive. Override with `ref_rules.deductible_tiers`, for example `[{"up_to":50000,"deductible":1000},{"up_to":100000,"deductible":2000},{"up_to":null,"deductible":5000}]`.

| OCN | Deductible |
|---|---|
| up to and including 50,000 | 1,000 |
| over 50,000, up to and including 100,000 | 2,000 |
| over 100,000 | 5,000 |

IM deductibles use a different boundary (a limit of 100,000 or more gives 5,000). They are unchanged in `nip_export_im.py` and match test 6. Do not copy one rule into the other.

## 4a. Program rules in the old code

- The 15 programs are the ones in the OCN table.
- Treepro: no OCN calculator. IM deductible below 100,000 is 1,000. Small tools maximum 1,000.
- Landpro: IM deductible and small tools as for Treepro, but the OCN calculator still runs.
- All other programs: IM deductible 2,500 below 100,000. Small tools 2,500.
- Anything else about programs (eligibility, states, carrier) is not in the code and must come from the product owner.

## 5. Worked examples

| # | Input | Expected |
|---|---|---|
| 1 | Truck, GVW 26,000, state OH, no dump | Class 31489 |
| 2 | Same truck, state TX | Class 33589 |
| 3 | Same as 1, BODY_TYPE "Dump" | Class 31479 |
| 4 | Same as 2, SIC 79 | Class 33579 |
| 5 | Tractor, GCW 60,000, state FL | Class 50589 |
| 6 | Tractor, GCW 40,000, state OH | Class 34489 |
| 7 | Passenger car (PPT), any state | Class 7398 |
| 8 | Mobile equipment | Class 07996 |
| 9 | Pickup, GVW 9,000, state GA | Class 03589 |
| 10 | PriceDigest type blank and BODY_TYPE blank | Class blank |
| 11 | PavingPro, Heavy Trucks, year 2020, no cost, VIN valid, no MSRP | OCN 141,250 |
| 12 | Landpro, Light Trucks, year 2012, VIN under 17 characters, no cost | OCN 35,276 |
| 13 | EdgePro, trailer row, year 2015, cost blank | OCN blank |
| 14 | Incomplete, MSRP 80,000, cost 90,000 | OCN 106,400 |
| 15 | Treepro, cost blank, VIN short | OCN = MSRP, or blank if none |
| 16 | COLL "500", OCN 120,000 | Collision Yes, deductible 500 |
| 17 | COLL "X", OCN 120,000 | Collision Yes, deductible 5,000 |
| 18 | COLL "X", OCN 60,000 | Collision Yes, deductible 2,000 |
| 19 | COLL "X", trailer, OCN 120,000 | Collision Yes, deductible 1,000 |
| 20 | COLL blank | Collision blank, deductible blank |

Examples 12 and 15 do not conflict. Example 12 is Landpro, so the calculator runs. Example 15 is Treepro, so it never runs.

## 6. Data notes

- `ref_ocn_lookup.csv` was copied from `ocnCalculator.ts` in the earlier app. The source workbook `OCN_Calculator_V20260521.xlsx` was not available. Have its owner confirm the numbers before go-live.
- Look at Treepro "All Other" (526,448, year 2022.5) and Growpro "Service or Utility Trailers" (2,017, year 1987.33).
- Load programs into `ref_programs` first. The OCN file refers to them by name (Growpro, Treepro and Landpro are spelled that way).

## 7. Worksheet mappings (from the old code; `nip_export_ba` is not written yet)

BA worksheet: sheet VehicleWorksheet, data from row 6. Duplicates are left out.

| Col | Field | Source |
|---|---|---|
| C | VehicleNumber | row index + 1 |
| F | GarageAddress1 | garaging address |
| H | GarageCity | city |
| I | GarageState | state |
| J | GarageZip | zip, 5 digits only |
| K | GarageCounty | county |
| L | Year | PriceDigest year, else application year |
| M | Make | PriceDigest make, else application make, in capitals |
| N | Model | PriceDigest model, else application model, in capitals, "CONFIGURATIONS (n)" removed |
| Q | VINorSerialNumber | VIN |
| R | OriginalCostNew | `ocn_value` |
| S | Class code | `class_code`, text format so leading zeros stay |
| V / W | Collision answer / deductible | `ba_coll_answer` / `ba_coll_deductible` |
| Z / AA | OTC answer / deductible | `ba_comp_answer` / `ba_comp_deductible` |

IM worksheet: `nip_export_im.py` already follows the old mapping (ContractorsEquipmentSchedule from row 6; coverage row 6: T small tools maximum, U = 3, V = 3), with one difference to check:

- Column D (EquipmentType). The old code gives "Cranes and Derricks" for cranes and leaves it empty otherwise. `nip_export_im.py` writes "All Other Equipment" otherwise. Check which one the template accepts.
- The old code has a comment "col V - offset fix" on the coverage row. Compare columns T, U and V with the template header row before relying on them.

## 8. Findings from the first real run (2026-11-16)

Checked on run `2627 TABBED APP_new.pdf` (11 vehicles) after deploying `nip_recompute_rating`.

- The Dexter scraper (`pricedigest-vins`) returns only MSRP, Is Tractor, Complete/Incomplete and Gross Vehicle Weight. It does not return Vehicle Type, Vehicle Subtype, make, model, year or Gross Combine Weight.
- Complete/Incomplete arrives as a single letter (`I`). The function treats `I` and any text starting with "incomplete" as Incomplete.
- Without a PriceDigest vehicle type the class code depends on the application BODY_TYPE alone. Two International trucks (body type "4X2" and "W/16ft Arbortech Chi", GVW 33,000) therefore get no class code. A rule is needed, for example "PriceDigest returned a GVW and the type is unknown: treat as truck". Not applied, because it changes the rating rules.
- Tractors need Gross Combine Weight. The scraper output seen so far has none, so a tractor would also get no class code.
- The extraction puts the application's own class code (for example 31489, 68489) into the vehicle `sic` column. The dump rule only looks for the exact SIC `79`, so it is not affected, but the column is mislabelled.
- Editing cost new, year, make, model, VIN or garaging state, or changing the program or insured state, now recalculates through `nip_save_edits`.
