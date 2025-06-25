import React, { useState, useEffect } from 'react';
import { fetchStats } from '../api/fetchNodes';

interface DebugPanelProps {
  isVisible: boolean;
  onToggle: () => void;
}

interface ApiStats {
  total_papers: number;
  total_citations: number;
  total_clusters: number;
  coordinate_bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
  server_stats?: {
    requests_count: number;
    errors_count: number;
    spatial_queries: number;
    slow_queries: number;
    uptime_seconds: number;
  };
}

const DebugPanel: React.FC<DebugPanelProps> = ({ isVisible, onToggle }) => {
  const [stats, setStats] = useState<ApiStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const refreshStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchStats();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch stats');
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async () => {
    try {
      const response = await fetch('/api/debug/logs');
      const data = await response.json();
      if (data.logs) {
        setLogs(data.logs.slice(-20)); // Show last 20 lines
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  };

  const checkHealth = async () => {
    try {
      const response = await fetch('/api/debug/health');
      const data = await response.json();
      console.log('Health check:', data);
    } catch (err) {
      console.error('Health check failed:', err);
    }
  };

  useEffect(() => {
    if (isVisible) {
      refreshStats();
      fetchLogs();
    }
  }, [isVisible]);

  useEffect(() => {
    if (autoRefresh && isVisible) {
      const interval = setInterval(() => {
        refreshStats();
        fetchLogs();
      }, 5000); // Refresh every 5 seconds

      return () => clearInterval(interval);
    }
  }, [autoRefresh, isVisible]);

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours}h ${minutes}m ${secs}s`;
  };

  if (!isVisible) {
    return (
      <button
        onClick={onToggle}
        style={{
          position: 'fixed',
          top: 60,  // Move below the header to avoid overlap with theme toggle
          right: 10,
          zIndex: 2000,
          backgroundColor: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          padding: '8px 12px',
          cursor: 'pointer',
          fontSize: '12px'
        }}
      >
        🐛 Debug
      </button>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      top: 60,  // Move below the header to avoid overlap with theme toggle
      right: 10,
      width: '400px',
      maxHeight: '80vh',
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      color: 'white',
      padding: '15px',
      borderRadius: '8px',
      fontSize: '12px',
      zIndex: 2000,
      overflowY: 'auto',
      fontFamily: 'monospace'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h3 style={{ margin: 0, fontSize: '14px' }}>🐛 Debug Panel</h3>
        <div>
          <label style={{ marginRight: '10px' }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={() => setAutoRefresh(!autoRefresh)}
              style={{ marginRight: '5px' }}
            />
            Auto-refresh
          </label>
          <button
            onClick={onToggle}
            style={{
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: '11px'
            }}
          >
            ✕
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '5px', marginBottom: '15px' }}>
        <button
          onClick={refreshStats}
          disabled={loading}
          style={{
            backgroundColor: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            padding: '4px 8px',
            cursor: 'pointer',
            fontSize: '10px'
          }}
        >
          🔄 Refresh
        </button>
        <button
          onClick={checkHealth}
          style={{
            backgroundColor: '#17a2b8',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            padding: '4px 8px',
            cursor: 'pointer',
            fontSize: '10px'
          }}
        >
          💓 Health
        </button>
        <button
          onClick={fetchLogs}
          style={{
            backgroundColor: '#ffc107',
            color: 'black',
            border: 'none',
            borderRadius: '3px',
            padding: '4px 8px',
            cursor: 'pointer',
            fontSize: '10px'
          }}
        >
          📜 Logs
        </button>
      </div>

      {loading && <div>⏳ Loading...</div>}
      {error && <div style={{ color: '#ff6b6b' }}>❌ {error}</div>}

      {stats && (
        <div>
          <div style={{ marginBottom: '15px' }}>
            <strong>📊 Database Stats:</strong>
            <div>Papers: {stats.total_papers.toLocaleString()}</div>
            <div>Citations: {stats.total_citations.toLocaleString()}</div>
            <div>Clusters: {stats.total_clusters}</div>
            <div style={{ fontSize: '10px', color: '#aaa' }}>
              Bounds: X({stats.coordinate_bounds.minX.toFixed(1)}, {stats.coordinate_bounds.maxX.toFixed(1)}) 
              Y({stats.coordinate_bounds.minY.toFixed(1)}, {stats.coordinate_bounds.maxY.toFixed(1)})
            </div>
          </div>

          {stats.server_stats && (
            <div style={{ marginBottom: '15px' }}>
              <strong>🚀 Server Stats:</strong>
              <div>Requests: {stats.server_stats.requests_count}</div>
              <div>Errors: {stats.server_stats.errors_count}</div>
              <div>Spatial Queries: {stats.server_stats.spatial_queries}</div>
              <div>Slow Queries: {stats.server_stats.slow_queries}</div>
              <div>Uptime: {formatUptime(stats.server_stats.uptime_seconds)}</div>
            </div>
          )}
        </div>
      )}

      {logs.length > 0 && (
        <div>
          <strong>📜 Recent Logs:</strong>
          <div style={{
            maxHeight: '200px',
            overflowY: 'auto',
            backgroundColor: '#1a1a1a',
            padding: '8px',
            borderRadius: '4px',
            marginTop: '5px',
            fontSize: '10px'
          }}>
            {logs.map((log, index) => (
              <div key={index} style={{
                marginBottom: '2px',
                color: log.includes('ERROR') ? '#ff6b6b' : 
                      log.includes('WARNING') ? '#ffc107' : 
                      log.includes('INFO') ? '#28a745' : '#fff'
              }}>
                {log}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default DebugPanel; 