import express from 'express';
import cors from 'cors';
import { dbAll, dbGet, dbRun } from './db.js';
import { calculateRiskScore } from './scoring.js';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Helper to get the latest calculation date from database
async function getSystemLatestDate(): Promise<string> {
  const result = await dbGet<{ max_date: string }>('SELECT MAX(calculated_date) as max_date FROM risk_history');
  return result?.max_date || new Date().toISOString().split('T')[0];
}

// 1. GET /api/merchants - List merchants with filtering, searching, and sorting
app.get('/api/merchants', async (req, res) => {
  try {
    const q = req.query.q as string || '';
    const riskLevel = req.query.riskLevel as string || '';
    const industry = req.query.industry as string || '';
    const sort = req.query.sort as string || 'riskScore_desc';
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const systemDate = await getSystemLatestDate();

    // Query elements
    let query = `
      SELECT m.*, 
             rh.risk_score, 
             rh.risk_level, 
             rh.primary_driver,
             (SELECT COALESCE(SUM(t.transaction_volume_usd), 0) 
              FROM transaction_summary_daily t 
              WHERE t.merchant_id = m.merchant_id 
                AND t.record_date >= DATE(?, '-30 days')
                AND t.record_date <= ?) AS volume_30d,
             (SELECT COALESCE(SUM(t.transaction_count), 0) 
              FROM transaction_summary_daily t 
              WHERE t.merchant_id = m.merchant_id 
                AND t.record_date >= DATE(?, '-30 days')
                AND t.record_date <= ?) AS count_30d
      FROM merchants m
      LEFT JOIN risk_history rh ON m.merchant_id = rh.merchant_id AND rh.calculated_date = ?
      WHERE 1=1
    `;

    const params: any[] = [systemDate, systemDate, systemDate, systemDate, systemDate];

    if (q) {
      query += ` AND (m.business_name LIKE ? OR m.contact_email LIKE ? OR m.merchant_id LIKE ?)`;
      const searchWildcard = `%${q}%`;
      params.push(searchWildcard, searchWildcard, searchWildcard);
    }

    if (riskLevel) {
      query += ` AND rh.risk_level = ?`;
      params.push(riskLevel);
    }

    if (industry) {
      query += ` AND m.industry_vertical = ?`;
      params.push(industry);
    }

    // Sort order
    switch (sort) {
      case 'riskScore_asc':
        query += ` ORDER BY rh.risk_score ASC`;
        break;
      case 'volume_desc':
        query += ` ORDER BY volume_30d DESC`;
        break;
      case 'volume_asc':
        query += ` ORDER BY volume_30d ASC`;
        break;
      case 'name_asc':
        query += ` ORDER BY m.business_name ASC`;
        break;
      case 'name_desc':
        query += ` ORDER BY m.business_name DESC`;
        break;
      case 'riskScore_desc':
      default:
        query += ` ORDER BY rh.risk_score DESC`;
        break;
    }

    query += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const merchantsList = await dbAll(query, params);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM merchants m
      LEFT JOIN risk_history rh ON m.merchant_id = rh.merchant_id AND rh.calculated_date = ?
      WHERE 1=1
    `;
    const countParams: any[] = [systemDate];

    if (q) {
      countQuery += ` AND (m.business_name LIKE ? OR m.contact_email LIKE ? OR m.merchant_id LIKE ?)`;
      const searchWildcard = `%${q}%`;
      countParams.push(searchWildcard, searchWildcard, searchWildcard);
    }

    if (riskLevel) {
      countQuery += ` AND rh.risk_level = ?`;
      countParams.push(riskLevel);
    }

    if (industry) {
      countQuery += ` AND m.industry_vertical = ?`;
      countParams.push(industry);
    }

    const countResult = await dbGet<{ total: number }>(countQuery, countParams);

    res.json({
      merchants: merchantsList,
      total: countResult?.total || 0,
      systemDate
    });
  } catch (error: any) {
    console.error('Error fetching merchants:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. GET /api/analytics - Fetch aggregate statistics
app.get('/api/analytics', async (req, res) => {
  try {
    const systemDate = await getSystemLatestDate();

    // 1. Total active merchant counts by risk level
    const riskCounts = await dbAll<{ risk_level: string; count: number }>(`
      SELECT rh.risk_level, COUNT(*) as count
      FROM merchants m
      JOIN risk_history rh ON m.merchant_id = rh.merchant_id AND rh.calculated_date = ?
      GROUP BY rh.risk_level
    `, [systemDate]);

    const counts = {
      Low: 0,
      Medium: 0,
      High: 0,
      Total: 0
    };

    riskCounts.forEach(r => {
      if (r.risk_level === 'Low') counts.Low = r.count;
      else if (r.risk_level === 'Medium') counts.Medium = r.count;
      else if (r.risk_level === 'High') counts.High = r.count;
    });
    counts.Total = counts.Low + counts.Medium + counts.High;

    // 2. Total monthly volume processed
    const totalVolumeResult = await dbGet<{ total_volume: number }>(`
      SELECT SUM(transaction_volume_usd) as total_volume
      FROM transaction_summary_daily
      WHERE record_date >= DATE(?, '-30 days') AND record_date <= ?
    `, [systemDate, systemDate]);

    // 3. At-risk volume (High Risk merchant volume)
    const atRiskVolumeResult = await dbGet<{ at_risk_volume: number }>(`
      SELECT SUM(t.transaction_volume_usd) as at_risk_volume
      FROM transaction_summary_daily t
      JOIN risk_history rh ON t.merchant_id = rh.merchant_id AND rh.calculated_date = ?
      WHERE rh.risk_level = 'High'
        AND t.record_date >= DATE(?, '-30 days')
        AND t.record_date <= ?
    `, [systemDate, systemDate, systemDate]);

    // 4. Over-time trend of merchant counts in each risk category
    const trends = await dbAll<{ calculated_date: string; risk_level: string; count: number }>(`
      SELECT calculated_date, risk_level, COUNT(*) as count
      FROM risk_history
      GROUP BY calculated_date, risk_level
      ORDER BY calculated_date ASC
    `);

    // Format trends for stacked area chart [{ date: '2026-07-01', Low: 40, Medium: 15, High: 5 }]
    const trendMap = new Map<string, { date: string; Low: number; Medium: number; High: number }>();
    trends.forEach(t => {
      if (!trendMap.has(t.calculated_date)) {
        trendMap.set(t.calculated_date, { date: t.calculated_date, Low: 0, Medium: 0, High: 0 });
      }
      const dayData = trendMap.get(t.calculated_date)!;
      if (t.risk_level === 'Low') dayData.Low = t.count;
      else if (t.risk_level === 'Medium') dayData.Medium = t.count;
      else if (t.risk_level === 'High') dayData.High = t.count;
    });

    res.json({
      counts,
      totalVolume30d: totalVolumeResult?.total_volume || 0,
      atRiskVolume30d: atRiskVolumeResult?.at_risk_volume || 0,
      riskTrend: Array.from(trendMap.values())
    });
  } catch (error: any) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. GET /api/merchants/:id - Fetch individual merchant details
app.get('/api/merchants/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const systemDate = await getSystemLatestDate();

    // 1. Get profile
    const merchant = await dbGet(`SELECT * FROM merchants WHERE merchant_id = ?`, [id]);
    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    // 2. Get latest risk score
    const latestRisk = await dbGet(`
      SELECT * FROM risk_history 
      WHERE merchant_id = ? AND calculated_date = ?
    `, [id, systemDate]);

    // 3. Re-calculate live metrics (for showing component breakdowns in UI)
    // We fetch transaction records for current (last 30 days) and baseline (preceding 30 days)
    const txCurrent = await dbGet<{ vol: number; count: number; failed: number }>(`
      SELECT SUM(transaction_volume_usd) as vol, SUM(transaction_count) as count, SUM(failed_transaction_count) as failed
      FROM transaction_summary_daily
      WHERE merchant_id = ? AND record_date >= DATE(?, '-30 days') AND record_date <= ?
    `, [id, systemDate, systemDate]);

    const txBaseline = await dbGet<{ vol: number }>(`
      SELECT SUM(transaction_volume_usd) as vol
      FROM transaction_summary_daily
      WHERE merchant_id = ? AND record_date >= DATE(?, '-60 days') AND record_date < DATE(?, '-30 days')
    `, [id, systemDate, systemDate]);

    const activeDaysCurrentResult = await dbGet<{ count: number }>(`
      SELECT COUNT(DISTINCT record_date) as count
      FROM transaction_summary_daily
      WHERE merchant_id = ? AND transaction_count > 0 AND record_date >= DATE(?, '-30 days') AND record_date <= ?
    `, [id, systemDate, systemDate]);

    const activeDaysBaselineResult = await dbGet<{ count: number }>(`
      SELECT COUNT(DISTINCT record_date) as count
      FROM transaction_summary_daily
      WHERE merchant_id = ? AND transaction_count > 0 AND record_date >= DATE(?, '-60 days') AND record_date < DATE(?, '-30 days')
    `, [id, systemDate, systemDate]);

    const lastTxRecord = await dbGet<{ max_date: string }>(`
      SELECT MAX(record_date) as max_date 
      FROM transaction_summary_daily 
      WHERE merchant_id = ? AND record_date <= ?
    `, [id, systemDate]);

    let daysSinceLast = 99;
    if (lastTxRecord?.max_date) {
      const lastDate = new Date(lastTxRecord.max_date);
      const sysDate = new Date(systemDate);
      daysSinceLast = Math.max(0, Math.floor((sysDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)));
    }

    // Tickets open as of systemDate
    const tickets = await dbAll(`
      SELECT * FROM support_tickets 
      WHERE merchant_id = ? AND created_date <= ?
      ORDER BY created_date DESC
    `, [id, systemDate]);

    const openUrgentTickets = tickets.filter(t => 
      t.ticket_status !== 'CLOSED' && (t.priority === 'URGENT' || t.priority === 'HIGH')
    ).length;

    const openMediumTickets = tickets.filter(t => 
      t.ticket_status !== 'CLOSED' && (t.priority === 'MEDIUM' || t.priority === 'LOW')
    ).length;

    const totalAttempts = (txCurrent?.count || 0) + (txCurrent?.failed || 0);
    const apiErrorRate = totalAttempts > 0 ? ((txCurrent?.failed || 0) / totalAttempts) : 0;

    const activeDaysCurrent = activeDaysCurrentResult?.count || 0;
    const activeDaysBaseline = activeDaysBaselineResult?.count || 0;

    // Run scoring calculator to get exact subscore breakdowns
    const breakdown = calculateRiskScore({
      daysSinceLastTransaction: daysSinceLast,
      volumeCurrent30d: txCurrent?.vol || 0,
      volumeBaseline30d: txBaseline?.vol || 0,
      activeDaysCurrent30d: activeDaysCurrent,
      activeDaysBaseline30d: activeDaysBaseline,
      apiErrorRate30d: apiErrorRate,
      openUrgentTickets,
      openMediumTickets
    });

    // 4. Get historical risk score trend (last 90 days)
    const riskHistory = await dbAll(`
      SELECT calculated_date, risk_score 
      FROM risk_history 
      WHERE merchant_id = ?
      ORDER BY calculated_date ASC
    `, [id]);

    // 5. Get daily transaction history (last 90 days)
    const transactionHistory = await dbAll(`
      SELECT record_date, transaction_volume_usd, transaction_count, failed_transaction_count
      FROM transaction_summary_daily
      WHERE merchant_id = ? AND record_date <= ?
      ORDER BY record_date ASC
    `, [id, systemDate]);

    // 6. Get executed actions history
    const auditActions = await dbAll(`
      SELECT * FROM audit_actions 
      WHERE merchant_id = ?
      ORDER BY executed_at DESC
    `, [id]);

    res.json({
      profile: merchant,
      latestRiskScore: latestRisk?.risk_score || breakdown.compositeScore,
      latestRiskLevel: latestRisk?.risk_level || breakdown.level,
      latestPrimaryDriver: latestRisk?.primary_driver || breakdown.primaryDriver,
      breakdown,
      metrics: {
        daysSinceLastTransaction: daysSinceLast,
        lastTransactionDate: lastTxRecord?.max_date || null,
        volumeCurrent30d: txCurrent?.vol || 0,
        volumeBaseline30d: txBaseline?.vol || 0,
        apiErrorRate30d: apiErrorRate,
        openUrgentTickets,
        openMediumTickets,
      },
      tickets,
      riskHistory,
      transactionHistory,
      auditActions
    });
  } catch (error: any) {
    console.error('Error fetching merchant details:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. POST /api/merchants/:id/actions - Log a CSM outreach/remediation action
app.post('/api/merchants/:id/actions', async (req, res) => {
  try {
    const { id } = req.params;
    const { actionType, actionDescription } = req.body;

    if (!actionType || !actionDescription) {
      return res.status(400).json({ error: 'actionType and actionDescription are required' });
    }

    const merchant = await dbGet(`SELECT * FROM merchants WHERE merchant_id = ?`, [id]);
    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    const actionId = `act_${crypto.randomUUID().substring(0, 8)}`;
    const executedAt = new Date().toISOString(); // Real transaction time log

    await dbRun(`
      INSERT INTO audit_actions (action_id, merchant_id, action_type, action_description, executed_at)
      VALUES (?, ?, ?, ?, ?)
    `, [actionId, id, actionType, actionDescription, executedAt]);

    // OPTIONAL: Update merchant CRM status or open ticket status based on action
    if (actionType === 'Priority Ticket Escalation') {
      // Resolve/update tickets
      await dbRun(`
        UPDATE support_tickets
        SET ticket_status = 'PENDING'
        WHERE merchant_id = ? AND ticket_status = 'OPEN'
      `, [id]);
    }

    res.status(201).json({
      message: 'Action logged successfully',
      action: {
        actionId,
        merchantId: id,
        actionType,
        actionDescription,
        executedAt
      }
    });
  } catch (error: any) {
    console.error('Error logging action:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server is running on port ${PORT}`);
});
