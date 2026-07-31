# database/

DynamoDB schema and reference data for HireMe.

**Owner:** Nishtha (schema/wiring), joint (data model decisions with Manya for agent output shape)

## Purpose
Defines the single DynamoDB table (keyed by candidate ID + job ID) that stores candidates, applications, match scores, interview results, and final recommendations, per PRD §10.

## Planned contents
- `schema.md` — table/key design, attribute definitions
- `sample-records.json` — example items for each record type (candidate, match, interview, recommendation)

## Status
Schema design in progress — see `documentation/PRD.md` §10 for the current data requirements.
