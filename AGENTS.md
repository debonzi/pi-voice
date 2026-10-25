# Development Agent Instructions

## Session modes

This project uses three development session modes:

- Exploration: investigate questions and validate hypotheses.
- Definition: clarify concepts, decisions, and intended work.
- Implementation: execute authorized changes.

The developer must specify the session mode. If it is not explicit,
ask before starting work; do not infer it.

Do not start implementation outside an Implementation session unless
the developer explicitly requests it. Completing an exploration or
definition does not authorize implementation.

## Exploration

Purpose: investigate a question, evaluate alternatives, or reduce
uncertainty.

An exploration request authorizes creating documentation and supporting
assets within its exploration directory. It does not authorize changes
to project code or configuration outside that directory.

### Records and assets

- Store each exploration under:
  `explorations/YYYY-MM-DD_HH-mm-subject-slug/`
- Create the directory if needed.
- Include a `README.md` covering:
  - Objective, scope, and constraints.
  - Findings and supporting evidence.
  - Alternatives and trade-offs, when relevant.
  - Conclusions, open questions, and possible next steps.
- Keep all supporting assets within that exploration directory.
- Distinguish verified findings from assumptions and proposals.

### Validation code

- Code may be created for experiments, tests, and hypothesis validation.
- Keep that code and its generated artifacts within the exploration
  directory as supporting assets.
- Document how to run it and what its results demonstrate.
- Do not integrate exploration code into the project implementation
  without explicit authorization.

## Definition

Purpose: develop a shared understanding of a concept or proposed change
before implementation.

- Clarify the problem, intended behavior, scope, and non-goals.
- Discuss alternatives, constraints, and trade-offs as needed.
- For work intended for implementation, establish acceptance criteria
  and identify unresolved decisions.
- Ask the developer about ambiguities that materially affect the result.
- Do not implement the proposed solution during definition unless the
  developer explicitly requests it.

### Recording outcomes

- Create or update persistent records only when the developer requests it.
- Use devflow documentation for concepts and decisions.
- Use Wyrd items for executable work.
- Use both when requested and appropriate.
- If the recording destination is unclear, ask the developer.
- A recorded definition or Wyrd item is not, by itself, authorization
  to begin implementation.

## Implementation

Purpose: execute an authorized change.

- Implementation requires an Implementation session, unless the
  developer explicitly requests implementation in another session.
- Start from a Wyrd task explicitly selected for implementation or a
  direct implementation request from the developer.
- Understand the expected outcome and applicable acceptance criteria
  before making changes.
- Keep changes within the authorized scope.
- Ask before proceeding when an unresolved decision would materially
  change the agreed behavior or scope.
- Run relevant available checks.
- Report the changes, validation results, checks not performed, and
  remaining issues.

## Language and related workflows

- Write project instructions and persistent documentation in English.
- When working with devflow documentation or Wyrd items, follow the
  corresponding skill instructions.
