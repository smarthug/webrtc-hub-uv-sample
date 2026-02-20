"""
PulseAI Lite - Anomaly Detection Engine
ECOD (실시간 이상 감지) + AutoARIMA (예측 기반 이상 탐지)
"""

import logging
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Any

import numpy as np
import pandas as pd
from pyod.models.ecod import ECOD
from statsforecast import StatsForecast
from statsforecast.models import AutoARIMA

log = logging.getLogger("detector")

# Configuration
WINDOW_SIZE = 60  # 60 data points (~5 minutes at 5s intervals)
ECOD_CONTAMINATION = 0.02  # 2% expected outliers
ARIMA_HORIZON = 6  # Predict 6 steps ahead (30 seconds)
ARIMA_RESIDUAL_K = 2.5  # k * sigma threshold


@dataclass
class MetricBuffer:
    """Circular buffer for time series data."""
    cpu: deque = field(default_factory=lambda: deque(maxlen=WINDOW_SIZE))
    memory: deque = field(default_factory=lambda: deque(maxlen=WINDOW_SIZE))
    disk_io: deque = field(default_factory=lambda: deque(maxlen=WINDOW_SIZE))
    network_sent: deque = field(default_factory=lambda: deque(maxlen=WINDOW_SIZE))
    network_recv: deque = field(default_factory=lambda: deque(maxlen=WINDOW_SIZE))
    timestamps: deque = field(default_factory=lambda: deque(maxlen=WINDOW_SIZE))


@dataclass
class AnomalyResult:
    """Single anomaly detection result."""
    engine: str  # "ecod" or "arima"
    metric: str
    value: float
    score: float = 0.0
    threshold: float = 0.0
    forecast: Optional[float] = None
    residual: Optional[float] = None
    severity: str = "normal"  # "normal", "warning", "critical"


@dataclass
class DetectionResult:
    """Full detection result for a data point."""
    agent_id: str
    timestamp: str
    detections: List[AnomalyResult] = field(default_factory=list)
    health_score: int = 100
    raw_metrics: Dict[str, float] = field(default_factory=dict)


class AnomalyDetector:
    """
    PulseAI Lite Anomaly Detector
    
    Combines:
    - ECOD: Real-time distribution-based anomaly detection
    - AutoARIMA: Forecast-based anomaly detection
    """
    
    def __init__(self):
        self.buffers: Dict[str, MetricBuffer] = {}
        self.ecod_models: Dict[str, Dict[str, ECOD]] = {}
        self.arima_models: Dict[str, Dict[str, Any]] = {}
        self.arima_residuals: Dict[str, Dict[str, deque]] = {}
        
    def _ensure_buffer(self, agent_id: str) -> MetricBuffer:
        """Ensure buffer exists for agent."""
        if agent_id not in self.buffers:
            self.buffers[agent_id] = MetricBuffer()
            self.ecod_models[agent_id] = {}
            self.arima_models[agent_id] = {}
            self.arima_residuals[agent_id] = {}
        return self.buffers[agent_id]
    
    def _update_buffer(self, agent_id: str, data: dict) -> None:
        """Update metric buffer with new data."""
        buf = self._ensure_buffer(agent_id)
        
        buf.cpu.append(data.get("CPU", 0))
        buf.memory.append(data.get("Memory", 0))
        buf.disk_io.append(data.get("DiskIO", 0))
        
        network = data.get("Network", {})
        buf.network_sent.append(network.get("Sent", 0))
        buf.network_recv.append(network.get("Recv", 0))
        
        buf.timestamps.append(data.get("Timestamp", ""))
    
    def _run_ecod(self, agent_id: str, metric_name: str, values: deque) -> Optional[AnomalyResult]:
        """Run ECOD on a single metric."""
        if len(values) < 20:  # Need minimum data
            return None
        
        arr = np.array(values).reshape(-1, 1)
        
        try:
            # Train ECOD model
            model = ECOD(contamination=ECOD_CONTAMINATION)
            model.fit(arr)
            
            # Get score for latest point
            latest = arr[-1].reshape(1, -1)
            score = model.decision_function(latest)[0]
            is_outlier = model.predict(latest)[0] == 1
            
            # Determine severity
            current_value = float(values[-1])
            threshold = float(np.percentile(arr, 98))
            
            if is_outlier:
                severity = "critical" if score > 0.9 else "warning"
            else:
                severity = "normal"
            
            return AnomalyResult(
                engine="ecod",
                metric=metric_name,
                value=current_value,
                score=float(score),
                threshold=threshold,
                severity=severity,
            )
        except Exception as e:
            log.warning(f"ECOD failed for {metric_name}: {e}")
            return None
    
    def _run_arima(self, agent_id: str, metric_name: str, values: deque) -> Optional[AnomalyResult]:
        """Run AutoARIMA forecast and detect anomalies."""
        if len(values) < 30:  # Need more data for ARIMA
            return None
        
        try:
            # Prepare data for statsforecast
            arr = np.array(values)
            df = pd.DataFrame({
                "unique_id": agent_id,
                "ds": pd.date_range(end=pd.Timestamp.now(), periods=len(arr), freq="5s"),
                "y": arr,
            })
            
            # Fit AutoARIMA
            sf = StatsForecast(
                models=[AutoARIMA(season_length=12)],
                freq="5s",
            )
            sf.fit(df)
            
            # Get forecast for next step
            forecast_df = sf.predict(h=1)
            forecast_value = float(forecast_df["AutoARIMA"].iloc[0])
            
            # Calculate residual
            actual_value = float(arr[-1])
            residual = abs(actual_value - forecast_value)
            
            # Track residuals for threshold calculation
            if metric_name not in self.arima_residuals[agent_id]:
                self.arima_residuals[agent_id][metric_name] = deque(maxlen=WINDOW_SIZE)
            self.arima_residuals[agent_id][metric_name].append(residual)
            
            # Calculate threshold based on residual history
            residual_history = np.array(self.arima_residuals[agent_id][metric_name])
            threshold = float(ARIMA_RESIDUAL_K * np.std(residual_history))
            
            # Determine severity
            if residual > threshold and len(residual_history) > 10:
                severity = "critical" if residual > threshold * 1.5 else "warning"
            else:
                severity = "normal"
            
            return AnomalyResult(
                engine="arima",
                metric=metric_name,
                value=actual_value,
                score=float(residual / max(threshold, 0.01)),
                threshold=threshold,
                forecast=forecast_value,
                residual=float(residual),
                severity=severity,
            )
        except Exception as e:
            log.warning(f"AutoARIMA failed for {metric_name}: {e}")
            return None
    
    def detect(self, data: dict) -> DetectionResult:
        """
        Run anomaly detection on incoming data.
        
        Args:
            data: POS metric data point
            
        Returns:
            DetectionResult with anomalies and health score
        """
        agent_id = data.get("AgentId", "unknown")
        timestamp = data.get("Timestamp", "")
        
        # Update buffer
        self._update_buffer(agent_id, data)
        buf = self.buffers[agent_id]
        
        detections: List[AnomalyResult] = []
        
        # Raw metrics for client
        raw_metrics = {
            "CPU": data.get("CPU", 0),
            "Memory": data.get("Memory", 0),
            "DiskIO": data.get("DiskIO", 0),
            "NetworkSent": data.get("Network", {}).get("Sent", 0),
            "NetworkRecv": data.get("Network", {}).get("Recv", 0),
        }
        
        # Run ECOD on each metric
        metrics = [
            ("CPU", buf.cpu),
            ("Memory", buf.memory),
            ("DiskIO", buf.disk_io),
        ]
        
        for metric_name, values in metrics:
            result = self._run_ecod(agent_id, metric_name, values)
            if result and result.severity != "normal":
                detections.append(result)
        
        # Run ARIMA on key metrics (less frequently due to cost)
        if len(buf.cpu) >= 30 and len(buf.cpu) % 6 == 0:  # Every 30 seconds
            for metric_name, values in [("CPU", buf.cpu), ("Memory", buf.memory)]:
                result = self._run_arima(agent_id, metric_name, values)
                if result and result.severity != "normal":
                    detections.append(result)
        
        # Calculate health score
        health_score = 100
        for d in detections:
            if d.severity == "critical":
                health_score -= 20
            elif d.severity == "warning":
                health_score -= 10
        health_score = max(0, health_score)
        
        return DetectionResult(
            agent_id=agent_id,
            timestamp=timestamp,
            detections=detections,
            health_score=health_score,
            raw_metrics=raw_metrics,
        )
    
    def to_dict(self, result: DetectionResult) -> dict:
        """Convert DetectionResult to dict for JSON serialization."""
        return {
            "type": "anomaly",
            "agent_id": result.agent_id,
            "timestamp": result.timestamp,
            "detections": [
                {
                    "engine": d.engine,
                    "metric": d.metric,
                    "value": d.value,
                    "score": d.score,
                    "threshold": d.threshold,
                    "forecast": d.forecast,
                    "residual": d.residual,
                    "severity": d.severity,
                }
                for d in result.detections
            ],
            "health_score": result.health_score,
            "raw_metrics": result.raw_metrics,
        }


# Global detector instance
detector = AnomalyDetector()
