import { useEffect, useState } from 'react';
import { useWebRTC } from '../hooks/useWebRTC';
import { MetricsChart } from '../components/MetricsChart';
import { AnomalyAlert } from '../components/AnomalyAlert';
import { HealthScore } from '../components/HealthScore';

// Generate a unique client ID
function generateClientId(): string {
  return `viewer-${Math.random().toString(36).substring(2, 8)}`;
}

export function Dashboard() {
  const [clientId] = useState(generateClientId);
  const {
    connected,
    mode,
    metrics,
    anomalies,
    healthScore,
    connect,
    disconnect,
  } = useWebRTC({
    serverUrl: 'http://localhost:8080',
    clientId,
    role: 'viewer',
  });

  // Auto-connect on mount
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  const latestAgentId = metrics.length > 0 ? metrics[metrics.length - 1].agent_id : undefined;

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f3f4f6',
      padding: '20px',
    }}>
      {/* Header */}
      <header style={{
        backgroundColor: '#fff',
        borderRadius: '12px',
        padding: '16px 24px',
        marginBottom: '20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', color: '#111827' }}>
            🩺 PulseAI Lite
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#6b7280' }}>
            POS 예지 장애 탐지 대시보드
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{
            padding: '4px 12px',
            borderRadius: '16px',
            fontSize: '12px',
            backgroundColor: mode === 'sample' ? '#dbeafe' : '#dcfce7',
            color: mode === 'sample' ? '#1d4ed8' : '#166534',
          }}>
            {mode === 'sample' ? '📁 Sample Mode' : '🔴 Live Mode'}
          </span>
          <span style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '14px',
            color: connected ? '#22c55e' : '#ef4444',
          }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: connected ? '#22c55e' : '#ef4444',
            }} />
            {connected ? '연결됨' : '연결 끊김'}
          </span>
        </div>
      </header>

      {/* Main Content */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 300px',
        gap: '20px',
      }}>
        {/* Left: Charts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Metrics Charts */}
          <div style={{
            backgroundColor: '#fff',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}>
            <h2 style={{ margin: '0 0 16px', fontSize: '16px', color: '#374151' }}>
              📊 실시간 메트릭
            </h2>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '16px',
            }}>
              <MetricsChart
                data={metrics}
                title="CPU 사용률"
                metric="cpu"
                color="#3b82f6"
              />
              <MetricsChart
                data={metrics}
                title="메모리 사용률"
                metric="memory"
                color="#10b981"
              />
              <MetricsChart
                data={metrics}
                title="Disk I/O"
                metric="disk_io"
                color="#f59e0b"
              />
            </div>
          </div>

          {/* Data Info */}
          <div style={{
            backgroundColor: '#fff',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '14px', color: '#374151' }}>
              📡 데이터 수신 정보
            </h3>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '12px',
              fontSize: '13px',
            }}>
              <div style={{
                padding: '12px',
                backgroundColor: '#f9fafb',
                borderRadius: '8px',
              }}>
                <div style={{ color: '#6b7280' }}>Agent ID</div>
                <div style={{ fontWeight: 600, color: '#111827' }}>
                  {latestAgentId || '-'}
                </div>
              </div>
              <div style={{
                padding: '12px',
                backgroundColor: '#f9fafb',
                borderRadius: '8px',
              }}>
                <div style={{ color: '#6b7280' }}>수신 데이터</div>
                <div style={{ fontWeight: 600, color: '#111827' }}>
                  {metrics.length} 건
                </div>
              </div>
              <div style={{
                padding: '12px',
                backgroundColor: '#f9fafb',
                borderRadius: '8px',
              }}>
                <div style={{ color: '#6b7280' }}>이상 탐지</div>
                <div style={{ fontWeight: 600, color: anomalies.length > 0 ? '#ef4444' : '#111827' }}>
                  {anomalies.length} 건
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Health Score & Alerts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <HealthScore score={healthScore} agentId={latestAgentId} />
          
          <div style={{
            backgroundColor: '#fff',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            flex: 1,
            overflow: 'auto',
          }}>
            <AnomalyAlert anomalies={anomalies} />
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer style={{
        marginTop: '20px',
        textAlign: 'center',
        fontSize: '12px',
        color: '#9ca3af',
      }}>
        PulseAI Lite v0.2.0 | ECOD + AutoARIMA 기반 예지 장애 탐지
      </footer>
    </div>
  );
}
