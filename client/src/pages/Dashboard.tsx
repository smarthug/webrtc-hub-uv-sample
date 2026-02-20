import { useEffect, useState } from 'react';
import { useWebRTC } from '../hooks/useWebRTC';
import ReactECharts from 'echarts-for-react';
import { PeripheralCards } from '../components/PeripheralCards';
import { StatusInsightCard } from '../components/StatusInsightCard';
import { PredictionHeatmap } from '../components/PredictionHeatmap';

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

  // Extract data by engine
  const ecodData = anomalies
    .flatMap(a => a.detections?.filter(d => d.engine === 'ecod') || [])
    .slice(-100);
  
  const arimaData = anomalies
    .flatMap(a => a.detections?.filter(d => d.engine === 'arima') || [])
    .slice(-50);

  const peripheralAlerts = anomalies
    .flatMap(a => a.detections?.filter(d => d.engine === 'peripheral') || [])
    .slice(-20);

  // Get CPU and Memory ARIMA data separately
  const cpuArimaData = arimaData.filter(d => d.metric === 'CPU');
  const memArimaData = arimaData.filter(d => d.metric === 'Memory');
  
  // Latest forecasts for heatmap
  const latestCpuArima = cpuArimaData.length > 0 ? cpuArimaData[cpuArimaData.length - 1] : null;
  const latestMemArima = memArimaData.length > 0 ? memArimaData[memArimaData.length - 1] : null;

  // ECOD Multivariate Score Chart
  const ecodChartOption = {
    title: { text: '🔍 ECOD 다변량 이상 점수', left: 'center', textStyle: { fontSize: 14, color: '#e2e8f0' } },
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0, data: ['Multivariate', 'CPU', 'Memory', 'DiskIO'], textStyle: { color: '#94a3b8' } },
    grid: { left: '10%', right: '5%', top: '18%', bottom: '18%' },
    xAxis: { type: 'category', data: ecodData.filter(d => d.metric === 'Multivariate').map((_, i) => i + 1), axisLabel: { color: '#94a3b8' } },
    yAxis: { type: 'value', name: 'Score', min: 0, max: 1, axisLabel: { color: '#94a3b8' }, nameTextStyle: { color: '#94a3b8' } },
    series: [
      {
        name: 'Multivariate',
        type: 'line',
        data: ecodData.filter(d => d.metric === 'Multivariate').map(d => d.score),
        itemStyle: { color: '#f43f5e' },
        lineStyle: { width: 3 },
        smooth: true,
        areaStyle: { color: 'rgba(244, 63, 94, 0.2)' },
      },
      {
        name: 'CPU',
        type: 'line',
        data: ecodData.filter(d => d.metric === 'CPU').map(d => d.score),
        itemStyle: { color: '#3b82f6' },
        smooth: true,
      },
      {
        name: 'Memory',
        type: 'line',
        data: ecodData.filter(d => d.metric === 'Memory').map(d => d.score),
        itemStyle: { color: '#22c55e' },
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

  // ARIMA Forecast vs Actual Chart (simple version)
  const arimaChartOption = {
    title: { text: '📈 AutoARIMA 예측 vs 실제', left: 'center', textStyle: { fontSize: 14, color: '#e2e8f0' } },
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0, data: ['실제값', '예측값', '잔차'], textStyle: { color: '#94a3b8' } },
    grid: { left: '10%', right: '10%', top: '18%', bottom: '18%' },
    xAxis: { type: 'category', data: cpuArimaData.map((_, i) => i + 1), axisLabel: { color: '#94a3b8' } },
    yAxis: [
      { type: 'value', name: 'Value', position: 'left', axisLabel: { color: '#94a3b8' }, nameTextStyle: { color: '#94a3b8' } },
      { type: 'value', name: 'Residual', position: 'right', axisLabel: { color: '#94a3b8' }, nameTextStyle: { color: '#94a3b8' } },
    ],
    series: [
      {
        name: '실제값',
        type: 'line',
        data: cpuArimaData.map(d => d.value),
        itemStyle: { color: '#22c55e' },
        smooth: true,
      },
      {
        name: '예측값',
        type: 'line',
        data: cpuArimaData.map(d => d.forecast),
        itemStyle: { color: '#8b5cf6' },
        lineStyle: { type: 'dashed' },
        smooth: true,
      },
      {
        name: '잔차',
        type: 'bar',
        yAxisIndex: 1,
        data: cpuArimaData.map(d => d.residual),
        itemStyle: { 
          color: (params: any) => {
            const threshold = cpuArimaData[params.dataIndex]?.threshold || 1;
            return params.value > threshold ? '#ef4444' : '#64748b';
          }
        },
      },
    ],
  };

  // All detections for table (exclude ensemble)
  const allDetections = anomalies
    .flatMap(a => (a.detections || []).map(d => ({ ...d, timestamp: a.timestamp })))
    .slice(-30)
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
          <h1 style={{ margin: 0, fontSize: '24px' }}>🧠 PulseAI Lite v2.0</h1>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#94a3b8' }}>
            다변량 ECOD 이상탐지 + AutoARIMA 미래예측
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
          }}>
            {healthScore >= 80 ? '💚' : healthScore >= 50 ? '💛' : '❤️'}
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
            }} />
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </header>

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '20px' }}>
        <StatCard title="수신 데이터" value={metrics.length} icon="📊" />
        <StatCard title="ECOD 분석" value={ecodData.filter(d => d.metric === 'Multivariate').length} icon="🔍" color="#f43f5e" />
        <StatCard title="ARIMA 예측" value={arimaData.length} icon="📈" color="#8b5cf6" />
        <StatCard title="주변장치 경고" value={peripheralAlerts.length} icon="⚠️" color="#f59e0b" />
      </div>

      {/* Charts Row 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px', marginBottom: '20px' }}>
        <div style={{ backgroundColor: '#1e293b', borderRadius: '12px', padding: '16px' }}>
          <ReactECharts option={ecodChartOption} style={{ height: '300px' }} />
        </div>
        {/* Status Insight Card - 앙상블 게이지 대체 */}
        <StatusInsightCard 
          detections={anomalies.length > 0 ? anomalies[anomalies.length - 1].detections || [] : []}
          healthScore={healthScore}
        />
      </div>

      {/* Charts Row 2 - ARIMA */}
      <div style={{ backgroundColor: '#1e293b', borderRadius: '12px', padding: '16px', marginBottom: '20px' }}>
        <ReactECharts option={arimaChartOption} style={{ height: '280px' }} />
      </div>

      {/* Prediction Heatmap Timeline */}
      <PredictionHeatmap
        cpuForecasts={latestCpuArima?.forecast_horizon || []}
        memoryForecasts={latestMemArima?.forecast_horizon || []}
        currentCpu={latestCpuArima?.value || 0}
        currentMemory={latestMemArima?.value || 0}
      />

      {/* Peripheral Status Cards */}
      <PeripheralCards alerts={peripheralAlerts} />

      {/* Detection Table */}
      <div style={{ backgroundColor: '#1e293b', borderRadius: '12px', padding: '16px' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '16px' }}>📋 탐지 히스토리</h3>
        {allDetections.length === 0 ? (
          <p style={{ color: '#64748b', textAlign: 'center', padding: '40px' }}>
            데이터 수집 중... (ECOD: 10초, ARIMA: 60초 주기)
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155' }}>
                  <th style={{ padding: '10px', textAlign: 'left', color: '#94a3b8' }}>시간</th>
                  <th style={{ padding: '10px', textAlign: 'left', color: '#94a3b8' }}>엔진</th>
                  <th style={{ padding: '10px', textAlign: 'left', color: '#94a3b8' }}>메트릭</th>
                  <th style={{ padding: '10px', textAlign: 'right', color: '#94a3b8' }}>Score</th>
                  <th style={{ padding: '10px', textAlign: 'right', color: '#94a3b8' }}>신뢰도</th>
                  <th style={{ padding: '10px', textAlign: 'center', color: '#94a3b8' }}>심각도</th>
                  <th style={{ padding: '10px', textAlign: 'left', color: '#94a3b8' }}>상세</th>
                </tr>
              </thead>
              <tbody>
                {allDetections.map((d, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '8px 10px' }}>{d.timestamp?.split(' ')[1] || '-'}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <EngineTag engine={d.engine} />
                    </td>
                    <td style={{ padding: '8px 10px' }}>{d.metric}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>{d.score?.toFixed(3)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      {d.confidence ? `${(d.confidence * 100).toFixed(0)}%` : '-'}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <SeverityTag severity={d.severity} />
                    </td>
                    <td style={{ padding: '8px 10px', color: '#94a3b8', fontSize: '11px' }}>
                      {d.details || (d.forecast ? `예측: ${d.forecast?.toFixed(1)}` : '-')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
      <div style={{ fontSize: '20px', marginBottom: '4px' }}>{icon}</div>
      <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{value}</div>
      <div style={{ fontSize: '11px', color: '#94a3b8' }}>{title}</div>
    </div>
  );
}

function EngineTag({ engine }: { engine: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    ecod: { bg: '#1e3a5f', text: '#60a5fa' },
    arima: { bg: '#3b1c4a', text: '#c084fc' },
    ensemble: { bg: '#134e4a', text: '#5eead4' },
    peripheral: { bg: '#713f12', text: '#fcd34d' },
  };
  const c = colors[engine] || { bg: '#374151', text: '#9ca3af' };
  
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: '4px',
      backgroundColor: c.bg,
      color: c.text,
      fontSize: '10px',
      fontWeight: 'bold',
    }}>
      {engine.toUpperCase()}
    </span>
  );
}

function SeverityTag({ severity }: { severity: string }) {
  const styles: Record<string, { bg: string; text: string; icon: string }> = {
    critical: { bg: '#7f1d1d', text: '#fca5a5', icon: '🔴' },
    warning: { bg: '#713f12', text: '#fcd34d', icon: '🟡' },
    normal: { bg: '#14532d', text: '#86efac', icon: '🟢' },
  };
  const s = styles[severity] || styles.normal;
  
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: '4px',
      backgroundColor: s.bg,
      color: s.text,
      fontSize: '10px',
    }}>
      {s.icon} {severity}
    </span>
  );
}
