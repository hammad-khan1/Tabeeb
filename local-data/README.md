# Local Medicine Database (Pharmapedia SQLite)

## Overview
This directory holds the private local SQLite reference database (`pharmapedia.db`) for Pakistan-first medication brand, formulation, and generic ingredient recognition.

## Security & Version Control
- The SQLite file (`pharmapedia.db`) is strictly excluded from version control via `.gitignore` (`/local-data/*.db`, `/local-data/*.sqlite`).
- It must **never** be committed or exposed through any public download route.
- The catalog data is used internally for clinical brand identification, normalization, and patient prescription understanding.

## Database Schema
The database contains the following key tables:
- **`BRAND`** (23,332 rows): Pakistani brand names and manufacturer references (`BID`, `BNAME`, `CID`).
- **`DRUG`** (1,956 rows): Active generic ingredients, clinical overviews, and indicators (`CODE`, `NAME`, `OVERVIEW`, `INDICATIONS`, etc.).
- **`BRAND_DRUG`** (53,657 rows): Formulations, strengths, packaging, and brand-to-ingredient relationships (`ID`, `NAME`, `FORM`, `MG`, `PACKING`, `DID`, `BID`).
- **`COMPANY`** (1,199 rows): Pakistani and international pharmaceutical manufacturers operating in Pakistan (`ID`, `NAME`, `ADDRESS`, etc.).

## Importer & Management Commands
- **Inspect database & data quality**:
  ```bash
  npm run medicines:inspect
  ```
- **Dry-run importer (validates & summarizes without modifying PostgreSQL)**:
  ```bash
  npm run medicines:import:dry-run
  ```
- **Run catalog import into PostgreSQL**:
  ```bash
  npm run medicines:import
  ```
