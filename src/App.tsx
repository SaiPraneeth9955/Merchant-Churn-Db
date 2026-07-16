import React, { useState, useEffect, useRef } from 'react';
import './App.css';

interface MerchantSummary {
  merchant_id: string;
  business_name: string;
  contact_email: string;
  industry_vertical: string;
  pricing_tier: string;
  signup_date: string;
  current_status: string;
  risk_score: number;
  risk_level: 'Low' | 'Medium' | 'High';
  primary_driver: string;
  volume_30d: number;
  count_30d: number;
}

interface AnalyticsCounts {
  Low: number;
  Medium: number;
  High: number;
  Total: number;
}

interface AnalyticsData {
  counts: AnalyticsCounts;
  totalVolume30d: number;
  atRiskVolume30d: number;
  riskTrend: { date: string; Low: number; Medium: number; High: number }[];
}

interface Ticket {
  ticket_id: string;
  merchant_id: string;
  created_date: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  ticket_status: 'OPEN' | 'PENDING' | 'CLOSED';
  category: string;
}

interface AuditAction {
  action_id: string;
  merchant_id: string;
  action_type: string;
  action_description: string;
  executed_at: string;
}

interface MerchantDetails {
  profile: {
    merchant_id: string;
    business_name: string;
    contact_email: string;
    industry_vertical: string;
    pricing_tier: string;
    signup_date: string;
    current_status: string;
  };
  latestRiskScore: number;
  latestRiskLevel: 'Low' | 'Medium' | 'High';
  latestPrimaryDriver: string;
  breakdown: {
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
  };
  metrics: {
    daysSinceLastTransaction: number;
    lastTransactionDate: string | null;
    volumeCurrent30d: number;
    volumeBaseline30d: number;
    activeDaysCurrent30d: number;
    activeDaysBaseline30d: number;
    apiErrorRate30d: number;
    openUrgentTickets: number;
    openMediumTickets: number;
  };
  tickets: Ticket[];
  riskHistory: { calculated_date: string; risk_score: number }[];
  transactionHistory: {
    record_date: string;
    transaction_volume_usd: number;
    transaction_count: number;
    failed_transaction_count: number;
  }[];
  auditActions: AuditAction[];
}

const INDUSTRIES = ['SaaS', 'E-commerce', 'Retail', 'Travel', 'Food & Beverage', 'Services'];

export default function App() {
  // Main Lists states
  const [merchants, setMerchants] = useState<MerchantSummary[]>([]);
  const [totalMerchants, setTotalMerchants] = useState(0);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  
  // Filtering & Sorting
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRisk, setFilterRisk] = useState('');
  const [filterIndustry, setFilterIndustry] = useState('');
  const [sortBy, setSortBy] = useState('riskScore_desc');
  const [systemDate, setSystemDate] = useState('');

  // Loading States
  const [loadingList, setLoadingList] = useState(true);
  const [loadingAnalytics, setLoadingAnalytics] = useState(true);

  // Inspector Panel (Modal Drawer)
  const [selectedMerchantId, setSelectedMerchantId] = useState<string | null>(null);
  const [merchantDetails, setMerchantDetails] = useState<MerchantDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsTab, setDetailsTab] = useState<'overview' | 'history' | 'support' | 'audit'>('overview');

  // Remediating action executing state
  const [actionExecuting, setActionExecuting] = useState(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  // Chart Tooltip Hover State
  const [hoveredTrendIdx, setHoveredTrendIdx] = useState<number | null>(null);
  const [hoveredTrendCoords, setHoveredTrendCoords] = useState<{ x: number; y: number } | null>(null);
  const trendChartRef = useRef<SVGSVGElement>(null);

  // Fetch Lists
  const fetchMerchants = async () => {
    setLoadingList(true);
    try {
      const url = `http://localhost:5000/api/merchants?q=${encodeURIComponent(searchTerm)}&riskLevel=${filterRisk}&industry=${filterIndustry}&sort=${sortBy}`;
      const response = await fetch(url);
      const data = await response.json();
      setMerchants(data.merchants);
      setTotalMerchants(data.total);
      setSystemDate(data.systemDate);
    } catch (error) {
      console.error('Error fetching merchants list:', error);
    } finally {
      setLoadingList(false);
    }
  };

  // Fetch Analytics Overview
  const fetchAnalytics = async () => {
    setLoadingAnalytics(true);
    try {
      const response = await fetch('http://localhost:5000/api/analytics');
      const data = await response.json();
      setAnalytics(data);
    } catch (error) {
      console.error('Error fetching analytics counts:', error);
    } finally {
      setLoadingAnalytics(false);
    }
  };

  // Fetch Merchant Details
  const fetchDetails = async (id: string) => {
    setLoadingDetails(true);
    setDetailsTab('overview');
    setActionSuccessMessage(null);
    try {
      const response = await fetch(`http://localhost:5000/api/merchants/${id}`);
      if (response.ok) {
        const data = await response.json();
        setMerchantDetails(data);
      } else {
        console.error('Failed to load merchant details');
      }
    } catch (error) {
      console.error('Error fetching details:', error);
    } finally {
      setLoadingDetails(false);
    }
  };

  // Trigger Action
  const executePlaybookAction = async (actionType: string, actionDesc: string) => {
    if (!selectedMerchantId) return;
    setActionExecuting(true);
    setActionSuccessMessage(null);
    try {
      const response = await fetch(`http://localhost:5000/api/merchants/${selectedMerchantId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionType,
          actionDescription: actionDesc,
        }),
      });

      if (response.ok) {
        setActionSuccessMessage(`Successfully triggered: "${actionType}"`);
        // Refresh details (specifically the tickets and auditActions list)
        await fetchDetails(selectedMerchantId);
        // Refresh global analytics and lists too
        fetchAnalytics();
        fetchMerchants();
      } else {
        console.error('Error execution action');
      }
    } catch (error) {
      console.error('Error executing action:', error);
    } finally {
      setActionExecuting(false);
    }
  };

  // Trigger search fetch on filters change
  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      fetchMerchants();
    }, 200);

    return () => clearTimeout(delayDebounce);
  }, [searchTerm, filterRisk, filterIndustry, sortBy]);

  // Initial Fetch
  useEffect(() => {
    fetchAnalytics();
  }, []);

  // Handle Detail selection
  useEffect(() => {
    if (selectedMerchantId) {
      fetchDetails(selectedMerchantId);
    } else {
      setMerchantDetails(null);
    }
  }, [selectedMerchantId]);

  // Format currency helper
  const formatUSD = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(val);
  };

  // Format date readable
  const formatReadableDate = (dateStr: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Handle Chart Move
  const handleTrendMouseMove = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (!analytics || !analytics.riskTrend || analytics.riskTrend.length === 0 || !trendChartRef.current) return;

    const svg = trendChartRef.current;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left - 40; // Subtract padding-left (40)
    const chartWidth = rect.width - 60;   // Chart bounding width excluding left/right pads

    if (x < 0 || x > chartWidth) {
      setHoveredTrendIdx(null);
      setHoveredTrendCoords(null);
      return;
    }

    const totalDays = analytics.riskTrend.length;
    const dayWidth = chartWidth / (totalDays - 1);
    const dayIndex = Math.max(0, Math.min(totalDays - 1, Math.round(x / dayWidth)));

    setHoveredTrendIdx(dayIndex);
    // Relative coordinates
    setHoveredTrendCoords({
      x: dayIndex * dayWidth + 40,
      y: e.clientY - rect.top - 50 // slightly above cursor
    });
  };

  const handleTrendMouseLeave = () => {
    setHoveredTrendIdx(null);
    setHoveredTrendCoords(null);
  };

  // Render SVG Risk Trend Line Chart
  const renderTrendChart = () => {
    if (!analytics || !analytics.riskTrend || analytics.riskTrend.length === 0) {
      return <div className="empty-state">No trend data available</div>;
    }

    const trend = analytics.riskTrend;
    const totalDays = trend.length;
    const width = 800;
    const height = 240;
    const paddingLeft = 40;
    const paddingRight = 20;
    const paddingTop = 10;
    const paddingBottom = 30;

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    // Find Max Y
    let maxY = 10;
    trend.forEach(d => {
      const sum = d.Low + d.Medium + d.High;
      if (sum > maxY) maxY = sum;
    });
    maxY = Math.ceil(maxY / 5) * 5; // round up to multiple of 5

    // Helper: Map index to X coord
    const getX = (idx: number) => paddingLeft + (idx / (totalDays - 1)) * chartWidth;
    // Helper: Map value to Y coord
    const getY = (val: number) => paddingTop + chartHeight - (val / maxY) * chartHeight;

    // Build Line Path Functions
    const buildLinePath = (key: 'High' | 'Medium' | 'Low') => {
      let path = '';
      trend.forEach((d, idx) => {
        const x = getX(idx);
        const y = getY(d[key]);
        if (idx === 0) path += `M ${x} ${y}`;
        else path += ` L ${x} ${y}`;
      });
      return path;
    };

    const pathHigh = buildLinePath('High');
    const pathMedium = buildLinePath('Medium');
    const pathLow = buildLinePath('Low');

    // Build gridlines
    const yGridValues = [0, maxY * 0.25, maxY * 0.5, maxY * 0.75, maxY];

    // Pick 5 date labels
    const labelIndexes = [
      0,
      Math.floor(totalDays * 0.25),
      Math.floor(totalDays * 0.5),
      Math.floor(totalDays * 0.75),
      totalDays - 1
    ];

    return (
      <div className="chart-container-relative">
        <svg
          ref={trendChartRef}
          className="chart-svg"
          viewBox={`0 0 ${width} ${height}`}
          onMouseMove={handleTrendMouseMove}
          onMouseLeave={handleTrendMouseLeave}
        >
          {/* Grids */}
          {yGridValues.map((v, i) => {
            const y = getY(v);
            return (
              <g key={i}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={width - paddingRight}
                  y2={y}
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth="1"
                />
                <text
                  x={paddingLeft - 8}
                  y={y + 4}
                  fill="var(--text-secondary)"
                  fontSize="10"
                  textAnchor="end"
                >
                  {Math.round(v)}
                </text>
              </g>
            );
          })}

          {/* Lines */}
          <path d={pathLow} fill="none" stroke="var(--color-low)" strokeWidth="2.5" opacity="0.85" />
          <path d={pathMedium} fill="none" stroke="var(--color-medium)" strokeWidth="2.5" opacity="0.85" />
          <path d={pathHigh} fill="none" stroke="var(--color-high)" strokeWidth="2.5" opacity="0.9" />

          {/* Interactive Line indicator */}
          {hoveredTrendIdx !== null && hoveredTrendCoords && (
            <line
              x1={hoveredTrendCoords.x}
              y1={paddingTop}
              x2={hoveredTrendCoords.x}
              y2={paddingTop + chartHeight}
              stroke="rgba(255, 255, 255, 0.25)"
              strokeDasharray="4,4"
              strokeWidth="1.5"
            />
          )}

          {/* X Axis Date Labels */}
          {labelIndexes.map(idx => {
            if (idx >= totalDays) return null;
            return (
              <text
                key={idx}
                x={getX(idx)}
                y={height - 8}
                fill="var(--text-secondary)"
                fontSize="10"
                textAnchor="middle"
              >
                {formatReadableDate(trend[idx].date)}
              </text>
            );
          })}
        </svg>

        {/* Floating Tooltip Card */}
        {hoveredTrendIdx !== null && hoveredTrendCoords && (
          <div
            className="chart-tooltip"
            style={{
              left: `${hoveredTrendCoords.x + 10}px`,
              top: `${hoveredTrendCoords.y}px`
            }}
          >
            <div className="tooltip-date">
              {formatReadableDate(trend[hoveredTrendIdx].date)}
            </div>
            <div className="tooltip-row">
              <span className="legend-item"><span className="legend-dot high"></span>High Risk</span>
              <span style={{ color: 'var(--color-high)', fontWeight: 'bold' }}>
                {trend[hoveredTrendIdx].High}
              </span>
            </div>
            <div className="tooltip-row">
              <span className="legend-item"><span className="legend-dot medium"></span>Medium Risk</span>
              <span style={{ color: 'var(--color-medium)', fontWeight: 'bold' }}>
                {trend[hoveredTrendIdx].Medium}
              </span>
            </div>
            <div className="tooltip-row">
              <span className="legend-item"><span className="legend-dot low"></span>Low Risk</span>
              <span style={{ color: 'var(--color-low)', fontWeight: 'bold' }}>
                {trend[hoveredTrendIdx].Low}
              </span>
            </div>
            <div className="tooltip-row" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '4px', paddingTop: '4px' }}>
              <span>Total Active</span>
              <span style={{ fontWeight: 'bold' }}>
                {trend[hoveredTrendIdx].High + trend[hoveredTrendIdx].Medium + trend[hoveredTrendIdx].Low}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Render Indiv. Merchant Risk Score History Chart
  const renderMerchantRiskChart = () => {
    if (!merchantDetails || !merchantDetails.riskHistory || merchantDetails.riskHistory.length === 0) {
      return <div className="empty-state">No score trend details</div>;
    }

    const data = merchantDetails.riskHistory;
    const width = 600;
    const height = 150;
    const paddingLeft = 30;
    const paddingRight = 10;
    const paddingTop = 10;
    const paddingBottom = 20;

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;
    const totalPoints = data.length;

    const getX = (idx: number) => paddingLeft + (idx / (totalPoints - 1)) * chartWidth;
    const getY = (val: number) => paddingTop + chartHeight - (val / 100) * chartHeight;

    let path = '';
    data.forEach((d, idx) => {
      const x = getX(idx);
      const y = getY(d.risk_score);
      if (idx === 0) path += `M ${x} ${y}`;
      else path += ` L ${x} ${y}`;
    });

    return (
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        {/* Grids for 0, 40, 70, 100 */}
        {[0, 40, 70, 100].map(v => {
          const y = getY(v);
          return (
            <g key={v}>
              <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              <text x={paddingLeft - 6} y={y + 3} fill="var(--text-secondary)" fontSize="9" textAnchor="end">{v}</text>
            </g>
          );
        })}
        {/* Draw Path */}
        <path d={path} fill="none" stroke="var(--accent-color)" strokeWidth="2.5" opacity="0.9" />
        {/* Label endpoints */}
        <text x={getX(0)} y={height - 4} fill="var(--text-muted)" fontSize="9" textAnchor="start">
          {formatReadableDate(data[0].calculated_date)}
        </text>
        <text x={getX(totalPoints - 1)} y={height - 4} fill="var(--text-muted)" fontSize="9" textAnchor="end">
          {formatReadableDate(data[totalPoints - 1].calculated_date)}
        </text>
      </svg>
    );
  };

  // Render Indiv. Merchant volume trend bar chart
  const renderMerchantVolumeChart = () => {
    if (!merchantDetails || !merchantDetails.transactionHistory || merchantDetails.transactionHistory.length === 0) {
      return <div className="empty-state">No transaction history</div>;
    }

    const data = merchantDetails.transactionHistory;
    const width = 600;
    const height = 150;
    const paddingLeft = 45;
    const paddingRight = 10;
    const paddingTop = 10;
    const paddingBottom = 20;

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;
    const totalPoints = data.length;

    let maxVol = 100;
    data.forEach(d => {
      if (d.transaction_volume_usd > maxVol) maxVol = d.transaction_volume_usd;
    });
    maxVol = Math.ceil(maxVol / 1000) * 1000;

    const getX = (idx: number) => paddingLeft + (idx / (totalPoints - 1)) * chartWidth;
    const getY = (val: number) => paddingTop + chartHeight - (val / maxVol) * chartHeight;

    let path = '';
    data.forEach((d, idx) => {
      const x = getX(idx);
      const y = getY(d.transaction_volume_usd);
      if (idx === 0) path += `M ${x} ${y}`;
      else path += ` L ${x} ${y}`;
    });

    return (
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        {[0, maxVol * 0.5, maxVol].map(v => {
          const y = getY(v);
          return (
            <g key={v}>
              <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              <text x={paddingLeft - 6} y={y + 3} fill="var(--text-secondary)" fontSize="9" textAnchor="end">${Math.round(v)}</text>
            </g>
          );
        })}
        <path d={path} fill="none" stroke="var(--color-low)" strokeWidth="2" opacity="0.8" />
        <text x={getX(0)} y={height - 4} fill="var(--text-muted)" fontSize="9" textAnchor="start">
          {formatReadableDate(data[0].record_date)}
        </text>
        <text x={getX(totalPoints - 1)} y={height - 4} fill="var(--text-muted)" fontSize="9" textAnchor="end">
          {formatReadableDate(data[totalPoints - 1].record_date)}
        </text>
      </svg>
    );
  };

  // Remediating action configurations based on primary driver
  const getOutreachRecommendation = (driver: string, score: number) => {
    if (score < 40) {
      return {
        title: 'Healthy Merchant Lifecycle Outreach',
        desc: 'Review usage reports and schedule standard annual account check-in. Merchant is performing robustly.',
        type: 'Standard Review',
        actionDesc: 'Completed annual account check-in. Confirmed merchant is happy and operations are normal.',
      };
    }

    switch (driver) {
      case 'Severe Volume Drop':
        return {
          title: 'Immediate Fee Discount & Competitive Pricing Offering',
          desc: 'Merchant transaction volume has dropped sharply, indicating they might be switching volume to a competitor. Propose a temporary transaction fee discount (e.g. reduction of 20 bps for the next 90 days) to lock them back in.',
          type: 'Promotional Pricing Offer',
          actionDesc: 'Offered temporary fee discount of 20 bps to lock volume. Sent contract update link.',
        };
      case 'Inactivity / Transaction Recency':
        return {
          title: 'Gateway Integration Check-In Call',
          desc: 'Merchant has processed zero volume in several days. Trigger outreach phone call immediately to determine if they are facing API failures or have decided to change processor.',
          type: 'Gateway Check-in Call',
          actionDesc: 'Triggered immediate phone call to merchant to investigate integration downtime.',
        };
      case 'Slipping Portal Engagement':
        return {
          title: 'Feature Tour & Engagement Survey Outreach',
          desc: 'Merchant transaction active days are dropping off. Send an email campaign offering portal features, integration tutorials, or a brief feedback survey seeking comments on their pain points.',
          type: 'Customer Feedback Survey',
          actionDesc: 'Triggered automated Portal Feature update email and customer pain point survey.',
        };
      case 'API Integration Failures':
        return {
          title: 'Developer Support Direct Assignment',
          desc: 'Merchant has experienced elevated API error rates in the last 30 days. CSM should immediately assign a support engineer to review integrations logs and email custom code snippets to their developer contact.',
          type: 'Developer Assistance Call',
          actionDesc: 'Assigned integration engineer to inspect developer logs and send integration repair script.',
        };
      case 'Unresolved Support Issues':
        return {
          title: 'Priority Support Escalation call',
          desc: 'Merchant has open, unresolved urgent tickets. Escalating support status is critical. Request the Support Team Manager call the merchant contacts immediately to resolve all pending billing/integration disputes.',
          type: 'Priority Ticket Escalation',
          actionDesc: 'Escalated open tickets to Urgent and scheduled CS team resolution call with merchant.',
        };
      default:
        return {
          title: 'Customer Success Manager Check-in',
          desc: 'Establish proactive communication with merchant contact to verify health check list.',
          type: 'CSM Review Call',
          actionDesc: 'Sent follow-up CSM check-in inquiry to merchant contacts.',
        };
    }
  };

  return (
    <div className="app-container">
      <div className="main-content">
        {/* Header */}
        <header className="dashboard-header">
          <div className="brand-section">
            <div className="logo-icon">Ag</div>
            <div>
              <h1>Merchant Churn Dashboard</h1>
              <div className="brand-subtitle">Proactive Risk Scoring & Remediation Console</div>
            </div>
          </div>
          <div className="system-status">
            <div className="system-date-badge">
              Evaluation Date: {systemDate || 'Retrieving...'}
            </div>
          </div>
        </header>

        {/* KPIs */}
        {loadingAnalytics ? (
          <div className="kpi-grid">
            {[1, 2, 3, 4].map(n => (
              <div className="glass-panel kpi-card" key={n}>
                <div className="loader" style={{ margin: 'auto' }}></div>
              </div>
            ))}
          </div>
        ) : analytics ? (
          <div className="kpi-grid">
            <div className="glass-panel kpi-card kpi-high">
              <span className="kpi-title">High Risk Merchants</span>
              <span className="kpi-value">{analytics.counts.High}</span>
              <span className="kpi-subtitle">
                {((analytics.counts.High / analytics.counts.Total) * 100).toFixed(1)}% of active base
              </span>
            </div>
            <div className="glass-panel kpi-card kpi-medium">
              <span className="kpi-title">Medium Risk (Warning)</span>
              <span className="kpi-value">{analytics.counts.Medium}</span>
              <span className="kpi-subtitle">
                {((analytics.counts.Medium / analytics.counts.Total) * 100).toFixed(1)}% of active base
              </span>
            </div>
            <div className="glass-panel kpi-card kpi-volume">
              <span className="kpi-title">At-Risk Volume (30d)</span>
              <span className="kpi-value" style={{ color: 'var(--color-high)' }}>
                {formatUSD(analytics.atRiskVolume30d)}
              </span>
              <span className="kpi-subtitle">
                {((analytics.atRiskVolume30d / analytics.totalVolume30d) * 100).toFixed(1)}% of total processed
              </span>
            </div>
            <div className="glass-panel kpi-card kpi-volume" style={{ borderLeft: 'none' }}>
              <span className="kpi-title">Total Platform Volume (30d)</span>
              <span className="kpi-value">{formatUSD(analytics.totalVolume30d)}</span>
              <span className="kpi-subtitle">Processing across {analytics.counts.Total} merchants</span>
            </div>
          </div>
        ) : null}

        {/* Analytics Row */}
        <div className="analytics-row">
          {/* Trend Chart Card */}
          <div className="glass-panel analytics-card">
            <div className="card-header">
              <h3 className="card-title">90-Day Churn Risk Distribution Trend</h3>
              <div className="chart-legend">
                <span className="legend-item"><span className="legend-dot high"></span>High Risk</span>
                <span className="legend-item"><span className="legend-dot medium"></span>Medium</span>
                <span className="legend-item"><span className="legend-dot low"></span>Low Risk</span>
              </div>
            </div>
            {loadingAnalytics ? (
              <div className="loader" style={{ margin: 'auto' }}></div>
            ) : (
              renderTrendChart()
            )}
          </div>

          {/* Industry Distribution Bar Card */}
          <div className="glass-panel analytics-card">
            <div className="card-header">
              <h3 className="card-title">At-Risk Volume by Vertical</h3>
            </div>
            {loadingList ? (
              <div className="loader" style={{ margin: 'auto' }}></div>
            ) : (
              <div className="industry-dist-list">
                {INDUSTRIES.map(ind => {
                  // Calculate sum of volume for merchants in this industry with risk High/Medium
                  const indMerchants = merchants.filter(m => m.industry_vertical === ind);
                  const totalIndVolume = indMerchants.reduce((sum, m) => sum + m.volume_30d, 0);
                  const riskIndVolume = indMerchants
                    .filter(m => m.risk_level === 'High' || m.risk_level === 'Medium')
                    .reduce((sum, m) => sum + m.volume_30d, 0);

                  const pctRisk = totalIndVolume > 0 ? (riskIndVolume / totalIndVolume) * 100 : 0;

                  return (
                    <div className="industry-dist-row" key={ind}>
                      <div className="industry-label-row">
                        <span className="industry-name">{ind}</span>
                        <span className="industry-stats">
                          {pctRisk.toFixed(0)}% at risk
                        </span>
                      </div>
                      <div className="progress-track">
                        <div
                          className="progress-segment"
                          style={{
                            width: `${pctRisk}%`,
                            backgroundColor: pctRisk > 50 ? 'var(--color-high)' : (pctRisk > 25 ? 'var(--color-medium)' : 'var(--color-low)')
                          }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Merchant Controls & Table */}
        <section className="merchant-section">
          <h2>Merchant Churn Risk Registry ({totalMerchants} active)</h2>
          
          {/* Filters */}
          <div className="glass-panel filter-bar" style={{ padding: '16px' }}>
            <div className="filters-left">
              <div className="search-input-wrapper">
                <span className="search-icon">🔍</span>
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search business, email, or ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              <select
                className="select-filter"
                value={filterRisk}
                onChange={(e) => setFilterRisk(e.target.value)}
              >
                <option value="">All Risk Levels</option>
                <option value="High">High Risk</option>
                <option value="Medium">Medium Risk</option>
                <option value="Low">Low Risk</option>
              </select>

              <select
                className="select-filter"
                value={filterIndustry}
                onChange={(e) => setFilterIndustry(e.target.value)}
              >
                <option value="">All Industries</option>
                {INDUSTRIES.map(i => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </div>

            <select
              className="select-filter"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="riskScore_desc">Highest Risk Score</option>
              <option value="riskScore_asc">Lowest Risk Score</option>
              <option value="volume_desc">Highest 30d Volume</option>
              <option value="volume_asc">Lowest 30d Volume</option>
              <option value="name_asc">Name A-Z</option>
            </select>
          </div>

          {/* Grid Table */}
          <div className="merchant-table-wrapper glass-panel">
            {loadingList ? (
              <div className="empty-state" style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="loader"></div>
              </div>
            ) : merchants.length === 0 ? (
              <div className="empty-state">No merchants match the selected filters.</div>
            ) : (
              <table className="merchant-table">
                <thead>
                  <tr>
                    <th>Business Info</th>
                    <th>Industry</th>
                    <th>30d Volume</th>
                    <th>Risk Score</th>
                    <th>Primary Risk Driver</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {merchants.map(m => {
                    // Risk score circular progress calculations
                    const circumference = 2 * Math.PI * 15;
                    const strokeDashoffset = circumference - (m.risk_score / 100) * circumference;
                    const colorVar = m.risk_level === 'High' ? 'var(--color-high)' : (m.risk_level === 'Medium' ? 'var(--color-medium)' : 'var(--color-low)');

                    return (
                      <tr key={m.merchant_id}>
                        <td>
                          <div className="merchant-name-cell">
                            <span className="merchant-name-text">{m.business_name}</span>
                            <span className="merchant-id-text">{m.merchant_id} • {m.contact_email}</span>
                          </div>
                        </td>
                        <td>
                          <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>{m.industry_vertical}</span>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{m.pricing_tier} Tier</div>
                        </td>
                        <td>
                          <div style={{ fontWeight: '600' }}>{formatUSD(m.volume_30d)}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{m.count_30d} txs</div>
                        </td>
                        <td>
                          <div className="score-cell-wrapper">
                            <div className="score-radial">
                              <svg width="36" height="36" style={{ transform: 'rotate(-90deg)' }}>
                                <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" />
                                <circle
                                  cx="18" cy="18" r="15" fill="none"
                                  stroke={colorVar}
                                  strokeWidth="3"
                                  strokeDasharray={circumference}
                                  strokeDashoffset={strokeDashoffset}
                                  strokeLinecap="round"
                                />
                              </svg>
                              <span className="score-text-radial">{m.risk_score}</span>
                            </div>
                            <span className={`badge badge-${m.risk_level.toLowerCase()}`}>{m.risk_level}</span>
                          </div>
                        </td>
                        <td>
                          <span className="driver-text" style={{ color: m.risk_score > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                            {m.primary_driver}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn-secondary"
                            style={{ padding: '6px 12px', borderRadius: '6px', fontSize: '0.8rem' }}
                            onClick={() => setSelectedMerchantId(m.merchant_id)}
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      {/* Slide Drawer (Modal) */}
      {selectedMerchantId && (
        <div className="modal-overlay" onClick={() => setSelectedMerchantId(null)}>
          <div className="modal-drawer" onClick={(e) => e.stopPropagation()}>
            {loadingDetails ? (
              <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                <div className="loader"></div>
              </div>
            ) : merchantDetails ? (
              <>
                {/* Header */}
                <div className="modal-header">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                      <h2>{merchantDetails.profile.business_name}</h2>
                      <span className={`badge badge-${merchantDetails.latestRiskLevel.toLowerCase()}`}>
                        {merchantDetails.latestRiskLevel} Risk ({merchantDetails.latestRiskScore})
                      </span>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      ID: {merchantDetails.profile.merchant_id} • {merchantDetails.profile.contact_email}
                    </div>
                  </div>
                  <button className="close-btn" onClick={() => setSelectedMerchantId(null)}>×</button>
                </div>

                {/* Body */}
                <div className="modal-body">
                  {/* Tabs */}
                  <div className="modal-tabs">
                    <button className={`tab-btn ${detailsTab === 'overview' ? 'active' : ''}`} onClick={() => setDetailsTab('overview')}>Overview</button>
                    <button className={`tab-btn ${detailsTab === 'history' ? 'active' : ''}`} onClick={() => setDetailsTab('history')}>Performance History</button>
                    <button className={`tab-btn ${detailsTab === 'support' ? 'active' : ''}`} onClick={() => setDetailsTab('support')}>Support Tickets ({merchantDetails.tickets.length})</button>
                    <button className={`tab-btn ${detailsTab === 'audit' ? 'active' : ''}`} onClick={() => setDetailsTab('audit')}>Outreach Trail ({merchantDetails.auditActions.length})</button>
                  </div>

                  {/* Tab Contents */}
                  {detailsTab === 'overview' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                      
                      {/* Success Banner */}
                      {actionSuccessMessage && (
                        <div className="success-banner">
                          <span>✓</span> {actionSuccessMessage}
                        </div>
                      )}

                      {/* Playbook Recommendation Engine */}
                      {(() => {
                        const rec = getOutreachRecommendation(
                          merchantDetails.latestPrimaryDriver,
                          merchantDetails.latestRiskScore
                        );
                        const severityClass = merchantDetails.latestRiskLevel === 'High' ? 'high' : (merchantDetails.latestRiskLevel === 'Medium' ? 'medium' : 'low');

                        return (
                          <div className={`playbook-card playbook-${severityClass}`}>
                            <div className={`playbook-header ${severityClass}`}>
                              <span>💡</span> Recommended Retention Playbook: {rec.title}
                            </div>
                            <p className="playbook-desc">{rec.desc}</p>
                            <div className="playbook-action-area">
                              <button
                                className="btn-primary"
                                style={{ padding: '8px 14px', borderRadius: '8px', fontSize: '0.8rem' }}
                                disabled={actionExecuting}
                                onClick={() => executePlaybookAction(rec.type, rec.actionDesc)}
                              >
                                {actionExecuting ? 'Executing...' : `Execute: "${rec.type}"`}
                              </button>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Profile Summary Card */}
                      <div className="profile-summary-grid">
                        <div className="profile-item">
                          <span className="profile-label">Industry Vertical</span>
                          <span className="profile-value">{merchantDetails.profile.industry_vertical}</span>
                        </div>
                        <div className="profile-item">
                          <span className="profile-label">Pricing Tier</span>
                          <span className="profile-value">{merchantDetails.profile.pricing_tier} Tier</span>
                        </div>
                        <div className="profile-item">
                          <span className="profile-label">Signup Date</span>
                          <span className="profile-value">{formatReadableDate(merchantDetails.profile.signup_date)}</span>
                        </div>
                        <div className="profile-item">
                          <span className="profile-label">CRM Status</span>
                          <span className="profile-value" style={{ textTransform: 'capitalize' }}>{merchantDetails.profile.current_status}</span>
                        </div>
                      </div>

                      {/* Subscores Breakdowns */}
                      <div className="metric-breakdown-section">
                        <h3>Risk Signals Breakdown</h3>
                        
                        {/* Recency */}
                        <div className="breakdown-row">
                          <div className="breakdown-info">
                            <span className="breakdown-label">Transaction Inactivity Recency</span>
                            <span className="breakdown-score">
                              {merchantDetails.metrics.daysSinceLastTransaction} days ago ({merchantDetails.breakdown.subScores.recency} pts)
                            </span>
                          </div>
                          <div className="progress-track">
                            <div
                              className="progress-segment"
                              style={{
                                width: `${merchantDetails.breakdown.subScores.recency}%`,
                                backgroundColor: 'var(--accent-color)'
                              }}
                            ></div>
                          </div>
                        </div>

                        {/* Velocity */}
                        <div className="breakdown-row">
                          <div className="breakdown-info">
                            <span className="breakdown-label">Volume Velocity Drop (30d Volume vs Baseline)</span>
                            <span className="breakdown-score">
                              {formatUSD(merchantDetails.metrics.volumeCurrent30d)} / {formatUSD(merchantDetails.metrics.volumeBaseline30d)} ({merchantDetails.breakdown.subScores.velocity} pts)
                            </span>
                          </div>
                          <div className="progress-track">
                            <div
                              className="progress-segment"
                              style={{
                                width: `${merchantDetails.breakdown.subScores.velocity}%`,
                                backgroundColor: 'var(--accent-color)'
                              }}
                            ></div>
                          </div>
                        </div>

                        {/* Engagement */}
                        <div className="breakdown-row">
                          <div className="breakdown-info">
                            <span className="breakdown-label">Slipping Active Processing Days Decline</span>
                            <span className="breakdown-score">
                              {merchantDetails.metrics.openUrgentTickets > 0 ? 'Urgent Open Ticket' : `${merchantDetails.metrics.activeDaysCurrent30d} days / ${merchantDetails.metrics.activeDaysBaseline30d} baseline`} ({merchantDetails.breakdown.subScores.engagement} pts)
                            </span>
                          </div>
                          <div className="progress-track">
                            <div
                              className="progress-segment"
                              style={{
                                width: `${merchantDetails.breakdown.subScores.engagement}%`,
                                backgroundColor: 'var(--accent-color)'
                              }}
                            ></div>
                          </div>
                        </div>

                        {/* API Error */}
                        <div className="breakdown-row">
                          <div className="breakdown-info">
                            <span className="breakdown-label">Technical API Error Rate (Failed / Total attempts)</span>
                            <span className="breakdown-score">
                              {(merchantDetails.metrics.apiErrorRate30d * 100).toFixed(1)}% errors ({merchantDetails.breakdown.subScores.error} pts)
                            </span>
                          </div>
                          <div className="progress-track">
                            <div
                              className="progress-segment"
                              style={{
                                width: `${merchantDetails.breakdown.subScores.error}%`,
                                backgroundColor: 'var(--accent-color)'
                              }}
                            ></div>
                          </div>
                        </div>

                        {/* Support ticket penalty */}
                        <div className="breakdown-row">
                          <div className="breakdown-info">
                            <span className="breakdown-label">Support Friction (Urgent open tickets)</span>
                            <span className="breakdown-score">
                              {merchantDetails.metrics.openUrgentTickets} urgent, {merchantDetails.metrics.openMediumTickets} medium ({merchantDetails.breakdown.subScores.support} pts)
                            </span>
                          </div>
                          <div className="progress-track">
                            <div
                              className="progress-segment"
                              style={{
                                width: `${merchantDetails.breakdown.subScores.support}%`,
                                backgroundColor: 'var(--accent-color)'
                              }}
                            ></div>
                          </div>
                        </div>
                      </div>

                    </div>
                  )}

                  {detailsTab === 'history' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
                      <div>
                        <h3>90-Day Churn Risk Score Trend</h3>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
                          Tracks the composite risk indicator over the past three months.
                        </p>
                        <div className="glass-panel" style={{ padding: '16px 12px' }}>
                          {renderMerchantRiskChart()}
                        </div>
                      </div>

                      <div>
                        <h3>90-Day Daily Transaction Volume History (USD)</h3>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
                          Tracks raw USD processing volume to identify gradual drop-off.
                        </p>
                        <div className="glass-panel" style={{ padding: '16px 12px' }}>
                          {renderMerchantVolumeChart()}
                        </div>
                      </div>
                    </div>
                  )}

                  {detailsTab === 'support' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <h3>Active & Resolved Customer Support Tickets</h3>
                      {merchantDetails.tickets.length === 0 ? (
                        <div className="empty-state">No support tickets recorded for this merchant.</div>
                      ) : (
                        <div className="ticket-list">
                          {merchantDetails.tickets.map(t => (
                            <div className="ticket-item" key={t.ticket_id}>
                              <div className="ticket-main">
                                <div className="ticket-title-row">
                                  <span className="ticket-category">{t.category} Ticket</span>
                                  <span className="ticket-date">{formatReadableDate(t.created_date)}</span>
                                </div>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>ID: {t.ticket_id}</span>
                              </div>
                              <div className="ticket-badges">
                                <span className={`ticket-status-badge ${t.ticket_status.toLowerCase()}`}>
                                  {t.ticket_status}
                                </span>
                                <span className={`ticket-priority-badge ${t.priority.toLowerCase()}`}>
                                  {t.priority}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {detailsTab === 'audit' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <h3>CSM Remediation Action History</h3>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        Audit trail logs representing playbooks executed to recover this account.
                      </p>
                      {merchantDetails.auditActions.length === 0 ? (
                        <div className="empty-state">No actions executed yet. Propose an outreach playbook from the Overview tab.</div>
                      ) : (
                        <div className="audit-list">
                          {merchantDetails.auditActions.map(a => (
                            <div className="audit-item" key={a.action_id}>
                              <div className="audit-details">
                                <span className="audit-type">{a.action_type}</span>
                                <span className="audit-desc">{a.action_description}</span>
                              </div>
                              <span className="audit-time">{new Date(a.executed_at).toLocaleDateString()} {new Date(a.executed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-state">Unable to load merchant details.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
