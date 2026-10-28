# Benchmark results

Generated 2026-10-28T16:31:52.814301+00:00 on `Windows-11-10.0.26300-SP0`, CPU `Intel64 Family 6 Model 142 Stepping 12, GenuineIntel` (8 logical), Python 3.14.7, DuckDB 2.0.0, Polars 2.1.0.

Methodology: median wall-clock of repeated runs (1 run for >=1M-row import/profile); single process; synthetic seeded CSV with 7 columns; see app/benchmark.py. Peak process RSS: 745.6 MB.

| Rows | CSV MB | Parquet MB | Import (ms) | Profile (ms) | SQL agg (ms) | SQL join+window (ms) | Chart query (ms) | Browse page (ms) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10,000 | 0.37 | 0.09 | 65.5 | 70.2 | 62.8 | 73.5 | 62.8 | 65.4 |
| 100,000 | 3.84 | 0.76 | 461.1 | 174.8 | 74.0 | 86.3 | 70.9 | 74.6 |
| 1,000,000 | 39.38 | 7.47 | 4,099.5 | 838.6 | 106.1 | 141.4 | 112.3 | 99.9 |

These numbers describe one machine; re-run `uv run aether benchmark` to measure yours.
