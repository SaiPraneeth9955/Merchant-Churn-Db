import { calculateRiskScore, RiskMetrics } from './scoring.js';

interface TestCase {
  name: string;
  metrics: RiskMetrics;
  expectedScoreRange: [number, number];
  expectedLevel: 'Low' | 'Medium' | 'High';
  expectedDriver: string;
}

const testCases: TestCase[] = [
  {
    name: 'Perfect healthy merchant',
    metrics: {
      daysSinceLastTransaction: 1,
      volumeCurrent30d: 10000,
      volumeBaseline30d: 10000,
      activeDaysCurrent30d: 25,
      activeDaysBaseline30d: 25,
      apiErrorRate30d: 0,
      openUrgentTickets: 0,
      openMediumTickets: 0,
    },
    expectedScoreRange: [0, 0],
    expectedLevel: 'Low',
    expectedDriver: 'Healthy Operations',
  },
  {
    name: 'Merchant with volume decay (velocity drop)',
    metrics: {
      daysSinceLastTransaction: 1,
      volumeCurrent30d: 4000,
      volumeBaseline30d: 10000, // 60% drop, score: 60 (weighted: 60 * 0.25 = 15)
      activeDaysCurrent30d: 20,
      activeDaysBaseline30d: 20,
      apiErrorRate30d: 0.005,
      openUrgentTickets: 0,
      openMediumTickets: 0,
    },
    expectedScoreRange: [15, 15],
    expectedLevel: 'Low',
    expectedDriver: 'Severe Volume Drop',
  },
  {
    name: 'Inactive merchant (recency, velocity and engagement drop)',
    metrics: {
      daysSinceLastTransaction: 10, // recency score: 100 (weighted: 100 * 0.2 = 20)
      volumeCurrent30d: 0,
      volumeBaseline30d: 5000, // 100% drop, velocity score: 100 (weighted: 100 * 0.25 = 25)
      activeDaysCurrent30d: 0,
      activeDaysBaseline30d: 20, // 100% drop, engagement score: 100 (weighted: 100 * 0.2 = 20)
      apiErrorRate30d: 0,
      openUrgentTickets: 0,
      openMediumTickets: 0,
    },
    expectedScoreRange: [65, 65], // 20 + 25 + 20 = 65
    expectedLevel: 'Medium',
    expectedDriver: 'Severe Volume Drop', // velocity has higher weight (25 vs 20)
  },
  {
    name: 'Engagement decline only',
    metrics: {
      daysSinceLastTransaction: 1,
      volumeCurrent30d: 10000, // total volume same (e.g. fewer larger orders)
      volumeBaseline30d: 10000,
      activeDaysCurrent30d: 5,
      activeDaysBaseline30d: 25, // 80% engagement drop, score: 80 (weighted: 80 * 0.20 = 16)
      apiErrorRate30d: 0,
      openUrgentTickets: 0,
      openMediumTickets: 0,
    },
    expectedScoreRange: [16, 16],
    expectedLevel: 'Low',
    expectedDriver: 'Slipping Portal Engagement',
  },
  {
    name: 'Integration error issues',
    metrics: {
      daysSinceLastTransaction: 1,
      volumeCurrent30d: 15000,
      volumeBaseline30d: 15000,
      activeDaysCurrent30d: 20,
      activeDaysBaseline30d: 20,
      apiErrorRate30d: 0.12, // 12% error rate, score: 100 (weighted: 100 * 0.15 = 15)
      openUrgentTickets: 0,
      openMediumTickets: 0,
    },
    expectedScoreRange: [15, 15],
    expectedLevel: 'Low',
    expectedDriver: 'API Integration Failures',
  },
  {
    name: 'Severe support escalations',
    metrics: {
      daysSinceLastTransaction: 1,
      volumeCurrent30d: 10000,
      volumeBaseline30d: 10000,
      activeDaysCurrent30d: 20,
      activeDaysBaseline30d: 20,
      apiErrorRate30d: 0,
      openUrgentTickets: 2, // support score: 100 (weighted: 100 * 0.20 = 20)
      openMediumTickets: 0,
    },
    expectedScoreRange: [20, 20],
    expectedLevel: 'Low',
    expectedDriver: 'Unresolved Support Issues',
  },
  {
    name: 'Multiple critical failures (High Churn Risk)',
    metrics: {
      daysSinceLastTransaction: 8, // recency score: 100 (weighted: 100 * 0.20 = 20)
      volumeCurrent30d: 2000,
      volumeBaseline30d: 10000, // velocity score: 80 (weighted: 80 * 0.25 = 20)
      activeDaysCurrent30d: 4,
      activeDaysBaseline30d: 20, // engagement drop: 80% -> score: 80 (weighted: 80 * 0.20 = 16)
      apiErrorRate30d: 0.08, // error rate: (0.08-0.01)/0.09 = 78 -> score: 78 (weighted: 78 * 0.15 = 11.7)
      openUrgentTickets: 2, // support score: 100 (weighted: 100 * 0.20 = 20)
      openMediumTickets: 1,
    },
    expectedScoreRange: [87, 89], // 20 + 20 + 16 + 11.7 + 20 = 87.7 (rounded: 88)
    expectedLevel: 'High',
    expectedDriver: 'Severe Volume Drop', // velocity and recency and support are tied at 20 weighted, velocity listed first in max resolver
  },
];

let failed = false;
console.log('Running revised risk scoring algorithm test suite...\n');

testCases.forEach((tc, idx) => {
  const result = calculateRiskScore(tc.metrics);
  const inRange = result.compositeScore >= tc.expectedScoreRange[0] && result.compositeScore <= tc.expectedScoreRange[1];
  const levelMatch = result.level === tc.expectedLevel;
  const driverMatch = result.primaryDriver === tc.expectedDriver;

  if (inRange && levelMatch && driverMatch) {
    console.log(`[PASS] Test Case ${idx + 1}: ${tc.name}`);
    console.log(`       Composite Score: ${result.compositeScore}, Level: ${result.level}, Driver: ${result.primaryDriver}`);
  } else {
    console.error(`[FAIL] Test Case ${idx + 1}: ${tc.name}`);
    console.error(`       Expected Score Range: [${tc.expectedScoreRange.join('-')}], Got: ${result.compositeScore}`);
    console.error(`       Expected Level: ${tc.expectedLevel}, Got: ${result.level}`);
    console.error(`       Expected Driver: ${tc.expectedDriver}, Got: ${result.primaryDriver}`);
    failed = true;
  }
  console.log('--------------------------------------------------');
});

if (failed) {
  console.error('\nTests completed with failures.');
  process.exit(1);
} else {
  console.log('\nAll revised risk scoring algorithm tests passed successfully!');
}
