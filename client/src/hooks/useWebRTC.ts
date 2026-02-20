import { useCallback, useEffect, useRef, useState } from 'react';

interface WebRTCConfig {
  serverUrl: string;
  clientId: string;
  role?: string;
}

interface MetricsData {
  type: 'metrics';
  agent_id: string;
  timestamp: string;
  cpu: number;
  memory: number;
  disk_io: number;
  network: { Sent: number; Recv: number };
}

interface AnomalyData {
  type: 'anomaly';
  agent_id: string;
  timestamp: string;
  detections: Array<{
    engine: string;
    metric: string;
    value: number;
    score: number;
    threshold: number;
    forecast?: number;
    residual?: number;
    severity: string;
  }>;
  health_score: number;
  raw_metrics: Record<string, number>;
}

type MessageData = MetricsData | AnomalyData | { type: string; [key: string]: any };

export function useWebRTC(config: WebRTCConfig) {
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState<string>('unknown');
  const [metrics, setMetrics] = useState<MetricsData[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyData[]>([]);
  const [healthScore, setHealthScore] = useState(100);
  
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const metricsBufferRef = useRef<MetricsData[]>([]);
  const anomaliesBufferRef = useRef<AnomalyData[]>([]);

  const connect = useCallback(async () => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
    pcRef.current = pc;

    // Create data channel
    const channel = pc.createDataChannel('pulseai');
    channelRef.current = channel;

    channel.onopen = () => {
      console.log('DataChannel opened');
      setConnected(true);
      // Send hello
      channel.send(JSON.stringify({ type: 'hello', role: config.role || 'viewer' }));
    };

    channel.onclose = () => {
      console.log('DataChannel closed');
      setConnected(false);
    };

    channel.onmessage = (event) => {
      try {
        const data: MessageData = JSON.parse(event.data);
        
        if (data.type === 'welcome') {
          setMode(data.mode || 'unknown');
        } else if (data.type === 'metrics') {
          const metricsData = data as MetricsData;
          metricsBufferRef.current = [...metricsBufferRef.current.slice(-99), metricsData];
          setMetrics([...metricsBufferRef.current]);
        } else if (data.type === 'anomaly') {
          const anomalyData = data as AnomalyData;
          setHealthScore(anomalyData.health_score);
          if (anomalyData.detections.length > 0) {
            anomaliesBufferRef.current = [...anomaliesBufferRef.current.slice(-49), anomalyData];
            setAnomalies([...anomaliesBufferRef.current]);
          }
        }
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };

    // ICE candidate handling
    pc.onicecandidate = (event) => {
      if (event.candidate === null) {
        // ICE gathering complete
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setConnected(false);
      }
    };

    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Wait for ICE gathering
    await new Promise<void>((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve();
      } else {
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') {
            resolve();
          }
        };
      }
    });

    // Send offer to server
    const response = await fetch(
      `${config.serverUrl}/offer?client_id=${config.clientId}&role=${config.role || 'viewer'}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sdp: pc.localDescription?.sdp,
          type: pc.localDescription?.type,
        }),
      }
    );

    const answer = await response.json();
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }, [config]);

  const disconnect = useCallback(() => {
    if (channelRef.current) {
      channelRef.current.close();
    }
    if (pcRef.current) {
      pcRef.current.close();
    }
    setConnected(false);
  }, []);

  const sendMessage = useCallback((msg: object) => {
    if (channelRef.current && channelRef.current.readyState === 'open') {
      channelRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    connected,
    mode,
    metrics,
    anomalies,
    healthScore,
    connect,
    disconnect,
    sendMessage,
  };
}
