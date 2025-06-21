import React, { useState, useEffect } from 'react';
import { fetchTop, fetchStats } from '../api/fetchNodes';

interface DataDebugProps {
  visible: boolean;
}

export default function DataDebug({ visible }: DataDebugProps) {
  const [stats, setStats] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const testAPI = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log('🔍 Testing API connection...');
      
      // Test stats endpoint
      const statsData = await fetchStats();
      console.log('📊 Stats:', statsData);
      setStats(statsData);
      
      // Test nodes endpoint
      const nodesData = await fetchTop(5);
      console.log('🎯 Nodes:', nodesData);
      setNodes(nodesData);
      
    } catch (err) {
      console.error('❌ API Error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      testAPI();
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed',
      top: '60px',
      right: '10px',
      width: '300px',
      background: 'rgba(0,0,0,0.9)',
      color: 'white',
      padding: '15px',
      borderRadius: '8px',
      fontSize: '12px',
      zIndex: 2000,
      maxHeight: '400px',
      overflow: 'auto'
    }}>
      <h3>🔍 API Debug Panel</h3>
      
      <button 
        onClick={testAPI}
        disabled={loading}
        style={{
          padding: '5px 10px',
          background: loading ? '#666' : '#007acc',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: loading ? 'default' : 'pointer',
          marginBottom: '10px'
        }}
      >
        {loading ? 'Testing...' : 'Test API'}
      </button>

      {error && (
        <div style={{ color: '#ff4444', marginBottom: '10px' }}>
          ❌ Error: {error}
        </div>
      )}

      {stats && (
        <div style={{ marginBottom: '10px' }}>
          <strong>📊 Backend Stats:</strong><br/>
          Papers: {stats.total_papers}<br/>
          Citations: {stats.total_citations}<br/>
          Clusters: {stats.total_clusters}<br/>
          Requests: {stats.server_stats?.requests_count}
        </div>
      )}

      {nodes.length > 0 && (
        <div>
          <strong>🎯 Sample Nodes ({nodes.length}):</strong><br/>
          {nodes.map((node, i) => (
            <div key={i} style={{ 
              fontSize: '10px', 
              margin: '2px 0',
              padding: '2px',
              background: 'rgba(255,255,255,0.1)'
            }}>
              {node.attributes?.label?.substring(0, 40)}...
              <br/>
              <small>
                Pos: ({node.attributes?.x?.toFixed(1)}, {node.attributes?.y?.toFixed(1)}) | 
                Degree: {node.attributes?.degree}
              </small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
} 