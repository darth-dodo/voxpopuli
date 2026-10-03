# ADR-010: Merged Writer Mode and Model Throughput

**Status:** Accepted (merged writer ships off by default; model choice left to the operator)
**Date:** 2026-10-03
**Deciders:** Abhishek Juneja
**Extends:** ADR-009 (pipeline latency)

## Context

After ADR-009 the pipeline's time is mostly generation: on Mistral a typical query spends ~12 s in
the Retriever, ~5.5 s in the Synthesizer and ~6 s in the Writer. Two further levers were proposed:

1. **Merge the Synthesizer and Writer.** Simply calling them in one request saves only a round-trip
   (~1 s): output tokens dominate, and a merged call still has to generate both the structured
   analysis and the prose. The real saving requires _not generating the analysis at all_ — the Writer
   reads the evidence themes directly — which removes a whole ~5 s generation step but also removes the
   Synthesizer's explicit insight ranking, contradiction finding and confidence call.
2. **A faster OpenRouter model.** The configured `qwen/qwen3-235b-a22b-2507` is the non-thinking
   variant, so "disable thinking" doesn't apply; its slowness is host throughput.

## Decision

### Merged writer: opt-in, `PIPELINE_MERGED_WRITER=true`

- The Synthesizer node is replaced by `createMergedSynthesizerNode()`, which makes **no LLM call**: it
  returns only the confidence and gaps that `applyEvidenceFloor()` derives from source coverage.
- The Writer (`createWriterNode(model, { fromEvidence: true })`) receives the formatted evidence
  themes plus that confidence and those gaps, with `MERGED_WRITER_SYSTEM_PROMPT`, which carries over the
  Synthesizer's analysis rules (rank by strength, flag disagreement, state gaps, no claims beyond the
  evidence). Output format is unchanged, so streaming drafts, sources and trust metadata are unaffected.
- The UI keeps three stages; the Synthesizer completes instantly as "Merged into writer".

**Evaluation (2026-10-03).** Full suite (25 queries), Mistral, SSE, LLM judge on, run sequentially:
three-stage on one server, then merged on another, same build. Reports:
`evals/results/2026-10-03T09-53-26-235Z-mistral.json` (three-stage) and
`2026-10-03T10-02-01-964Z-mistral.json` (merged).

| Metric               | Three-stage   | Merged        | Change      |
| -------------------- | ------------- | ------------- | ----------- |
| Mean wall-clock      | 25.9 s        | 18.8 s        | −27%        |
| p50 / p95            | 23.2 / 44.5 s | 18.2 / 30.6 s | −21% / −31% |
| Synthesizer + Writer | 5.9 + 6.4 s   | 0.0 + 5.3 s   |             |
| Quality (LLM judge)  | 0.76          | 0.85          |             |
| Pass rate            | 92%           | 100%          |             |
| Legacy fallbacks     | 2/25          | 0/25          |             |

The two three-stage fallbacks were compaction failures (output not JSON at all), which happen in the
Retriever and are **independent of this mode**, so they are noise in this comparison. Excluding them,
three-stage averages 25.2 s with quality 0.79 versus merged 18.8 s and 0.85: merged mode is ~25%
faster and scored no worse. The Writer also got faster (6.4 → 5.3 s) despite doing the analysis,
because its input is the compact evidence text rather than the analysis JSON plus source table.

**Why it still ships off by default:** one 25-query run, and merged mode drops the Synthesizer's
explicit contradiction-finding step, which this eval's quality checklist does not specifically
probe. Recommendation: enable it (`PIPELINE_MERGED_WRITER=true`) and confirm on a second full run;
if quality holds, make it the default.

### Model throughput: measured, not switched

Benchmark (2026-09-28): one Writer-sized JSON task (~700 output tokens), OpenRouter with
`provider: { sort: 'throughput' }`, two runs per model.

| Model                                      | Host      | Time to first token | Output speed  | Valid JSON |
| ------------------------------------------ | --------- | ------------------- | ------------- | ---------- |
| `qwen/qwen3-235b-a22b-2507` (current)      | Alibaba   | 0.7–0.8 s           | ~67 tok/s     | yes        |
| `openai/gpt-oss-120b`                      | Cerebras  | 0.3–0.4 s           | ~1,500 tok/s  | yes        |
| `meta-llama/llama-3.3-70b-instruct`        | Groq      | 0.2 s               | 224–340 tok/s | **no**     |
| `google/gemini-2.5-flash-lite`             | Google    | 0.5 s               | 217–247 tok/s | yes        |
| `google/gemini-2.5-flash`                  | Google    | 0.4–0.6 s           | ~130 tok/s    | yes        |
| `qwen/qwen3-32b`                           | DeepInfra | 0.5 s               | ~37 tok/s     | yes        |
| `mistralai/mistral-small-3.2-24b-instruct` | DeepInfra | 0.6–0.7 s           | 18–28 tok/s   | yes        |

End-to-end (`trust` category, 5 queries, LLM judge, both servers run concurrently):

| Model                     | Mean wall-clock | Weighted | Quality (judge) | Fallbacks |
| ------------------------- | --------------- | -------- | --------------- | --------- |
| `qwen3-235b-a22b-2507`    | 39.0 s          | 0.70     | 0.80            | 0/5       |
| `gpt-oss-120b` (Cerebras) | **11.2 s**      | 0.77     | 0.73            | 0/5       |

`gpt-oss-120b` is ~3.5× faster end to end with a slightly lower judge score on a small sample; the
eval prices OpenRouter at Qwen's rates, so its cost score is optimistic by ~1.7× ($0.15/$0.60 vs
$0.087/$0.35 per million tokens). This is a product trade-off, so the default is unchanged; to adopt
it, set `OPENROUTER_MODEL=openai/gpt-oss-120b` and re-run the full suite with the judge first.

## Consequences

- Operators can trade analysis depth for latency per deployment with one env var, measured with
  `run-eval.ts --baseline`.
- Merged mode has no LLM-written `AnalysisResult`. `analysisFromThemes()` builds an extractive one in
  code (one insight per evidence theme, from its most relevant items), so if the Writer fails twice the
  fallback answer is a readable theme-by-theme summary rather than an empty headline. Contradictions
  are not detected in that path.
