import { dbRun, dbAll, initSchema, db } from './db.js';
import { calculateRiskScore, RiskMetrics } from './scoring.js';
import { v4 as uuidv4 } from 'uuid';

// Helper to format Date objects to YYYY-MM-DD
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Get date offset by N days from today
function getDateOffset(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

const INDUSTRIES = ['SaaS', 'E-commerce', 'Retail', 'Travel', 'Food & Beverage', 'Services'];
const TIERS = ['Starter', 'Growth', 'Enterprise'];
const COHORTS = ['Healthy', 'Volume_Decline', 'Inactive', 'Tech_Friction', 'Support_Friction'] as const;
type Cohort = typeof COHORTS[number];

interface SeedMerchant {
  id: string;
  name: string;
  email: string;
  industry: string;
  tier: string;
  signupDate: string;
  cohort: Cohort;
  baseVolume: number;
}

const MERCHANT_NAMES = [
  'Apex Retail', 'Nova Tech', 'Quantum SaaS', 'BlueSky E-commerce', 'GreenGrow Farms',
  'Zenith Consulting', 'Starlight Travel', 'Swift Delivery', 'BiteSize Food', 'Core Logistics',
  'Summit Agency', 'Vivid Designs', 'Anchor Shipping', 'Pinnacle Finance', 'Beacon Learning',
  'CloudScale', 'PixelCraft', 'NextGen Apparel', 'Optima Health', 'TrueNorth Legal',
  'ByteCode Studio', 'Velociti Goods', 'Spark Media', 'Ironclad Security', 'PureWater Co',
  'Urban Oasis', 'EcoBreeze', 'OmniChannel Corp', 'Velo Cafe', 'Vanguard Legal',
  'Alpha Beta E-commerce', 'Gamma Tech', 'Delta Retail', 'Epsilon Travel', 'Zeta Software',
  'Omega Services', 'Sigma Finance', 'Theta Logistics', 'Lambda Learning', 'Kappa Health',
  'FlowState SaaS', 'Bolt Delivery', 'Crafter E-commerce', 'Nomad Cafe', 'Aero Space Services',
  'Matrix Software', 'Neon Designs', 'Pulse Analytics', 'Prism Retail', 'Aura Cosmetics'
];

async function seed() {
  console.log('Starting SQLite database seeding...');
  await initSchema();

  // Clear existing tables
  await dbRun('DELETE FROM risk_history');
  await dbRun('DELETE FROM support_tickets');
  await dbRun('DELETE FROM transaction_summary_daily');
  await dbRun('DELETE FROM audit_actions');
  await dbRun('DELETE FROM merchants');
  console.log('Existing data cleared.');

  const merchants: SeedMerchant[] = [];
  
  // 1. Generate 60 Merchants (Healthy: 35, Volume Decline: 10, Inactive: 6, Tech Friction: 5, Support Friction: 4)
  // Let's scale names to reach 60 merchants
  for (let i = 0; i < 60; i++) {
    const name = MERCHANT_NAMES[i % MERCHANT_NAMES.length] + (i >= MERCHANT_NAMES.length ? ` ${Math.floor(i / MERCHANT_NAMES.length) + 1}` : '');
    const id = `merch_${i + 1}`;
    const email = `contact@${name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
    const industry = INDUSTRIES[i % INDUSTRIES.length];
    const tier = TIERS[i % TIERS.length];
    const signupDate = formatDate(getDateOffset(-120 - Math.floor(Math.random() * 300))); // signed up 120-420 days ago
    
    // Assign cohort based on distribution
    let cohort: Cohort = 'Healthy';
    if (i >= 35 && i < 45) cohort = 'Volume_Decline';
    else if (i >= 45 && i < 51) cohort = 'Inactive';
    else if (i >= 51 && i < 56) cohort = 'Tech_Friction';
    else if (i >= 56) cohort = 'Support_Friction';

    const baseVolume = tier === 'Enterprise' 
      ? 20000 + Math.random() * 30000 
      : (tier === 'Growth' ? 5000 + Math.random() * 8000 : 800 + Math.random() * 1200);

    merchants.push({ id, name, email, industry, tier, signupDate, cohort, baseVolume });
  }

  // Insert merchants using transaction
  await dbRun('BEGIN TRANSACTION');
  for (const m of merchants) {
    let status = 'Active';
    if (m.cohort === 'Inactive') {
      // Some inactive merchants might already be categorized as "Churned" or "Suspended" in CRM
      status = Math.random() > 0.5 ? 'Churned' : 'Active';
    }
    await dbRun(
      'INSERT INTO merchants (merchant_id, business_name, contact_email, industry_vertical, pricing_tier, signup_date, current_status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [m.id, m.name, m.email, m.industry, m.tier, m.signupDate, status]
    );
  }
  await dbRun('COMMIT');
  console.log(`Inserted ${merchants.length} merchant profiles.`);

  // 2. Generate 90 days of transactions (from Day -90 to Day 0)
  console.log('Generating 90 days of transaction history (this may take a few seconds)...');
  await dbRun('BEGIN TRANSACTION');

  const ticketsToInsert: { id: string; merchantId: string; created: string; priority: string; status: string; cat: string }[] = [];

  for (const m of merchants) {
    // Generate daily transactions
    for (let dayOffset = -90; dayOffset <= 0; dayOffset++) {
      const date = formatDate(getDateOffset(dayOffset));
      
      // Calculate transaction volume based on cohort and current day
      let volMultiplier = 0.8 + Math.random() * 0.4; // default base variance
      let baseErrorRate = 0.005; // 0.5% default

      if (m.cohort === 'Volume_Decline') {
        if (dayOffset > -30) {
          // Linear decline from 100% down to 10% in the last 30 days
          const progress = (dayOffset + 30) / 30; // 0 to 1
          volMultiplier *= (1 - progress * 0.85); // goes down by up to 85%
        }
      } else if (m.cohort === 'Inactive') {
        if (dayOffset > -15) {
          volMultiplier = 0; // complete halt
        }
      } else if (m.cohort === 'Tech_Friction') {
        if (dayOffset > -30) {
          // Spike in errors in the last 30 days
          const progress = (dayOffset + 30) / 30; // 0 to 1
          baseErrorRate = 0.005 + progress * 0.12; // spikes up to ~12.5% error rate
        }
      }

      const txVolume = m.baseVolume * volMultiplier;
      const txCount = txVolume > 0 
        ? Math.round(txVolume / (40 + Math.random() * 60)) // average ticket size $40-$100
        : 0;

      const failedCount = txCount > 0 
        ? Math.round(txCount * (baseErrorRate + Math.random() * 0.01))
        : 0;

      const summaryId = `tx_${m.id}_d${90 + dayOffset}`;

      if (txCount > 0 || failedCount > 0) {
        await dbRun(
          'INSERT INTO transaction_summary_daily (summary_id, merchant_id, record_date, transaction_volume_usd, transaction_count, failed_transaction_count) VALUES (?, ?, ?, ?, ?, ?)',
          [summaryId, m.id, date, parseFloat(txVolume.toFixed(2)), txCount, failedCount]
        );
      }
    }

    // Generate Support Tickets
    // Normal ticketing rate: 2-3 random closed tickets throughout the year
    const ticketCount = Math.floor(Math.random() * 4);
    for (let t = 0; t < ticketCount; t++) {
      const ticketDay = -80 + Math.floor(Math.random() * 60); // created between day -80 and -20
      const createdDate = formatDate(getDateOffset(ticketDay));
      ticketsToInsert.push({
        id: `tkt_${m.id}_${t}`,
        merchantId: m.id,
        created: createdDate,
        priority: Math.random() > 0.8 ? 'HIGH' : 'MEDIUM',
        status: 'CLOSED',
        cat: 'Billing'
      });
    }

    // Special tickets for cohorts
    if (m.cohort === 'Support_Friction') {
      // 2 open urgent tickets in the last 10 days
      ticketsToInsert.push({
        id: `tkt_${m.id}_u1`,
        merchantId: m.id,
        created: formatDate(getDateOffset(-8)),
        priority: 'URGENT',
        status: 'OPEN',
        cat: 'Disputes'
      });
      ticketsToInsert.push({
        id: `tkt_${m.id}_u2`,
        merchantId: m.id,
        created: formatDate(getDateOffset(-4)),
        priority: 'HIGH',
        status: 'OPEN',
        cat: 'Technical Integration'
      });
    } else if (m.cohort === 'Tech_Friction' && Math.random() > 0.4) {
      // 1 open integration ticket
      ticketsToInsert.push({
        id: `tkt_${m.id}_tech`,
        merchantId: m.id,
        created: formatDate(getDateOffset(-12)),
        priority: 'HIGH',
        status: 'OPEN',
        cat: 'Technical Integration'
      });
    }
  }

  // Insert all tickets
  for (const t of ticketsToInsert) {
    await dbRun(
      'INSERT INTO support_tickets (ticket_id, merchant_id, created_date, priority, ticket_status, category) VALUES (?, ?, ?, ?, ?, ?)',
      [t.id, t.merchantId, t.created, t.priority, t.status, t.cat]
    );
  }

  await dbRun('COMMIT');
  console.log(`Inserted ${ticketsToInsert.length} support tickets.`);

  // 3. Compute Risk History
  // We want to calculate the risk score for each merchant for each of the last 90 days.
  // To optimize this, we can load all transactions and tickets into memory, compute the rolling metrics, and write.
  console.log('Calculating and writing rolling 90-day risk histories...');
  
  // Load all transactions into memory for fast lookup
  const allTx = await dbAll<{
    merchant_id: string;
    record_date: string;
    transaction_volume_usd: number;
    transaction_count: number;
    failed_transaction_count: number;
  }>('SELECT merchant_id, record_date, transaction_volume_usd, transaction_count, failed_transaction_count FROM transaction_summary_daily');

  // Load all tickets
  const allTickets = await dbAll<{
    merchant_id: string;
    created_date: string;
    priority: string;
    ticket_status: string;
  }>('SELECT merchant_id, created_date, priority, ticket_status FROM support_tickets');

  // Helper mapping: merchantId -> array of daily records
  const txByMerchMap = new Map<string, typeof allTx>();
  allTx.forEach(tx => {
    if (!txByMerchMap.has(tx.merchant_id)) txByMerchMap.set(tx.merchant_id, []);
    txByMerchMap.get(tx.merchant_id)!.push(tx);
  });

  const ticketsByMerchMap = new Map<string, typeof allTickets>();
  allTickets.forEach(tkt => {
    if (!ticketsByMerchMap.has(tkt.merchant_id)) ticketsByMerchMap.set(tkt.merchant_id, []);
    ticketsByMerchMap.get(tkt.merchant_id)!.push(tkt);
  });

  await dbRun('BEGIN TRANSACTION');

  for (const m of merchants) {
    const merchTx = txByMerchMap.get(m.id) || [];
    const merchTickets = ticketsByMerchMap.get(m.id) || [];

    // Loop through each history day (from Day -90 to Day 0)
    for (let dayOffset = -90; dayOffset <= 0; dayOffset++) {
      const historyDate = getDateOffset(dayOffset);
      const historyDateStr = formatDate(historyDate);

      // Define evaluation windows relative to historyDate
      const dateWCurrentStart = getDateOffset(dayOffset - 30);
      const dateWBaselineStart = getDateOffset(dayOffset - 60);

      // 1. Recency: last transaction date on or before historyDate
      const pastTx = merchTx.filter(t => new Date(t.record_date) <= historyDate);
      let daysSinceLast = 99; // default high penalty if no transactions
      if (pastTx.length > 0) {
        // Find most recent transaction record
        const sortedPastTx = [...pastTx].sort((a, b) => new Date(b.record_date).getTime() - new Date(a.record_date).getTime());
        const lastTxDate = new Date(sortedPastTx[0].record_date);
        daysSinceLast = Math.max(0, Math.floor((historyDate.getTime() - lastTxDate.getTime()) / (1000 * 60 * 60 * 24)));
      }

      // 2. Volume Current 30d (between historyDate-30d and historyDate)
      const txCurrent30d = merchTx.filter(t => {
        const txDate = new Date(t.record_date);
        return txDate > dateWCurrentStart && txDate <= historyDate;
      });

      let volumeCurrent = 0;
      let totalTxCount = 0;
      let totalFailedCount = 0;
      txCurrent30d.forEach(t => {
        volumeCurrent += t.transaction_volume_usd;
        totalTxCount += t.transaction_count;
        totalFailedCount += t.failed_transaction_count;
      });

      const activeDaysCurrent = txCurrent30d.filter(t => t.transaction_count > 0).length;

      // 3. Volume Baseline 30d (between historyDate-60d and historyDate-30d)
      const txBaseline30d = merchTx.filter(t => {
        const txDate = new Date(t.record_date);
        return txDate > dateWBaselineStart && txDate <= dateWCurrentStart;
      });

      let volumeBaseline = 0;
      txBaseline30d.forEach(t => {
        volumeBaseline += t.transaction_volume_usd;
      });

      const activeDaysBaseline = txBaseline30d.filter(t => t.transaction_count > 0).length;

      // 4. API Error Rate
      const totalAttempts = totalTxCount + totalFailedCount;
      const apiErrorRate = totalAttempts > 0 ? (totalFailedCount / totalAttempts) : 0;

      // 5. Support tickets open as of historyDate
      // We assume tickets remain open for 7 days unless closed, or if status is 'OPEN' we keep it open if historyDate is after createdDate
      const activeTickets = merchTickets.filter(t => {
        const createdDate = new Date(t.created_date);
        if (createdDate > historyDate) return false;
        
        if (t.ticket_status === 'CLOSED') {
          // Assume closed ticket was resolved in 4 days
          const closedDate = new Date(createdDate);
          closedDate.setDate(closedDate.getDate() + 4);
          return historyDate < closedDate;
        }
        
        return true; // Still open as of historyDate
      });

      const openUrgent = activeTickets.filter(t => t.priority === 'URGENT' || t.priority === 'HIGH').length;
      const openMedium = activeTickets.filter(t => t.priority === 'MEDIUM' || t.priority === 'LOW').length;

      // Calculate risk score
      const riskMetrics: RiskMetrics = {
        daysSinceLastTransaction: daysSinceLast,
        volumeCurrent30d: volumeCurrent,
        volumeBaseline30d: volumeBaseline,
        activeDaysCurrent30d: activeDaysCurrent,
        activeDaysBaseline30d: activeDaysBaseline,
        apiErrorRate30d: apiErrorRate,
        openUrgentTickets: openUrgent,
        openMediumTickets: openMedium
      };

      const breakdown = calculateRiskScore(riskMetrics);
      const historyId = `rh_${m.id}_d${90 + dayOffset}`;

      await dbRun(
        'INSERT INTO risk_history (history_id, merchant_id, calculated_date, risk_score, risk_level, primary_driver) VALUES (?, ?, ?, ?, ?, ?)',
        [historyId, m.id, historyDateStr, breakdown.compositeScore, breakdown.level, breakdown.primaryDriver]
      );
    }
  }

  await dbRun('COMMIT');
  console.log('Risk history generation complete.');
  console.log('SQLite database successfully seeded with all mock records!');
  db.close();
}

// Execute seeding if run directly
seed().catch(err => {
  console.error('Seeding failed:', err);
});
