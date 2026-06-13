import { MinHeap } from "../src/algorithms/heap.js";
import { TimingWheel } from '../src/algorithms/timingWheel.js';
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function makeJob(i, opts = {}) {
  const now = Date.now();
  return {
    id:                `job-${i}`,
    effectivePriority: opts.priority ?? ((i % 3) + 1),
    scheduledAt:       opts.scheduledAt ?? null,
    createdAt:         new Date(now - Math.random() * 10_000),
  };
}

function hrMs() {
  const [s, ns] = process.hrtime();
  return s * 1000 + ns / 1e6;
}

function memMb() {
  return (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
}

function benchHeap(jobs) {
  const heap = new MinHeap();

  // Insert
  const t0 = hrMs();
  for (const j of jobs) heap.insert(j);
  const insertMs = hrMs() - t0;

  // Extract all
  const t1 = hrMs();
  let extracted = 0;
  while (!heap.isEmpty()) {
    heap.extractMin();
    extracted++;
  }
  const extractMs = hrMs() - t1;

  return { insertMs, extractMs, extracted };
}

function benchTimingWheel(jobs, wheelSize = 60, tickMs = 1000) {
  const wheel = new TimingWheel({ wheelSize, tickMs });

  // Insert
  const t0 = hrMs();
  for (const j of jobs) wheel.insert(j);
  const insertMs = hrMs() - t0;

  // Tick until empty — simulate time passing
  const t1 = hrMs();
  let fired = 0;
  let ticks = 0;
  const maxTicks = wheelSize * 2; // safety cap
  while (wheel.size > 0 && ticks < maxTicks) {
    const due = wheel.tick();
    fired += due.length;
    ticks++;
  }
  const tickMs2 = hrMs() - t1;

  return { insertMs, tickMs: tickMs2, fired, ticks };
}

const SCENARIOS = [
  {
    name:  'All immediate (no scheduledAt)',
    count: 1_000,
    build: (i) => makeJob(i, { scheduledAt: null }),
  },
  {
    name:  'Mixed: 50% immediate, 50% within 30s',
    count: 1_000,
    build: (i) =>
      makeJob(i, {
        scheduledAt:
          i % 2 === 0 ? null : new Date(Date.now() + Math.random() * 30_000),
      }),
  },
  {
    name:  'All scheduled within 60s (wheel sweet spot)',
    count: 1_000,
    build: (i) =>
      makeJob(i, { scheduledAt: new Date(Date.now() + Math.random() * 60_000) }),
  },
  {
    name:  'Wide range: 0–600s (forces overflow)',
    count: 1_000,
    build: (i) =>
      makeJob(i, { scheduledAt: new Date(Date.now() + Math.random() * 600_000) }),
  },
  {
    name:  'High volume: 10,000 jobs immediate',
    count: 10_000,
    build: (i) => makeJob(i, { scheduledAt: null }),
  },
  {
    name:  'High volume: 10,000 jobs within 60s',
    count: 10_000,
    build: (i) =>
      makeJob(i, { scheduledAt: new Date(Date.now() + Math.random() * 60_000) }),
  },
];

function run() {
  const results = [];

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Job Scheduler — Algorithm Benchmark: Heap vs Timing Wheel');
  console.log('══════════════════════════════════════════════════════════════\n');

  for (const scenario of SCENARIOS) {
    const jobs = Array.from({ length: scenario.count }, (_, i) =>
      scenario.build(i)
    );

    // Run each 3 times, take median
    const heapRuns  = [0, 1, 2].map(() => benchHeap([...jobs]));
    const wheelRuns = [0, 1, 2].map(() => benchTimingWheel([...jobs]));

    const heapInsert  = median(heapRuns.map((r) => r.insertMs));
    const heapExtract = median(heapRuns.map((r) => r.extractMs));
    const wheelInsert = median(wheelRuns.map((r) => r.insertMs));
    const wheelTick   = median(wheelRuns.map((r) => r.tickMs));

    // Memory snapshot after heap holds all items
    const heapForMem = new MinHeap();
    jobs.forEach((j) => heapForMem.insert(j));
    const heapMem = parseFloat(memMb());

    const wheelForMem = new TimingWheel();
    jobs.forEach((j) => wheelForMem.insert(j));
    const wheelMem = parseFloat(memMb());

    const result = {
      scenario: scenario.name,
      count: scenario.count,
      heap: {
        insertMs:  +heapInsert.toFixed(3),
        extractMs: +heapExtract.toFixed(3),
        totalMs:   +(heapInsert + heapExtract).toFixed(3),
      },
      timingWheel: {
        insertMs:   +wheelInsert.toFixed(3),
        tickMs:     +wheelTick.toFixed(3),
        totalMs:    +(wheelInsert + wheelTick).toFixed(3),
      },
      winner:
        heapInsert + heapExtract < wheelInsert + wheelTick ? 'heap' : 'timing-wheel',
    };

    results.push(result);

    console.log(`   ${scenario.name} (n=${scenario.count.toLocaleString()})`);
    console.log(`   Heap         insert: ${pad(result.heap.insertMs)}ms   extract: ${pad(result.heap.extractMs)}ms   total: ${pad(result.heap.totalMs)}ms`);
    console.log(`   TimingWheel  insert: ${pad(result.timingWheel.insertMs)}ms   tick:    ${pad(result.timingWheel.tickMs)}ms   total: ${pad(result.timingWheel.totalMs)}ms`);
    console.log(`   Winner: ${result.winner === 'heap' ? 'Heap' : 'Timing Wheel'}\n`);
  }

  // ── Summary table ────────────────────────────────────────────────────────
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  Summary');
  console.log('══════════════════════════════════════════════════════════════');

  const heapWins  = results.filter((r) => r.winner === 'heap').length;
  const wheelWins = results.filter((r) => r.winner === 'timing-wheel').length;
  console.log(`  Heap wins:         ${heapWins}/${results.length}`);
  console.log(`  Timing Wheel wins: ${wheelWins}/${results.length}`);

  console.log('\n  Tradeoff Analysis:');
  console.log('  ┌──────────────────────────────────────────────────────────┐');
  console.log('  │  Heap                                                    │');
  console.log('  │    + O(log n) insert and extract — predictable           │');
  console.log('  │    + Arbitrary time precision (sub-millisecond)          │');
  console.log('  │    + Priority ordering baked in                          │');
  console.log('  │    - Slower at very high volume (log factor compounds)   │');
  console.log('  │                                                          │');
  console.log('  │  Timing Wheel                                            │');
  console.log('  │    + O(1) insert — fastest at scale                      │');
  console.log('  │    + O(k) tick where k = jobs due per slot (tiny)        │');
  console.log('  │    + Memory-efficient (circular array, not tree)         │');
  console.log('  │    - Fixed time resolution (TICK_MS) — loses sub-tick    │');
  console.log('  │      precision                                           │');
  console.log('  │    - No inherent priority ordering within a slot         │');
  console.log('  │    - Overflow handling adds complexity for long delays   │');
  console.log('  └──────────────────────────────────────────────────────────┘');

  console.log('\n  Our choice: Heap');
  console.log('  Reason: Job scheduler requires priority ordering (1 > 2 > 3)');
  console.log('  AND precise backoff timing (1s, 5s, 25s ±jitter). The heap');
  console.log('  handles both natively. At our expected job volumes (<10k),');
  console.log('  the log(n) factor is negligible.\n');

  const outPath = path.join(__dirname, 'results.json');

  const output = {
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    results,
    summary: {
      heapWins,
      wheelWins,
      recommendation: 'heap',
      reasoning:
        'Priority ordering and precise backoff timing favour the heap at our job volumes.',
    },
  };

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`  Results written to: ${outPath}\n`);
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function pad(n) {
  return String(n).padStart(7);
}

run();