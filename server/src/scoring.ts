export interface RiskMetrics {
  daysSinceLastTransaction: number; // R
  volumeCurrent30d: number;         // Volume in last 30 days
  volumeBaseline30d: number;        // Volume in preceding 30 days (-60d to -31d)
  activeDaysCurrent30d: number;     // Days with >=1 transaction in last 30 days
  activeDaysBaseline30d: number;    // Days with >=1 transaction in preceding 30 days
  apiErrorRate30d: number;          // E_R (decimal, 0 to 1)
  openUrgentTickets: number;        // Open urgent/high tickets
  openMediumTickets: number;        // Open medium/low tickets
}

export interface RiskBreakdown {
  compositeScore: number;
  level: 'Low' | 'Medium' | 'High';
  subScores: {
    recency: number;
    velocity: number;
    engagement: number;
    error: number;
    support: number;
  };
  primaryDriver: string;
}

/**
 * Calculates the churn risk score (0-100) and its breakdown based on merchant metrics,
 * combining volume, recency, transaction frequency (engagement), api health, and support issues.
 */
export function calculateRiskScore(metrics: RiskMetrics): RiskBreakdown {
  const {
    daysSinceLastTransaction,
    volumeCurrent30d,
    volumeBaseline30d,
    activeDaysCurrent30d,
    activeDaysBaseline30d,
    apiErrorRate30d,
    openUrgentTickets,
    openMediumTickets,
  } = metrics;

  // 1. Recency Penalty (Weight: 0.20)
  // R <= 1 day -> 0. 1 < R <= 7 -> linear scale. R > 7 -> 100.
  let recencyScore = 0;
  if (daysSinceLastTransaction <= 1) {
    recencyScore = 0;
  } else if (daysSinceLastTransaction <= 7) {
    recencyScore = Math.round(20 * (daysSinceLastTransaction - 1));
  } else {
    recencyScore = 100;
  }

  // 2. Volume Velocity Decline Score (Weight: 0.25)
  // VG = (Vol_curr / Vol_base) - 1. D = -VG.
  let velocityScore = 0;
  if (volumeBaseline30d > 0) {
    const volumeGrowthRate = (volumeCurrent30d / volumeBaseline30d) - 1;
    const decline = -volumeGrowthRate;
    if (decline > 0) {
      velocityScore = Math.min(100, Math.round(decline * 100));
    }
  }

  // 3. Engagement Decline Score (Weight: 0.20)
  // Compares active days (days with transactions) in the current 30d vs preceding 30d.
  let engagementScore = 0;
  if (activeDaysBaseline30d > 5) {
    const activeDaysDrop = (activeDaysBaseline30d - activeDaysCurrent30d) / activeDaysBaseline30d;
    if (activeDaysDrop > 0) {
      engagementScore = Math.min(100, Math.round(activeDaysDrop * 100));
    }
  } else {
    // If they have historically very low activity, we judge by absolute activity
    if (activeDaysCurrent30d === 0) {
      engagementScore = 100;
    } else if (activeDaysCurrent30d <= 2) {
      engagementScore = 50;
    } else {
      engagementScore = 0;
    }
  }

  // 4. API Error Penalty (Weight: 0.15)
  // ER <= 1% -> 0. 1% < ER <= 10% -> scaled. ER > 10% -> 100.
  let errorScore = 0;
  if (apiErrorRate30d <= 0.01) {
    errorScore = 0;
  } else if (apiErrorRate30d <= 0.10) {
    errorScore = Math.round(((apiErrorRate30d - 0.01) / 0.09) * 100);
  } else {
    errorScore = 100;
  }

  // 5. Support Escalation Score (Weight: 0.20)
  // Open Urgent * 50 + Open Medium * 15, capped at 100.
  const supportScore = Math.min(
    100,
    Math.round(openUrgentTickets * 50 + openMediumTickets * 15)
  );

  // Composite Risk Score (Weighted Sum of 5 components)
  const rawComposite =
    0.20 * recencyScore +
    0.25 * velocityScore +
    0.20 * engagementScore +
    0.15 * errorScore +
    0.20 * supportScore;

  const compositeScore = Math.round(rawComposite);

  // Determine Risk Level
  let level: 'Low' | 'Medium' | 'High' = 'Low';
  if (compositeScore >= 70) {
    level = 'High';
  } else if (compositeScore >= 40) {
    level = 'Medium';
  }

  // Determine Primary Driver (the component that contributed the most to the weighted score)
  const weightedRecency = 0.20 * recencyScore;
  const weightedVelocity = 0.25 * velocityScore;
  const weightedEngagement = 0.20 * engagementScore;
  const weightedError = 0.15 * errorScore;
  const weightedSupport = 0.20 * supportScore;

  let primaryDriver = 'Healthy Operations';
  if (compositeScore > 0) {
    const maxWeight = Math.max(
      weightedRecency,
      weightedVelocity,
      weightedEngagement,
      weightedError,
      weightedSupport
    );

    if (maxWeight === weightedVelocity && velocityScore > 10) {
      primaryDriver = 'Severe Volume Drop';
    } else if (maxWeight === weightedEngagement && engagementScore > 10) {
      primaryDriver = 'Slipping Portal Engagement';
    } else if (maxWeight === weightedRecency && recencyScore > 10) {
      primaryDriver = 'Inactivity / Transaction Recency';
    } else if (maxWeight === weightedError && errorScore > 10) {
      primaryDriver = 'API Integration Failures';
    } else if (maxWeight === weightedSupport && supportScore > 10) {
      primaryDriver = 'Unresolved Support Issues';
    } else {
      // Fallback ordered list
      if (velocityScore > 30) primaryDriver = 'Severe Volume Drop';
      else if (engagementScore > 30) primaryDriver = 'Slipping Portal Engagement';
      else if (recencyScore > 30) primaryDriver = 'Inactivity / Transaction Recency';
      else if (errorScore > 30) primaryDriver = 'API Integration Failures';
      else if (supportScore > 30) primaryDriver = 'Unresolved Support Issues';
    }
  }

  return {
    compositeScore,
    level,
    subScores: {
      recency: recencyScore,
      velocity: velocityScore,
      engagement: engagementScore,
      error: errorScore,
      support: supportScore,
    },
    primaryDriver,
  };
}
