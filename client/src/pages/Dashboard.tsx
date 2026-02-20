import { useEffect, useState } from 'react';
import { useWebRTC } from '../hooks/useWebRTC';
import ReactECharts from 'echarts-for-react';

function generateClientId(): string {
  return `viewer-${Math.random().toString(36).substring(2, 8)}`;
}

export function Dashboard() {
  const [clientId] = useState(generateClientId);
  const serverUrl = `${window.location.protocol}//${window.location.hostname}:8080`;
  
  const {
    connected,
    mode,
    metrics,
    anomalies,
    healthScore,
    connect,
    disconnect,
  } = useWebRTC({
    serverUrl,
    clientId,
    role: 'viewer',
  });

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Extract ECOD scores over time
  const ecodData = anomalies
    .flatMap(a => a.detections?.filter(d => d.engine === 'ecod') || [])
    .slice(-50);
  
  // Extract ARIMA data
  const arimaData = anomalies
    .flatMap(a => a.detections?.filter(d => d.engine === 'arima') || [])
    .slice(-50);

  // ECOD Score Chart
  const ecodChartOption = {
    title: { text: '🔍 ECOD Anomaly Scores', left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0, data: ['CPU', 'Memory', 'DiskIO'] },
    grid: { left: '10%', right: '5%', top: '15%', bottom: '15%' },
    xAxis: { type: 'category', data: ecodData.map((_, i) => i + 1) },
    yAxis: { type: 'value', name: 'Score', min: 0 },
    series: [
      {
        name: 'CPU',
        type: 'line',
        data: ecodData.filter(d => d.metric === 'CPU').map(d => d.score),
        itemStyle: { color: '#ef4444' },
        smooth: true,
      },
      {
        name: 'Memory',
        type: 'line', 
        data: ecodData.filter(d => d.metric === 'Memory').map(d => d.score),
        itemStyle: { color: '#3b82f6' },
        smooth: true,
      },
      {
        name: 'DiskIO',
        type: 'line',
        data: ecodData.filter(d => d.metric === 'DiskIO').map(d => d.score),
        itemStyle: { color: '#f59e0b' },
        smooth: true,
      },
    ],
  };

  // ARIMA Forecast vs Actual Chart
  const arimaChartOption = {
    title: { text: '📈 AutoARIMA: Forecast vs Actual', left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0, data: ['Actual', 'Forecast', 'Residual'] },
    grid: { left: '10%', right: '5%', top: '15%', bottom: '15%' },
    xAxis: { type: 'category', data: arimaData.map((_, i) => i + 1) },
    yAxis: [
      { type: 'value', name: 'Value', position: 'left' },
      { type: 'value', name: 'Residual', position: 'right' },
    ],
    series: [
      {
        name: 'Actual',
        type: 'line',
        data: arimaData.map(d => d.value),
        itemStyle: { color: '#22c55e' },
        smooth: true,
      },
      {
        name: 'Forecast',
        type: 'line',
        data: arimaData.map(d => d.forecast),
        itemStyle: { color: '#8b5cf6' },
        lineStyle: { type: 'dashed' },
        smooth: true,
      },
      {
        name: 'Residual',
        type: 'bar',
        yAxisIndex: 1,
        data: arimaData.map(d => d.residual),
        itemStyle: { color: '#f97316' },
      },
    ],
  };

  // All detections for table
  const allDetections = anomalies
    .flatMap(a => (a.detections || []).map(d => ({ ...d, timestamp: a.timestamp })))
    .slice(-20)
    .reverse();

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0f172a', color: '#e2e8f0', padding: '20px' }}>
      {/* Header */}
      <header style={{
        backgroundColor: '#1e293b',
        borderRadius: '12px',
        padding: '16px 24px',
        marginBottom: '20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px' }}>🧠 PulseAI Lite</h1>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#94a3b8' }}>
            ECOD + AutoARIMA 이상 탐지 대시보드
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{
            padding: '6px 12px',
            borderRadius: '16px',
            fontSize: '12px',
            backgroundColor: mode === 'sample' ? '#1e3a5f' : '#14532d',
            color: mode === 'sample' ? '#60a5fa' : '#4ade80',
          }}>
            {mode === 'sample' ? '📁 Sample' : '🔴 Live'}
          </span>
          <div style={{
            padding: '8px 16px',
            borderRadius: '8px',
            backgroundColor: healthScore >= 80 ? '#14532d' : healthScore >= 50 ? '#713f12' : '#7f1d1d',
            fontSize: '18px',
            fontWeight: 'bold',
          }}>
            ❤️ {healthScore}
          </div>
          <span style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: connected ? '#4ade80' : '#f87171',
          }}>
            <span style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: connected ? '#4ade80' : '#f87171',
              animation: connected ? 'pulse 2s infinite' : 'none',
            }} />
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </header>

      {/* Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '16px',
        marginBottom: '20px',
      }}>
        <StatCard title="수신 데이터" value={metrics.length} icon="📊" />
        <StatCard title="ECOD 탐지" value={ecodData.length} icon="🔍" color="#ef4444" />
        <StatCard title="ARIMA 탐지" value={arimaData.length} icon="📈" color="#8b5cf6" />
        <StatCard title="전체 이상" value={allDetections.length} icon="⚠️" color="#f59e0b" />
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
        <div style={{ backgroundColor: '#1e293b', borderRadius: '12px', padding: '16px' }}>
          <ReactECharts option={ecodChartOption} style={{ height: '300px' }} />
        </div>
        <div style={{ backgroundColor: '#1e293b', borderRadius: '12px', padding: '16px' }}>
          <ReactECharts option={arimaChartOption} style={{ height: '300px' }} />
        </div>
      </div>

      {/* Detection Table */}
      <div style={{ backgroundColor: '#1e293b', borderRadius: '12px', padding: '16px' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '16px' }}>🚨 최근 이상 탐지 내역</h3>
        {allDetections.length === 0 ? (
          <p style={{ color: '#64748b', textAlign: 'center', padding: '40px' }}>
            아직 탐지된 이상이 없습니다. 데이터 수집 중...
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                <th style={{ padding: '10px', textAlign: 'left', color: '#94a3b8' }}>시간</th>
                <th style={{ padding: '10px', textAlign: 'left', color: '#94a3b8' }}>엔진</th>
                <th style={{ padding: '10px', textAlign: 'left', color: '#94a3b8' }}>메트릭</th>
                <th style={{ padding: '10px', textAlign: 'right', color: '#94a3b8' }}>값</th>
                <th style={{ padding: '10px', textAlign: 'right', color: '#94a3b8' }}>Score</th>
                <th style={{ padding: '10px', textAlign: 'right', color: '#94a3b8' }}>Threshold</th>
                <th style={{ padding: '10px', textAlign: 'center', color: '#94a3b8' }}>심각도</th>
              </tr>
            </thead>
            <tbody>
              {allDetections.map((d, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '10px' }}>{d.timestamp?.split(' ')[1] || '-'}</td>
                  <td style={{ padding: '10px' }}>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: d.engine === 'ecod' ? '#1e3a5f' : '#3b1c4a',
                      color: d.engine === 'ecod' ? '#60a5fa' : '#c084fc',
                      fontSize: '11px',
                    }}>
                      {d.engine?.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: '10px' }}>{d.metric}</td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>{d.value?.toFixed(2)}</td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>{d.score?.toFixed(3)}</td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>{d.threshold?.toFixed(3)}</td>
                  <td style={{ padding: '10px', textAlign: 'center' }}>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: d.severity === 'critical' ? '#7f1d1d' : d.severity === 'warning' ? '#713f12' : '#14532d',
                      color: d.severity === 'critical' ? '#fca5a5' : d.severity === 'warning' ? '#fcd34d' : '#86efac',
                      fontSize: '11px',
                    }}>
                      {d.severity === 'critical' ? '🔴 Critical' : d.severity === 'warning' ? '🟡 Warning' : '🟢 Normal'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

function StatCard({ title, value, icon, color = '#3b82f6' }: { title: string; value: number; icon: string; color?: string }) {
  return (
    <div style={{
      backgroundColor: '#1e293b',
      borderRadius: '12px',
      padding: '16px',
      borderLeft: `4px solid ${color}`,
    }}>
      <div style={{ fontSize: '24px', marginBottom: '8px' }}>{icon}</div>
      <div style={{ fontSize: '28px', fontWeight: 'bold' }}>{value}</div>
      <div style={{ fontSize: '12px', color: '#94a3b8' }}>{title}</div>
    </div>
  );
}
