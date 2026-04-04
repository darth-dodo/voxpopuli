---
name: vp-linear-sync
description: Use when starting work on VoxPopuli issues, querying milestone status, or syncing implementation progress with Linear - covers issue discovery, status updates, and milestone tracking
---

# Linear Sync (VoxPopuli)

## Overview

Patterns for working with Linear issues in the VoxPopuli project. The project uses Linear for all issue tracking with a milestone-based structure (M1-M6).

## When to Use

- Starting a new milestone or picking up work
- Checking what's left to implement
- Updating issue status after completing work
- **Not for:** creating new issues (ask the user first)

## Project Reference

| Field       | Value                 |
| ----------- | --------------------- |
| Project     | VoxPopuli             |
| Team        | AI Adventures         |
| Issue range | AI-99 through AI-165+ |
| Lead        | Abhishek Juneja       |

## Querying Issues

**By milestone** (most reliable):

```
list_issues(project: "VoxPopuli", state: "Backlog", limit: 50)
```

Then filter by `projectMilestone.name`. Do NOT rely on keyword search alone -- it misses issues.

**Get full description** (truncated in list results):

```
get_issue(id: "AI-108")
```

**Find stragglers** after bulk close:

```
list_issues(project: "VoxPopuli", state: "Backlog")
```

Filter for the milestone name in results to catch anything missed.

## Issue Hierarchy

```
[Epic] AI-106 Content Chunker
  ├── AI-108 Implement ChunkerService
  ├── AI-148 Write ChunkerService tests
  └── AI-144 ADR: Chunker strategy
```

- **Epics** have `[Epic]` prefix, no `parentId`
- **Tasks** have `parentId` pointing to their epic
- Close leaf tasks first, then epics

## Status Updates

```
save_issue(id: "AI-108", state: "Done")     # Mark complete
save_issue(id: "AI-108", state: "In Progress")  # Started work
```

Use parallel tool calls when closing multiple issues.

## Common Mistakes

- Searching by keyword instead of listing by project + filtering by milestone
- Forgetting to close epic issues after all children are done
- Not fetching full issue descriptions (list results truncate at ~200 chars)
- Updating issues before code actually passes tests
